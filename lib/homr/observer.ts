/**
 * HOMЯ Observer
 *
 * Analyzes completed task outputs to extract learnings, detect drift,
 * and identify ambiguity that needs human input.
 */

import { complete } from '../claude/client';
import {
  createObservation,
  addDiscoveryToContext,
  incrementHomrContextStat,
  getHomrContext,
  logHomrActivity,
} from '../db/homr';
import { getOutcomeById } from '../db/outcomes';
import { getLatestDesignDoc } from '../db/design-docs';
import type { Task, Intent, HomrDiscovery, HomrAmbiguitySignal, HomrQuestionOption } from '../db/schema';
import type { ObservationResult, ObserveTaskInput, ParsedContextStore } from './types';
import { buildObservationPrompt, parseObservationResponse } from './prompts';

// ============================================================================
// Main Observation Function
// ============================================================================

/**
 * Observe a completed task and extract learnings
 */
export async function observeTask(input: ObserveTaskInput): Promise<ObservationResult | null> {
  const { task, fullOutput, intent, outcomeId } = input;

  // Get design doc if available
  let designDoc: string | null = null;
  try {
    const designDocRow = getLatestDesignDoc(outcomeId);
    if (designDocRow) {
      designDoc = designDocRow.approach;
    }
  } catch {
    // Design doc not found, continue without it
  }

  // Get existing context store
  let contextStore: ParsedContextStore | null = null;
  const contextRow = getHomrContext(outcomeId);
  if (contextRow) {
    contextStore = {
      outcomeId: contextRow.outcome_id,
      discoveries: JSON.parse(contextRow.discoveries),
      decisions: JSON.parse(contextRow.decisions),
      constraints: JSON.parse(contextRow.constraints),
      injections: JSON.parse(contextRow.injections),
      stats: {
        tasksObserved: contextRow.tasks_observed,
        discoveriesExtracted: contextRow.discoveries_extracted,
        escalationsCreated: contextRow.escalations_created,
        steeringActions: contextRow.steering_actions,
      },
    };
  }

  // Build the observation prompt
  const prompt = buildObservationPrompt(task, fullOutput, intent, designDoc, contextStore);

  // Call Claude to analyze the task output
  console.log(`[HOMЯ Observer] Analyzing task ${task.id}: ${task.title}`);

  const response = await complete({
    system: 'You are HOMЯ, an intelligent orchestration layer that observes task outputs. Respond only with valid JSON.',
    prompt,
    maxTurns: 1, // Single turn for observation - no tools needed
    timeout: 60000, // 1 minute timeout
    outcomeId,
    description: `HOMЯ observation for task: ${task.title}`,
  });

  if (!response.success || !response.text) {
    console.error('[HOMЯ Observer] Failed to get response from Claude:', response.error);
    return null;
  }

  // Parse the response
  const parsed = parseObservationResponse(response.text);
  if (!parsed) {
    console.error('[HOMЯ Observer] Failed to parse observation response');
    return null;
  }

  // Create observation result
  const result: ObservationResult = {
    taskId: task.id,
    outcomeId,
    timestamp: Date.now(),
    onTrack: parsed.onTrack,
    alignmentScore: parsed.alignmentScore,
    drift: parsed.drift,
    quality: parsed.quality,
    issues: parsed.issues,
    discoveries: parsed.discoveries.map((d) => ({
      ...d,
      source: task.id,
    })),
    ambiguity: parsed.ambiguity ? {
      detected: true,
      type: parsed.ambiguity.type!,
      description: parsed.ambiguity.description || '',
      evidence: parsed.ambiguity.evidence || [],
      affectedTasks: [], // Will be populated later
      suggestedQuestion: parsed.ambiguity.suggestedQuestion || '',
    } : null,
    summary: parsed.summary,
  };

  // Store observation in database
  createObservation({
    outcome_id: outcomeId,
    task_id: task.id,
    on_track: result.onTrack,
    alignment_score: result.alignmentScore,
    quality: result.quality,
    drift: result.drift,
    discoveries: result.discoveries,
    issues: result.issues,
    has_ambiguity: result.ambiguity !== null,
    ambiguity_data: result.ambiguity || undefined,
    summary: result.summary,
  });

  // Add discoveries to context store
  for (const discovery of result.discoveries) {
    addDiscoveryToContext(outcomeId, discovery);
  }

  // Log activity
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'observation',
    details: {
      taskId: task.id,
      taskTitle: task.title,
      onTrack: result.onTrack,
      alignmentScore: result.alignmentScore,
      quality: result.quality,
      driftCount: result.drift.length,
      discoveryCount: result.discoveries.length,
      hasAmbiguity: result.ambiguity !== null,
    },
    summary: result.summary,
  });

  console.log(`[HOMЯ Observer] Task ${task.id} observation complete:`, {
    onTrack: result.onTrack,
    alignmentScore: result.alignmentScore,
    quality: result.quality,
    discoveries: result.discoveries.length,
    hasAmbiguity: result.ambiguity !== null,
  });

  return result;
}

// ============================================================================
// Quick Observation (for simple cases)
// ============================================================================

/**
 * Quick observation without full Claude analysis
 * Used for tasks that don't need semantic review
 */
export function quickObserve(
  task: Task,
  outcomeId: string,
  success: boolean
): ObservationResult {
  const result: ObservationResult = {
    taskId: task.id,
    outcomeId,
    timestamp: Date.now(),
    onTrack: success,
    alignmentScore: success ? 80 : 40,
    drift: [],
    quality: success ? 'good' : 'needs_work',
    issues: success ? [] : [{
      type: 'task_failure',
      description: 'Task did not complete successfully',
      severity: 'medium',
    }],
    discoveries: [],
    ambiguity: null,
    summary: success
      ? `Task "${task.title}" completed successfully.`
      : `Task "${task.title}" failed or had issues.`,
  };

  // Store observation
  createObservation({
    outcome_id: outcomeId,
    task_id: task.id,
    on_track: result.onTrack,
    alignment_score: result.alignmentScore,
    quality: result.quality,
    drift: result.drift,
    discoveries: result.discoveries,
    issues: result.issues,
    has_ambiguity: false,
    summary: result.summary,
  });

  return result;
}

// ============================================================================
// Ambiguity Detection (Pattern-Based)
// ============================================================================

/**
 * Patterns that indicate ambiguity in task output
 */
const AMBIGUITY_PATTERNS: Array<{
  pattern: RegExp;
  type: HomrAmbiguitySignal['type'];
  description: string;
}> = [
  // Explicit uncertainty
  { pattern: /I('m| am) (not sure|unsure|uncertain)/i, type: 'unclear_requirement', description: 'Worker expressed uncertainty' },
  { pattern: /assuming (that|this)/i, type: 'unclear_requirement', description: 'Worker made assumptions' },
  { pattern: /need(s)? clarification/i, type: 'unclear_requirement', description: 'Worker requested clarification' },

  // Multiple approaches
  { pattern: /could (go either|be done|approach)/i, type: 'multiple_approaches', description: 'Multiple valid approaches identified' },
  { pattern: /which (approach|method|way)/i, type: 'multiple_approaches', description: 'Decision needed between approaches' },
  { pattern: /Option (A|B|1|2)/i, type: 'multiple_approaches', description: 'Options listed without resolution' },

  // Blocking decisions
  { pattern: /blocked (by|on|waiting)/i, type: 'blocking_decision', description: 'Work is blocked' },
  { pattern: /can('t| not) proceed/i, type: 'blocking_decision', description: 'Cannot proceed without decision' },
  { pattern: /need(s)? (a |to )?(decision|input)/i, type: 'blocking_decision', description: 'Decision needed to proceed' },

  // Contradictions
  { pattern: /contradict(s|ing)?/i, type: 'contradicting_info', description: 'Contradiction detected' },
  { pattern: /conflict(s|ing)? with/i, type: 'contradicting_info', description: 'Conflicting information' },
  { pattern: /inconsistent/i, type: 'contradicting_info', description: 'Inconsistent requirements' },
];

/**
 * Detect ambiguity patterns in task output
 */
export function detectAmbiguityPatterns(output: string): HomrAmbiguitySignal | null {
  const matches: Array<{
    type: HomrAmbiguitySignal['type'];
    description: string;
    evidence: string;
  }> = [];

  for (const { pattern, type, description } of AMBIGUITY_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      // Extract surrounding context as evidence
      const matchIndex = match.index || 0;
      const start = Math.max(0, matchIndex - 50);
      const end = Math.min(output.length, matchIndex + match[0].length + 50);
      const evidence = output.substring(start, end).trim();

      matches.push({ type, description, evidence });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Use the most common type, or the first one
  const typeCounts = matches.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const primaryType = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])[0][0] as HomrAmbiguitySignal['type'];

  return {
    detected: true,
    type: primaryType,
    description: matches.find(m => m.type === primaryType)?.description || 'Ambiguity detected',
    evidence: matches.map(m => m.evidence),
    affectedTasks: [], // Will be populated later
    suggestedQuestion: generateSuggestedQuestion(primaryType, matches[0].evidence),
  };
}

/**
 * Generate a suggested question based on ambiguity type
 */
function generateSuggestedQuestion(type: HomrAmbiguitySignal['type'], evidence: string): string {
  switch (type) {
    case 'unclear_requirement':
      return 'What is the expected behavior for this requirement?';
    case 'multiple_approaches':
      return 'Which approach should be used?';
    case 'blocking_decision':
      return 'How should we proceed with this blocking issue?';
    case 'contradicting_info':
      return 'Which information should take precedence?';
    default:
      return 'How should we handle this ambiguity?';
  }
}

// ============================================================================
// Failure Pattern Detection
// ============================================================================

import { getRecentObservations } from '../db/homr';
import type { HomrObservation } from '../db/schema';

/**
 * Configuration for failure pattern detection
 */
export interface FailurePatternConfig {
  /** Number of recent observations to check (default: 5) */
  lookbackCount?: number;
  /** Number of consecutive failures to trigger escalation (default: 3) */
  consecutiveFailureThreshold?: number;
  /** Minimum alignment score to consider "healthy" (default: 50) */
  healthyAlignmentThreshold?: number;
}

const DEFAULT_FAILURE_CONFIG: Required<FailurePatternConfig> = {
  lookbackCount: 5,
  consecutiveFailureThreshold: 3,
  healthyAlignmentThreshold: 50,
};

/**
 * Result of failure pattern analysis
 */
export interface FailurePatternResult {
  detected: boolean;
  pattern: 'consecutive_failures' | 'declining_quality' | 'repeated_drift' | null;
  consecutiveFailures: number;
  recentQuality: Array<'good' | 'needs_work' | 'off_rails'>;
  averageAlignment: number;
  recommendation: 'continue' | 'pause_for_review' | 'escalate';
  evidence: string[];
}

/**
 * Detect failure patterns in recent observations
 * This helps HOMЯ identify when Ralph is stuck or struggling
 */
export function detectFailurePatterns(
  outcomeId: string,
  currentObservation: ObservationResult,
  config: FailurePatternConfig = {}
): FailurePatternResult {
  const {
    lookbackCount,
    consecutiveFailureThreshold,
    healthyAlignmentThreshold,
  } = { ...DEFAULT_FAILURE_CONFIG, ...config };

  // Get recent observations (excluding current, which isn't stored yet)
  const recentObservations = getRecentObservations(outcomeId, lookbackCount);

  // Parse the stored observations
  const parsedObservations = recentObservations.map(obs => ({
    onTrack: Boolean(obs.on_track),
    alignmentScore: obs.alignment_score,
    quality: obs.quality as 'good' | 'needs_work' | 'off_rails',
    drift: JSON.parse(obs.drift || '[]'),
    summary: obs.summary,
  }));

  // Add current observation to the analysis
  const allObservations = [
    {
      onTrack: currentObservation.onTrack,
      alignmentScore: currentObservation.alignmentScore,
      quality: currentObservation.quality,
      drift: currentObservation.drift,
      summary: currentObservation.summary,
    },
    ...parsedObservations,
  ];

  const evidence: string[] = [];

  // Count consecutive failures (not on track or low alignment)
  let consecutiveFailures = 0;
  for (const obs of allObservations) {
    if (!obs.onTrack || obs.alignmentScore < healthyAlignmentThreshold || obs.quality === 'off_rails') {
      consecutiveFailures++;
      evidence.push(`Task ${obs.onTrack ? 'low alignment' : 'off track'}: "${obs.summary}"`);
    } else {
      break; // Stop counting at first success
    }
  }

  // Calculate average alignment across recent observations
  const alignmentScores = allObservations.map(o => o.alignmentScore);
  const averageAlignment = alignmentScores.length > 0
    ? alignmentScores.reduce((a, b) => a + b, 0) / alignmentScores.length
    : 100;

  // Collect quality assessments
  const recentQuality = allObservations.map(o => o.quality);

  // Check for declining quality trend
  const qualityScores = recentQuality.map(q => q === 'good' ? 3 : q === 'needs_work' ? 2 : 1);
  const isDeclinig = qualityScores.length >= 3 &&
    qualityScores[0] < qualityScores[1] &&
    qualityScores[1] < qualityScores[2];

  // Check for repeated drift patterns
  const allDrift = allObservations.flatMap(o => o.drift);
  const driftTypes = allDrift.map(d => d.type);
  const repeatedDriftType = driftTypes.find(
    (type, i) => driftTypes.indexOf(type) !== i
  );

  // Determine the pattern
  let pattern: FailurePatternResult['pattern'] = null;
  let recommendation: FailurePatternResult['recommendation'] = 'continue';

  if (consecutiveFailures >= consecutiveFailureThreshold) {
    pattern = 'consecutive_failures';
    recommendation = 'escalate';
  } else if (isDeclinig) {
    pattern = 'declining_quality';
    recommendation = 'pause_for_review';
  } else if (repeatedDriftType) {
    pattern = 'repeated_drift';
    recommendation = 'pause_for_review';
    evidence.push(`Repeated drift type: ${repeatedDriftType}`);
  }

  return {
    detected: pattern !== null,
    pattern,
    consecutiveFailures,
    recentQuality,
    averageAlignment,
    recommendation,
    evidence: evidence.slice(0, 5), // Limit evidence to 5 items
  };
}

/**
 * Create an ambiguity signal for failure patterns
 * This converts a failure pattern into something the escalator can handle
 */
export function createFailurePatternAmbiguity(
  failureResult: FailurePatternResult,
  taskId: string
): HomrAmbiguitySignal {
  const descriptions: Record<NonNullable<FailurePatternResult['pattern']>, string> = {
    consecutive_failures: `${failureResult.consecutiveFailures} consecutive tasks have failed or gone off track`,
    declining_quality: 'Work quality is declining across recent tasks',
    repeated_drift: 'The same type of drift keeps occurring across tasks',
  };

  const questions: Record<NonNullable<FailurePatternResult['pattern']>, string> = {
    consecutive_failures: 'Multiple tasks are failing. Should we pause work for review, or continue?',
    declining_quality: 'Work quality is declining. Should we pause to reassess the approach?',
    repeated_drift: 'A recurring issue is causing drift. How should we address it?',
  };

  // Check if failures are turn-limit related
  const evidenceText = failureResult.evidence.join(' ').toLowerCase();
  const isTurnLimitIssue = evidenceText.includes('turn') ||
                           evidenceText.includes('max_turns') ||
                           evidenceText.includes('iteration') ||
                           evidenceText.includes('20 turns');

  // Base options that always apply
  const options: HomrQuestionOption[] = [];

  // If turn limit related, offer decomposition and turn increase first
  if (isTurnLimitIssue) {
    options.push(
      {
        id: 'break_into_subtasks',
        label: 'Break into Subtasks',
        description: 'Split the complex task into smaller, manageable pieces',
        implications: 'Task will be decomposed into subtasks that fit within turn limits',
      },
      {
        id: 'increase_turn_limit',
        label: 'Increase Turn Limit',
        description: 'Double the max turns (40 → 80) and retry the task',
        implications: 'Worker gets more iterations but task may still be too complex',
      }
    );
  }

  // Always include these options
  options.push(
    {
      id: 'continue_with_guidance',
      label: 'Continue with Guidance',
      description: 'Add specific instructions and let workers retry',
      implications: 'You\'ll provide additional context to help workers succeed',
    },
    {
      id: 'pause_and_review',
      label: 'Pause for Review',
      description: 'Stop all workers and review what went wrong',
      implications: 'Work will stop until you manually resume after investigation',
    },
    {
      id: 'skip_failing_tasks',
      label: 'Skip Failing Tasks',
      description: 'Mark stuck tasks as failed and continue with others',
      implications: 'Some work may be incomplete but progress will continue',
    }
  );

  return {
    detected: true,
    type: 'blocking_decision',
    description: descriptions[failureResult.pattern!] || 'Work appears to be stuck',
    evidence: failureResult.evidence,
    affectedTasks: [taskId], // Will be expanded by escalator
    suggestedQuestion: isTurnLimitIssue
      ? 'Tasks are hitting turn limits. Should we break them into smaller pieces or increase the limit?'
      : (questions[failureResult.pattern!] || 'How should we proceed?'),
    options,
  };
}
