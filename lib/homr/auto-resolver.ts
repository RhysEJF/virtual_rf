/**
 * HOMЯ Auto-Resolver
 *
 * Evaluates escalations and automatically resolves them when confident,
 * reducing human interruptions while maintaining oversight.
 */

import { complete } from '../claude/client';
import { getTaskById } from '../db/tasks';
import { getOutcomeById } from '../db/outcomes';
import { getHomrContext, getPendingEscalations, getEscalationById } from '../db/homr';
import type { HomrEscalation, HomrQuestionOption, Task, Outcome } from '../db/schema';
import { resolveEscalation } from './escalator';
import { logHomrActivity } from '../db/homr';

// ============================================================================
// Types
// ============================================================================

export type AutoResolveMode = 'manual' | 'semi-auto' | 'full-auto';

export interface AutoResolveResult {
  shouldAutoResolve: boolean;
  selectedOption: string | null;
  reasoning: string;
  confidence: number;
}

export interface AutoResolveConfig {
  mode: AutoResolveMode;
  confidenceThreshold: number;
}

// ============================================================================
// Escalation Type Classification
// ============================================================================

type EscalationType = 'complexity' | 'failure' | 'ambiguity' | 'security' | 'unknown';

function classifyEscalation(escalation: HomrEscalation): EscalationType {
  const questionLower = escalation.question_text.toLowerCase();
  const triggerType = escalation.trigger_type.toLowerCase();

  if (questionLower.includes('complex') || questionLower.includes('turn limit')) {
    return 'complexity';
  }
  if (questionLower.includes('fail') || triggerType.includes('failure')) {
    return 'failure';
  }
  if (questionLower.includes('security') || questionLower.includes('dangerous') || questionLower.includes('destructive')) {
    return 'security';
  }
  if (questionLower.includes('ambig') || questionLower.includes('unclear') || questionLower.includes('clarif')) {
    return 'ambiguity';
  }
  return 'unknown';
}

// ============================================================================
// Heuristic-Based Auto-Resolution
// ============================================================================

/**
 * Fast heuristic resolution for common escalation patterns.
 * Returns null if heuristics don't apply and Claude should decide.
 */
function tryHeuristicResolution(
  escalation: HomrEscalation,
  options: HomrQuestionOption[],
  task: Task | null
): AutoResolveResult | null {
  const escalationType = classifyEscalation(escalation);

  // Security escalations: NEVER auto-resolve
  if (escalationType === 'security') {
    return {
      shouldAutoResolve: false,
      selectedOption: null,
      reasoning: 'Security-related escalations require human review',
      confidence: 1.0,
    };
  }

  // Complexity escalations: prefer decomposition
  if (escalationType === 'complexity') {
    const decomposeOption = options.find(o =>
      o.id.toLowerCase().includes('break') ||
      o.id.toLowerCase().includes('subtask') ||
      o.id.toLowerCase().includes('decompose')
    );

    if (decomposeOption) {
      return {
        shouldAutoResolve: true,
        selectedOption: decomposeOption.id,
        reasoning: 'Complexity escalation - decomposition is the safest path forward. Breaking into subtasks prevents turn limit exhaustion and creates manageable work units.',
        confidence: 0.9,
      };
    }
  }

  // Failure escalations: retry once, then human
  if (escalationType === 'failure') {
    const retryOption = options.find(o =>
      o.id.toLowerCase().includes('retry') ||
      o.id.toLowerCase().includes('increase') ||
      o.id.toLowerCase().includes('proceed')
    );

    // Check if we've already retried (task attempts > 1)
    if (task && task.attempts > 1) {
      return {
        shouldAutoResolve: false,
        selectedOption: null,
        reasoning: 'Task has failed multiple times - human should review',
        confidence: 0.85,
      };
    }

    if (retryOption) {
      return {
        shouldAutoResolve: true,
        selectedOption: retryOption.id,
        reasoning: 'First failure - retrying is reasonable before escalating to human',
        confidence: 0.75,
      };
    }
  }

  // Ambiguity: always human
  if (escalationType === 'ambiguity') {
    return {
      shouldAutoResolve: false,
      selectedOption: null,
      reasoning: 'Ambiguous requirements require human domain knowledge',
      confidence: 0.95,
    };
  }

  return null; // Heuristics don't apply
}

// ============================================================================
// Claude-Based Resolution (for complex cases)
// ============================================================================

const AUTO_RESOLVE_PROMPT = `You are evaluating an escalation to decide if it can be automatically resolved or needs human input.

ESCALATION:
Question: {question}
Options:
{options}

TASK CONTEXT:
Title: {taskTitle}
Description: {taskDescription}
Attempts so far: {attempts}
Max attempts: {maxAttempts}

OUTCOME CONTEXT:
Name: {outcomeName}
Past decisions in this outcome: {pastDecisions}

INSTRUCTIONS:
1. Analyze the escalation and available options
2. Consider the task context and past decisions
3. Decide if this can be safely auto-resolved or needs human judgment

RESPOND IN THIS EXACT JSON FORMAT:
{
  "shouldAutoResolve": true/false,
  "selectedOption": "option_id or null if shouldAutoResolve is false",
  "reasoning": "Brief explanation of your decision",
  "confidence": 0.0-1.0
}

GUIDELINES:
- Complexity/turn limit issues → usually safe to auto-resolve with decomposition
- Ambiguous requirements → needs human
- Security/destructive operations → NEVER auto-resolve
- Repeated failures → human should review
- If unsure, set shouldAutoResolve to false`;

async function claudeBasedResolution(
  escalation: HomrEscalation,
  options: HomrQuestionOption[],
  task: Task | null,
  outcome: Outcome | null
): Promise<AutoResolveResult> {
  const optionsText = options
    .map(o => `- ${o.id}: ${o.label} - ${o.description}`)
    .join('\n');

  // Get past decisions for context
  const context = outcome ? getHomrContext(outcome.id) : null;
  const decisions = context?.decisions ? JSON.parse(context.decisions) : [];
  const pastDecisionsText = decisions.length > 0
    ? decisions.slice(-5).map((d: { content: string }) => d.content).join('; ')
    : 'None';

  const prompt = AUTO_RESOLVE_PROMPT
    .replace('{question}', escalation.question_text)
    .replace('{options}', optionsText)
    .replace('{taskTitle}', task?.title || 'Unknown')
    .replace('{taskDescription}', task?.description?.substring(0, 500) || 'No description')
    .replace('{attempts}', String(task?.attempts || 0))
    .replace('{maxAttempts}', String(task?.max_attempts || 3))
    .replace('{outcomeName}', outcome?.name || 'Unknown')
    .replace('{pastDecisions}', pastDecisionsText);

  try {
    const response = await complete({
      prompt: prompt,
      maxTurns: 1,
      timeout: 30000,
      description: 'HOMЯ auto-resolve evaluation',
    });

    if (!response.success || !response.text) {
      return {
        shouldAutoResolve: false,
        selectedOption: null,
        reasoning: 'Failed to get response from Claude',
        confidence: 0,
      };
    }

    // Parse JSON from response
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Auto-Resolver] Failed to parse Claude response as JSON');
      return {
        shouldAutoResolve: false,
        selectedOption: null,
        reasoning: 'Failed to parse auto-resolve decision',
        confidence: 0,
      };
    }

    const result = JSON.parse(jsonMatch[0]) as AutoResolveResult;
    return result;
  } catch (error) {
    console.error('[Auto-Resolver] Error calling Claude:', error);
    return {
      shouldAutoResolve: false,
      selectedOption: null,
      reasoning: 'Error during auto-resolution evaluation',
      confidence: 0,
    };
  }
}

// ============================================================================
// Main Auto-Resolve Function
// ============================================================================

/**
 * Evaluate an escalation and potentially auto-resolve it.
 *
 * @param escalationId - The escalation to evaluate
 * @param config - Auto-resolve configuration
 * @returns Result of the auto-resolution attempt
 */
export async function tryAutoResolve(
  escalationId: string,
  config: AutoResolveConfig
): Promise<{
  resolved: boolean;
  result: AutoResolveResult;
  resolution?: Awaited<ReturnType<typeof resolveEscalation>>;
}> {
  // Manual mode = never auto-resolve
  if (config.mode === 'manual') {
    return {
      resolved: false,
      result: {
        shouldAutoResolve: false,
        selectedOption: null,
        reasoning: 'Auto-resolve is disabled (manual mode)',
        confidence: 1.0,
      },
    };
  }

  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    throw new Error(`Escalation not found: ${escalationId}`);
  }

  if (escalation.status !== 'pending') {
    return {
      resolved: false,
      result: {
        shouldAutoResolve: false,
        selectedOption: null,
        reasoning: `Escalation is not pending (status: ${escalation.status})`,
        confidence: 1.0,
      },
    };
  }

  // Get context
  const task = escalation.trigger_task_id ? getTaskById(escalation.trigger_task_id) : null;
  const outcome = getOutcomeById(escalation.outcome_id);
  const options: HomrQuestionOption[] = JSON.parse(escalation.question_options || '[]');

  // Try heuristic resolution first (fast)
  let result = tryHeuristicResolution(escalation, options, task);

  // If heuristics don't apply, use Claude
  if (!result) {
    result = await claudeBasedResolution(escalation, options, task, outcome);
  }

  console.log(`[Auto-Resolver] Escalation ${escalationId}: confidence=${result.confidence}, threshold=${config.confidenceThreshold}, shouldResolve=${result.shouldAutoResolve}`);

  // Check confidence threshold
  if (!result.shouldAutoResolve || result.confidence < config.confidenceThreshold) {
    // Log that we deferred to human
    logHomrActivity({
      outcome_id: escalation.outcome_id,
      type: 'auto_resolve_deferred',
      summary: `Auto-resolve deferred to human (confidence: ${(result.confidence * 100).toFixed(0)}%)`,
      details: { escalationId, reasoning: result.reasoning },
    });

    return {
      resolved: false,
      result,
    };
  }

  // Semi-auto mode would stop here and wait for human confirmation
  // For now, we treat semi-auto same as full-auto (can add UI later)

  // Auto-resolve!
  if (!result.selectedOption) {
    return {
      resolved: false,
      result: {
        ...result,
        reasoning: 'No option selected for auto-resolution',
      },
    };
  }

  try {
    console.log(`[Auto-Resolver] Auto-resolving escalation ${escalationId} with option: ${result.selectedOption}`);

    const resolution = await resolveEscalation(escalationId, {
      selectedOption: result.selectedOption,
      additionalContext: `[AUTO-RESOLVED] ${result.reasoning}`,
    });

    // Log the auto-resolution
    logHomrActivity({
      outcome_id: escalation.outcome_id,
      type: 'auto_resolved',
      summary: `Auto-resolved: ${result.selectedOption} (confidence: ${(result.confidence * 100).toFixed(0)}%)`,
      details: {
        escalationId,
        selectedOption: result.selectedOption,
        reasoning: result.reasoning,
        confidence: result.confidence,
      },
    });

    return {
      resolved: true,
      result,
      resolution,
    };
  } catch (error) {
    console.error('[Auto-Resolver] Failed to resolve escalation:', error);
    return {
      resolved: false,
      result: {
        ...result,
        reasoning: `Auto-resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    };
  }
}

// ============================================================================
// Batch Auto-Resolve
// ============================================================================

/**
 * Try to auto-resolve all pending escalations for an outcome.
 */
export async function autoResolveAllPending(
  outcomeId: string,
  config: AutoResolveConfig
): Promise<{
  total: number;
  resolved: number;
  deferred: number;
  results: Array<{ escalationId: string; resolved: boolean; reasoning: string }>;
}> {
  const pending = getPendingEscalations(outcomeId);
  const results: Array<{ escalationId: string; resolved: boolean; reasoning: string }> = [];

  let resolved = 0;
  let deferred = 0;

  for (const escalation of pending) {
    const { resolved: wasResolved, result } = await tryAutoResolve(escalation.id, config);

    results.push({
      escalationId: escalation.id,
      resolved: wasResolved,
      reasoning: result.reasoning,
    });

    if (wasResolved) {
      resolved++;
    } else {
      deferred++;
    }
  }

  return {
    total: pending.length,
    resolved,
    deferred,
    results,
  };
}

// ============================================================================
// Get Config from Outcome
// ============================================================================

export function getAutoResolveConfig(outcome: Outcome | null): AutoResolveConfig {
  if (!outcome) {
    return { mode: 'manual', confidenceThreshold: 0.8 };
  }

  // Access the fields (they may be undefined if not yet set in DB)
  const outcomeAny = outcome as unknown as {
    auto_resolve_mode?: AutoResolveMode;
    auto_resolve_threshold?: number;
  };

  return {
    mode: outcomeAny.auto_resolve_mode || 'manual',
    confidenceThreshold: outcomeAny.auto_resolve_threshold ?? 0.8,
  };
}
