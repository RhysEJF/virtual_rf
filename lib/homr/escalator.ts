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
} from '../db/homr';
import { getTaskById, updateTask, getPendingTasks } from '../db/tasks';
import { getOutcomeById } from '../db/outcomes';
import type { Task, Intent, HomrAmbiguitySignal, HomrQuestionOption, HomrDecision } from '../db/schema';
import type { EscalationAnswer, EscalationResolution } from './types';
import { buildEscalationQuestionPrompt, parseEscalationQuestionResponse } from './prompts';

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
// Escalation Resolution
// ============================================================================

/**
 * Resolve an escalation with a human answer
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
  const injectedContext = `**Decision Made:** ${selectedOption.label}
${selectedOption.description}
${answer.additionalContext ? `\n**Additional Context:** ${answer.additionalContext}` : ''}`;

  for (const taskId of affectedTasks) {
    addContextInjection(escalation.outcome_id, {
      id: generateId('inj'),
      type: 'decision',
      content: injectedContext,
      source: `Escalation ${escalationId}`,
      priority: 'must_know',
      targetTaskId: taskId,
      createdAt: Date.now(),
    });

    // Resume the task
    resumeTask(taskId);
  }

  // Log activity
  logHomrActivity({
    outcome_id: escalation.outcome_id,
    type: 'resolution',
    details: {
      escalationId,
      selectedOption: selectedOption.label,
      additionalContext: answer.additionalContext,
      resumedTasks: affectedTasks,
    },
    summary: `Resolved escalation: Selected "${selectedOption.label}", resumed ${affectedTasks.length} task(s)`,
  });

  console.log(`[HOMЯ Escalator] Resolved escalation ${escalationId}: ${selectedOption.label}`);

  return {
    escalationId,
    selectedOption,
    resumedTasks: affectedTasks,
    injectedContext,
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
