/**
 * HOMЯ Escalator
 *
 * Detects ambiguity in task outputs and creates structured questions
 * for human input. Manages the escalation lifecycle.
 */

import { generateId } from '../utils/id';
import { complete } from '../claude/client';
import {
  createEscalation as createEscalationDb,
  getEscalationById,
  answerEscalation as answerEscalationDb,
  dismissEscalation as dismissEscalationDb,
  getPendingEscalations,
  addDecisionToContext,
  addContextInjection,
  logHomrActivity,
  getOrCreateHomrContext,
  updateHomrContext,
} from '../db/homr';
import type { HomrDiscovery } from '../db/schema';
import { getTaskById, updateTask, getPendingTasks } from '../db/tasks';
import { getOutcomeById } from '../db/outcomes';
import type { Task, Intent, Approach, HomrAmbiguitySignal, HomrQuestionOption, HomrDecision } from '../db/schema';
import type { EscalationAnswer, EscalationResolution, EscalationActionType, EscalationActionResult } from './types';
import { buildEscalationQuestionPrompt, parseEscalationQuestionResponse } from './prompts';
import { decomposeTask, DecompositionContext } from '../agents/task-decomposer';

/**
 * Safely parse JSON with a fallback value
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json || json === '') return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    console.error('[HOMЯ Escalator] Failed to parse JSON:', json?.substring(0, 100));
    return fallback;
  }
}

// ============================================================================
// Escalation Creation
// ============================================================================

/**
 * Create an escalation from detected ambiguity
 */
export async function createEscalation(
  outcomeId: string,
  ambiguity: HomrAmbiguitySignal,
  task: Task
): Promise<string> {
  // Get outcome and intent for context
  const outcome = getOutcomeById(outcomeId);
  let intent: Intent | null = null;

  if (outcome?.intent) {
    try {
      intent = JSON.parse(outcome.intent) as Intent;
    } catch {
      // Intent might not be valid JSON
    }
  }

  // Determine affected tasks
  const affectedTasks = ambiguity.affectedTasks.length > 0
    ? ambiguity.affectedTasks
    : findAffectedTasks(outcomeId, ambiguity, task.id);

  // Generate structured question with options
  let questionText = ambiguity.suggestedQuestion;
  let questionContext = ambiguity.description;
  let options: HomrQuestionOption[] = ambiguity.options || [];

  // If no options provided, use Claude to generate them
  if (options.length < 2) {
    const generated = await generateEscalationQuestion(ambiguity, task, intent);
    if (generated) {
      questionText = generated.questionText;
      questionContext = generated.questionContext;
      options = generated.options;
    } else {
      // Fallback to default options
      options = [
        {
          id: 'proceed',
          label: 'Proceed as-is',
          description: 'Continue with the current approach',
          implications: 'Work will continue without changes',
        },
        {
          id: 'stop',
          label: 'Stop and review',
          description: 'Pause work for manual review',
          implications: 'Tasks will remain paused until resolved',
        },
      ];
    }
  }

  // Create escalation record
  const escalation = createEscalationDb({
    outcome_id: outcomeId,
    trigger_type: ambiguity.type,
    trigger_task_id: task.id,
    trigger_evidence: ambiguity.evidence,
    question_text: questionText,
    question_context: questionContext,
    question_options: options,
    affected_tasks: affectedTasks,
  });

  // Pause affected tasks
  for (const taskId of affectedTasks) {
    pauseTask(taskId, `Paused by HOMЯ: Awaiting human input on ${ambiguity.type}`);
  }

  // Log activity
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'escalation',
    details: {
      escalationId: escalation.id,
      triggerType: ambiguity.type,
      triggerTaskId: task.id,
      affectedTasks,
      question: questionText,
      optionCount: options.length,
    },
    summary: `Created escalation: "${questionText.substring(0, 50)}..." affecting ${affectedTasks.length} task(s)`,
  });

  console.log(`[HOMЯ Escalator] Created escalation ${escalation.id} with ${options.length} options`);

  return escalation.id;
}

/**
 * Generate escalation question using Claude
 */
async function generateEscalationQuestion(
  ambiguity: HomrAmbiguitySignal,
  task: Task,
  intent: Intent | null
): Promise<{
  questionText: string;
  questionContext: string;
  options: HomrQuestionOption[];
} | null> {
  const prompt = buildEscalationQuestionPrompt(ambiguity, task, intent);

  const response = await complete({
    system: 'You are HOMЯ, generating clear questions for human decision-making. Respond only with valid JSON.',
    prompt,
    maxTurns: 1,
    timeout: 30000,
    description: 'HOMЯ escalation question generation',
  });

  if (!response.success || !response.text) {
    console.error('[HOMЯ Escalator] Failed to generate question:', response.error);
    return null;
  }

  return parseEscalationQuestionResponse(response.text);
}

/**
 * Find tasks affected by the ambiguity
 */
function findAffectedTasks(
  outcomeId: string,
  ambiguity: HomrAmbiguitySignal,
  triggerTaskId: string
): string[] {
  const pendingTasks = getPendingTasks(outcomeId);

  // For blocking decisions, all pending tasks are affected
  if (ambiguity.type === 'blocking_decision') {
    return pendingTasks.map(t => t.id);
  }

  // For other types, find related tasks based on description similarity
  // For now, return the trigger task plus tasks with similar titles
  const affected = [triggerTaskId];
  const triggerTask = getTaskById(triggerTaskId);

  if (triggerTask) {
    const keywords = extractKeywords(triggerTask.title + ' ' + (triggerTask.description || ''));

    for (const task of pendingTasks) {
      if (task.id === triggerTaskId) continue;

      const taskKeywords = extractKeywords(task.title + ' ' + (task.description || ''));
      const overlap = keywords.filter(k => taskKeywords.includes(k));

      if (overlap.length >= 2) {
        affected.push(task.id);
      }
    }
  }

  return affected;
}

/**
 * Extract keywords from text
 */
function extractKeywords(text: string): string[] {
  const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'as'];

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));
}

/**
 * Pause a task with a message
 */
function pauseTask(taskId: string, message: string): void {
  const task = getTaskById(taskId);
  if (task && task.status === 'pending') {
    // Add pause message to description
    const newDescription = task.description
      ? `**[PAUSED]** ${message}\n\n---\n\n${task.description}`
      : `**[PAUSED]** ${message}`;

    updateTask(taskId, { description: newDescription });
    console.log(`[HOMЯ Escalator] Paused task ${taskId}`);
  }
}

/**
 * Resume a paused task
 */
function resumeTask(taskId: string): void {
  const task = getTaskById(taskId);
  if (task) {
    // Remove pause message from description
    let description = task.description || '';
    if (description.startsWith('**[PAUSED]**')) {
      const parts = description.split('---');
      description = parts.length > 1 ? parts.slice(1).join('---').trim() : '';
    }

    updateTask(taskId, { description: description || undefined });
    console.log(`[HOMЯ Escalator] Resumed task ${taskId}`);
  }
}

// ============================================================================
// Answer Pattern Storage
// ============================================================================

/**
 * Pattern for escalation answers, used to learn from human decisions
 */
interface AnswerPattern {
  triggerType: string;
  optionId: string;
  count: number;
  lastUsedAt: number;
  contexts: string[];  // Sample contexts where this pattern was applied
}

/**
 * Store an answer pattern for future reference.
 * Patterns are stored in the HOMЯ context as discoveries.
 */
function storeAnswerPattern(
  outcomeId: string,
  escalation: { trigger_type: string; question_text: string },
  selectedOptionId: string
): { triggerType: string; optionId: string; count: number } {
  const context = getOrCreateHomrContext(outcomeId);
  const discoveries: HomrDiscovery[] = safeJsonParse(context.discoveries, []);

  // Find or create pattern discovery
  const patternKey = `answer_pattern:${escalation.trigger_type}:${selectedOptionId}`;
  const existingPatternIndex = discoveries.findIndex(
    d => d.type === 'pattern' && d.content.startsWith(patternKey)
  );

  let count = 1;

  if (existingPatternIndex >= 0) {
    // Update existing pattern
    const existing = discoveries[existingPatternIndex];
    const match = existing.content.match(/count:(\d+)/);
    count = match ? parseInt(match[1], 10) + 1 : 1;

    discoveries[existingPatternIndex] = {
      ...existing,
      content: `${patternKey}|count:${count}|last:${Date.now()}`,
      relevantTasks: ['*'], // Relevant to all future tasks
    };
  } else {
    // Create new pattern discovery
    discoveries.push({
      type: 'pattern',
      content: `${patternKey}|count:${count}|last:${Date.now()}`,
      relevantTasks: ['*'],
      source: `Escalation answer: ${escalation.question_text.substring(0, 50)}...`,
    });
  }

  updateHomrContext(outcomeId, { discoveries });

  console.log(`[HOMЯ Escalator] Stored answer pattern: ${escalation.trigger_type} -> ${selectedOptionId} (count: ${count})`);

  return {
    triggerType: escalation.trigger_type,
    optionId: selectedOptionId,
    count,
  };
}

// ============================================================================
// Action Application
// ============================================================================

/**
 * Default turn limit increase multiplier
 */
const TURN_LIMIT_INCREASE_MULTIPLIER = 2;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Apply the 'increase_turn_limit' action to affected tasks.
 * Doubles the max_attempts for each task.
 */
async function applyIncreaseTurnLimit(
  affectedTasks: string[],
  additionalContext?: string
): Promise<EscalationActionResult[]> {
  const results: EscalationActionResult[] = [];

  // Parse multiplier from additional context if provided (e.g., "increase by 3x")
  let multiplier = TURN_LIMIT_INCREASE_MULTIPLIER;
  if (additionalContext) {
    const match = additionalContext.match(/(\d+)x/i);
    if (match) {
      multiplier = parseInt(match[1], 10);
    }
  }

  for (const taskId of affectedTasks) {
    const task = getTaskById(taskId);
    if (!task) {
      results.push({
        action: 'increase_turn_limit',
        success: false,
        details: { taskId, error: 'Task not found' },
      });
      continue;
    }

    const previousValue = task.max_attempts;
    const newValue = Math.max(previousValue * multiplier, previousValue + 5); // At least +5 more attempts

    try {
      updateTask(taskId, { max_attempts: newValue });
      results.push({
        action: 'increase_turn_limit',
        success: true,
        details: { taskId, previousValue, newValue },
      });
      console.log(`[HOMЯ Escalator] Increased turn limit for task ${taskId}: ${previousValue} -> ${newValue}`);
    } catch (error) {
      results.push({
        action: 'increase_turn_limit',
        success: false,
        details: { taskId, previousValue, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  return results;
}

/**
 * Apply the 'break_into_subtasks' action to affected tasks.
 * Calls the task decomposer to split complex tasks.
 */
async function applyBreakIntoSubtasks(
  outcomeId: string,
  affectedTasks: string[]
): Promise<EscalationActionResult[]> {
  const results: EscalationActionResult[] = [];

  // Get outcome for context
  const outcome = getOutcomeById(outcomeId);
  let intent: Intent | null = null;
  let approach: Approach | null = null;

  if (outcome?.intent) {
    try {
      intent = JSON.parse(outcome.intent) as Intent;
    } catch {
      // Intent might not be valid JSON
    }
  }

  for (const taskId of affectedTasks) {
    const task = getTaskById(taskId);
    if (!task) {
      results.push({
        action: 'break_into_subtasks',
        success: false,
        details: { taskId, error: 'Task not found' },
      });
      continue;
    }

    // Skip already completed or failed tasks
    if (task.status === 'completed' || task.status === 'failed') {
      results.push({
        action: 'break_into_subtasks',
        success: false,
        details: { taskId, error: `Task already ${task.status}` },
      });
      continue;
    }

    try {
      const decompositionContext: DecompositionContext = {
        task,
        outcomeIntent: intent,
        outcomeApproach: approach,
      };

      const decompositionResult = await decomposeTask(decompositionContext);

      if (decompositionResult.success) {
        results.push({
          action: 'break_into_subtasks',
          success: true,
          details: {
            taskId,
            subtaskCount: decompositionResult.createdTaskIds.length,
            createdTaskIds: decompositionResult.createdTaskIds,
          },
        });
        console.log(`[HOMЯ Escalator] Decomposed task ${taskId} into ${decompositionResult.createdTaskIds.length} subtasks`);
      } else {
        results.push({
          action: 'break_into_subtasks',
          success: false,
          details: { taskId, error: decompositionResult.error || decompositionResult.reasoning },
        });
      }
    } catch (error) {
      results.push({
        action: 'break_into_subtasks',
        success: false,
        details: { taskId, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  return results;
}

/**
 * Apply the 'skip_failing_tasks' action to affected tasks.
 * Marks tasks as failed so they won't be retried.
 */
async function applySkipFailingTasks(
  affectedTasks: string[]
): Promise<EscalationActionResult[]> {
  const results: EscalationActionResult[] = [];

  for (const taskId of affectedTasks) {
    const task = getTaskById(taskId);
    if (!task) {
      results.push({
        action: 'skip_failing_tasks',
        success: false,
        details: { taskId, error: 'Task not found' },
      });
      continue;
    }

    // Skip already completed tasks
    if (task.status === 'completed') {
      results.push({
        action: 'skip_failing_tasks',
        success: false,
        details: { taskId, error: 'Task already completed' },
      });
      continue;
    }

    try {
      // Mark as failed by setting attempts to max and updating description
      const failedDescription = task.description
        ? `**[SKIPPED BY HUMAN]** This task was skipped via escalation resolution.\n\n---\n\n${task.description}`
        : '**[SKIPPED BY HUMAN]** This task was skipped via escalation resolution.';

      // We need to use the db directly for status update since updateTask doesn't expose status
      const { getDb, now } = require('../db/index');
      const db = getDb();
      const timestamp = now();

      db.prepare(`
        UPDATE tasks
        SET status = 'failed', description = ?, updated_at = ?
        WHERE id = ?
      `).run(failedDescription, timestamp, taskId);

      results.push({
        action: 'skip_failing_tasks',
        success: true,
        details: { taskId },
      });
      console.log(`[HOMЯ Escalator] Marked task ${taskId} as skipped/failed`);
    } catch (error) {
      results.push({
        action: 'skip_failing_tasks',
        success: false,
        details: { taskId, error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  return results;
}

/**
 * Apply actions based on the selected option ID.
 * Returns array of action results.
 */
async function applyEscalationActions(
  outcomeId: string,
  selectedOptionId: string,
  affectedTasks: string[],
  additionalContext?: string
): Promise<EscalationActionResult[]> {
  const allResults: EscalationActionResult[] = [];

  // Map option IDs to actions
  // Common patterns: option IDs often include the action type
  const optionIdLower = selectedOptionId.toLowerCase();

  if (optionIdLower.includes('increase_turn') ||
      optionIdLower.includes('more_turns') ||
      optionIdLower.includes('extend_limit') ||
      optionIdLower === 'increase_turn_limit') {
    const results = await applyIncreaseTurnLimit(affectedTasks, additionalContext);
    allResults.push(...results);
  }

  if (optionIdLower.includes('break_into') ||
      optionIdLower.includes('subtask') ||
      optionIdLower.includes('decompose') ||
      optionIdLower.includes('split') ||
      optionIdLower === 'break_into_subtasks') {
    const results = await applyBreakIntoSubtasks(outcomeId, affectedTasks);
    allResults.push(...results);
  }

  if (optionIdLower.includes('skip') ||
      optionIdLower.includes('abandon') ||
      optionIdLower.includes('fail') ||
      optionIdLower === 'skip_failing_tasks') {
    const results = await applySkipFailingTasks(affectedTasks);
    allResults.push(...results);
  }

  return allResults;
}

// ============================================================================
// Escalation Resolution
// ============================================================================

/**
 * Resolve an escalation with a human answer.
 *
 * This function now applies actions based on the selected option:
 * - 'increase_turn_limit': Increases max_attempts for affected tasks
 * - 'break_into_subtasks': Decomposes complex tasks into smaller subtasks
 * - 'skip_failing_tasks': Marks failing tasks as failed/skipped
 *
 * Also stores answer patterns for future reference to help learn from human decisions.
 */
export async function resolveEscalation(
  escalationId: string,
  answer: EscalationAnswer
): Promise<EscalationResolution> {
  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    throw new Error(`Escalation not found: ${escalationId}`);
  }

  if (escalation.status !== 'pending') {
    throw new Error(`Escalation ${escalationId} is not pending (status: ${escalation.status})`);
  }

  // Find the selected option
  const options: HomrQuestionOption[] = safeJsonParse(escalation.question_options, []);
  const selectedOption = options.find(o => o.id === answer.selectedOption);

  if (!selectedOption) {
    throw new Error(`Invalid option: ${answer.selectedOption}`);
  }

  // Update escalation status
  answerEscalationDb(escalationId, answer.selectedOption, answer.additionalContext);

  // Record the decision
  const affectedTasks: string[] = safeJsonParse(escalation.affected_tasks, []);
  const decision: HomrDecision = {
    id: generateId('dec'),
    content: `${selectedOption.label}: ${selectedOption.description}`,
    madeBy: 'human',
    madeAt: Date.now(),
    context: `Escalation: ${escalation.question_text}${answer.additionalContext ? `\nAdditional context: ${answer.additionalContext}` : ''}`,
    affectedAreas: affectedTasks,
  };

  addDecisionToContext(escalation.outcome_id, decision);

  // =========================================================================
  // Apply actions based on the selected option
  // =========================================================================
  const appliedActions = await applyEscalationActions(
    escalation.outcome_id,
    answer.selectedOption,
    affectedTasks,
    answer.additionalContext
  );

  // Log applied actions
  if (appliedActions.length > 0) {
    const successCount = appliedActions.filter(a => a.success).length;
    console.log(`[HOMЯ Escalator] Applied ${successCount}/${appliedActions.length} actions for escalation ${escalationId}`);
  }

  // =========================================================================
  // Store answer pattern for future reference
  // =========================================================================
  const storedPattern = storeAnswerPattern(
    escalation.outcome_id,
    { trigger_type: escalation.trigger_type, question_text: escalation.question_text },
    answer.selectedOption
  );

  // =========================================================================
  // Inject context and resume tasks
  // =========================================================================
  const injectedContext = `**Decision Made:** ${selectedOption.label}
${selectedOption.description}
${answer.additionalContext ? `\n**Additional Context:** ${answer.additionalContext}` : ''}
${appliedActions.length > 0 ? `\n**Actions Applied:** ${appliedActions.filter(a => a.success).map(a => a.action).join(', ')}` : ''}`;

  for (const taskId of affectedTasks) {
    // Skip tasks that were marked as failed/skipped
    const skipAction = appliedActions.find(
      a => a.action === 'skip_failing_tasks' && a.details.taskId === taskId && a.success
    );
    if (skipAction) {
      continue; // Don't inject context or resume skipped tasks
    }

    addContextInjection(escalation.outcome_id, {
      id: generateId('inj'),
      type: 'decision',
      content: injectedContext,
      source: `Escalation ${escalationId}`,
      priority: 'must_know',
      targetTaskId: taskId,
      createdAt: Date.now(),
    });

    // Resume the task (unless it was decomposed, in which case subtasks will run instead)
    const decomposeAction = appliedActions.find(
      a => a.action === 'break_into_subtasks' && a.details.taskId === taskId && a.success
    );
    if (!decomposeAction) {
      resumeTask(taskId);
    }
  }

  // Log activity with action details
  logHomrActivity({
    outcome_id: escalation.outcome_id,
    type: 'resolution',
    details: {
      escalationId,
      selectedOption: selectedOption.label,
      additionalContext: answer.additionalContext,
      resumedTasks: affectedTasks,
      appliedActions: appliedActions.map(a => ({
        action: a.action,
        success: a.success,
        taskId: a.details.taskId,
      })),
      storedPattern,
    },
    summary: `Resolved escalation: Selected "${selectedOption.label}", applied ${appliedActions.filter(a => a.success).length} action(s), resumed ${affectedTasks.length} task(s)`,
  });

  console.log(`[HOMЯ Escalator] Resolved escalation ${escalationId}: ${selectedOption.label}`);

  return {
    escalationId,
    selectedOption,
    resumedTasks: affectedTasks,
    injectedContext,
    appliedActions: appliedActions.length > 0 ? appliedActions : undefined,
    storedPattern,
  };
}

/**
 * Dismiss an escalation without answering
 */
export async function dismissEscalation(
  escalationId: string,
  reason?: string
): Promise<void> {
  const escalation = getEscalationById(escalationId);
  if (!escalation) {
    throw new Error(`Escalation not found: ${escalationId}`);
  }

  // Update status
  dismissEscalationDb(escalationId);

  // Resume affected tasks
  const affectedTasks: string[] = safeJsonParse(escalation.affected_tasks, []);
  for (const taskId of affectedTasks) {
    resumeTask(taskId);
  }

  // Log activity
  logHomrActivity({
    outcome_id: escalation.outcome_id,
    type: 'resolution',
    details: {
      escalationId,
      action: 'dismissed',
      reason,
      resumedTasks: affectedTasks,
    },
    summary: `Dismissed escalation${reason ? `: ${reason}` : ''}, resumed ${affectedTasks.length} task(s)`,
  });

  console.log(`[HOMЯ Escalator] Dismissed escalation ${escalationId}`);
}

// ============================================================================
// Escalation Queries
// ============================================================================

/**
 * Check if an outcome has pending escalations
 */
export function hasPendingEscalations(outcomeId: string): boolean {
  const pending = getPendingEscalations(outcomeId);
  return pending.length > 0;
}

/**
 * Get the count of pending escalations
 */
export function getPendingEscalationCount(outcomeId: string): number {
  const pending = getPendingEscalations(outcomeId);
  return pending.length;
}
