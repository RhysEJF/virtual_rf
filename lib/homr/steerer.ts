/**
 * HOMЯ Steerer
 *
 * Modifies tasks and injects context based on observations.
 * Responsible for:
 * - Context injection into pending tasks
 * - Task modification based on discoveries
 * - Priority adjustments
 * - Corrective task creation
 */

import { generateId } from '../utils/id';
import {
  getHomrContext,
  getOrCreateHomrContext,
  updateHomrContext,
  addContextInjection,
  getDiscoveriesForTask,
  getContextInjectionsForTask,
  incrementHomrContextStat,
  logHomrActivity,
} from '../db/homr';
import { getPendingTasks, createTask, getTaskById, updateTask } from '../db/tasks';
import type {
  Task,
  HomrDiscovery,
  HomrDecision,
  HomrConstraint,
  HomrContextInjection,
  HomrDriftItem,
} from '../db/schema';
import type {
  ObservationResult,
  SteeringResult,
  AnySteeringAction,
  InjectContextAction,
  CreateTaskAction,
  TaskContext,
} from './types';
import { buildTaskContextSection } from './prompts';

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build the HOMЯ context section for a task's CLAUDE.md
 * This is called when a task is about to start
 */
export function buildTaskContext(taskId: string, outcomeId: string): string {
  const context = getHomrContext(outcomeId);
  if (!context) {
    return '';
  }

  // Get discoveries relevant to this task
  const discoveries = getDiscoveriesForTask(outcomeId, taskId);

  // Get injections for this task
  const injections = getContextInjectionsForTask(outcomeId, taskId);

  // Parse decisions and constraints
  const decisions: HomrDecision[] = JSON.parse(context.decisions);
  const constraints: HomrConstraint[] = JSON.parse(context.constraints);

  // If no context to inject, return empty
  if (discoveries.length === 0 && injections.length === 0 &&
      decisions.length === 0 && constraints.length === 0) {
    return '';
  }

  // Build the context section using the prompt builder
  return buildTaskContextSection(discoveries, decisions, constraints);
}

/**
 * Get full task context including injections
 */
export function getTaskContext(taskId: string, outcomeId: string): TaskContext {
  const context = getHomrContext(outcomeId);
  if (!context) {
    return {
      discoveries: [],
      injections: [],
      decisions: [],
      constraints: [],
    };
  }

  return {
    discoveries: getDiscoveriesForTask(outcomeId, taskId),
    injections: getContextInjectionsForTask(outcomeId, taskId),
    decisions: JSON.parse(context.decisions),
    constraints: JSON.parse(context.constraints).filter((c: HomrConstraint) => c.active),
  };
}

// ============================================================================
// Steering Actions
// ============================================================================

/**
 * Steer based on an observation result
 * This is called after observeTask() completes
 */
export async function steer(observation: ObservationResult): Promise<SteeringResult> {
  const actions: AnySteeringAction[] = [];
  const { outcomeId, drift, discoveries } = observation;

  // Handle drift - high severity drift creates corrective tasks
  for (const driftItem of drift) {
    if (driftItem.severity === 'high') {
      const action = createCorrectiveTaskAction(outcomeId, driftItem, observation.taskId);
      actions.push(action);
    } else {
      // Lower severity drift - inject warning to pending tasks
      const warningAction = createDriftWarningAction(outcomeId, driftItem, observation.taskId);
      actions.push(warningAction);
    }
  }

  // Share discoveries with relevant tasks
  for (const discovery of discoveries) {
    if (discovery.relevantTasks.length > 0) {
      const action = createDiscoveryInjectionAction(outcomeId, discovery);
      actions.push(action);
    }
  }

  // Execute all actions
  for (const action of actions) {
    await executeSteeringAction(action, outcomeId);
  }

  // Log steering activity
  if (actions.length > 0) {
    incrementHomrContextStat(outcomeId, 'steering_actions');

    logHomrActivity({
      outcome_id: outcomeId,
      type: 'steering',
      details: {
        observationId: observation.taskId,
        actionCount: actions.length,
        actions: actions.map(a => ({ type: a.type, reason: a.reason })),
      },
      summary: `Executed ${actions.length} steering action(s) after observing task ${observation.taskId}`,
    });
  }

  return {
    actions,
    summary: actions.length > 0
      ? `Executed ${actions.length} steering action(s)`
      : 'No steering actions needed',
  };
}

/**
 * Create action for corrective task
 */
function createCorrectiveTaskAction(
  outcomeId: string,
  drift: HomrDriftItem,
  sourceTaskId: string
): CreateTaskAction {
  return {
    type: 'create_task',
    reason: `High severity drift detected: ${drift.description}`,
    timestamp: Date.now(),
    task: {
      title: `Fix: ${drift.description.substring(0, 50)}`,
      description: `**Corrective Task Created by HOMЯ**

This task was automatically created to address drift detected in task ${sourceTaskId}.

**Drift Type:** ${drift.type}
**Severity:** ${drift.severity}
**Description:** ${drift.description}

**Evidence:**
> ${drift.evidence}

Please review the original work and make corrections as needed.`,
      priority: 1, // High priority
    },
  };
}

/**
 * Create action for drift warning injection
 */
function createDriftWarningAction(
  outcomeId: string,
  drift: HomrDriftItem,
  sourceTaskId: string
): InjectContextAction {
  const pendingTasks = getPendingTasks(outcomeId);

  return {
    type: 'inject_context',
    reason: `Warning about ${drift.severity} severity drift`,
    timestamp: Date.now(),
    taskIds: pendingTasks.map(t => t.id),
    context: {
      id: generateId('inj'),
      type: 'warning',
      content: `**Drift Detected in Previous Task:** ${drift.description}\n\nPlease ensure your work stays aligned with the original intent.`,
      source: sourceTaskId,
      priority: drift.severity === 'medium' ? 'should_know' : 'nice_to_know',
      targetTaskId: '*', // All tasks
      createdAt: Date.now(),
    },
  };
}

/**
 * Create action for discovery injection
 */
function createDiscoveryInjectionAction(
  outcomeId: string,
  discovery: HomrDiscovery
): InjectContextAction {
  const priority: 'must_know' | 'should_know' | 'nice_to_know' =
    discovery.type === 'blocker' ? 'must_know' :
    discovery.type === 'constraint' || discovery.type === 'dependency' ? 'should_know' :
    'nice_to_know';

  return {
    type: 'inject_context',
    reason: `Share ${discovery.type} discovery with relevant tasks`,
    timestamp: Date.now(),
    taskIds: discovery.relevantTasks,
    context: {
      id: generateId('inj'),
      type: 'discovery',
      content: discovery.content,
      source: discovery.source,
      priority,
      targetTaskId: discovery.relevantTasks.includes('*') ? '*' : discovery.relevantTasks[0],
      createdAt: Date.now(),
    },
  };
}

/**
 * Execute a steering action
 */
async function executeSteeringAction(action: AnySteeringAction, outcomeId: string): Promise<void> {
  switch (action.type) {
    case 'inject_context': {
      const injectAction = action as InjectContextAction;

      // If targeting all tasks, use '*'
      if (injectAction.taskIds.includes('*') || injectAction.context.targetTaskId === '*') {
        addContextInjection(outcomeId, {
          ...injectAction.context,
          targetTaskId: '*',
        });
      } else {
        // Add injection for each specific task
        for (const taskId of injectAction.taskIds) {
          addContextInjection(outcomeId, {
            ...injectAction.context,
            id: generateId('inj'),
            targetTaskId: taskId,
          });
        }
      }
      console.log(`[HOMЯ Steerer] Injected context to ${injectAction.taskIds.length} task(s)`);
      break;
    }

    case 'create_task': {
      const createAction = action as CreateTaskAction;
      createTask({
        outcome_id: outcomeId,
        title: createAction.task.title,
        description: createAction.task.description,
        priority: createAction.task.priority,
        phase: createAction.task.phase || 'execution',
      });
      console.log(`[HOMЯ Steerer] Created corrective task: ${createAction.task.title}`);
      break;
    }

    case 'update_task': {
      // Update task description
      const task = getTaskById(action.taskId);
      if (task) {
        const newDescription = task.description
          ? `${task.description}\n\n---\n\n**HOMЯ Update:**\n${action.additions}`
          : `**HOMЯ Update:**\n${action.additions}`;
        updateTask(action.taskId, { description: newDescription });
        console.log(`[HOMЯ Steerer] Updated task ${action.taskId} description`);
      }
      break;
    }

    case 'update_priority': {
      updateTask(action.taskId, { priority: action.newPriority });
      console.log(`[HOMЯ Steerer] Updated task ${action.taskId} priority to ${action.newPriority}`);
      break;
    }

    case 'mark_obsolete': {
      // We don't have a status for obsolete, so we'll just update the description
      const task = getTaskById(action.taskId);
      if (task) {
        updateTask(action.taskId, {
          description: `**MARKED OBSOLETE BY HOMЯ:**\n${action.reason}\n\n---\n\n${task.description || ''}`,
        });
        console.log(`[HOMЯ Steerer] Marked task ${action.taskId} as obsolete`);
      }
      break;
    }
  }
}

// ============================================================================
// Context Compaction
// ============================================================================

/**
 * Compact the context store to prevent unbounded growth
 */
export function compactContext(outcomeId: string, maxDiscoveries: number = 50): void {
  const context = getHomrContext(outcomeId);
  if (!context) return;

  const discoveries: HomrDiscovery[] = JSON.parse(context.discoveries);

  if (discoveries.length <= maxDiscoveries) {
    return; // No compaction needed
  }

  // Score discoveries by relevance (blockers and recent items score higher)
  const scored = discoveries.map((d, index) => ({
    discovery: d,
    score: calculateRelevanceScore(d, index, discoveries.length),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Keep top discoveries
  const kept = scored.slice(0, maxDiscoveries).map(s => s.discovery);

  // Create summary of compacted discoveries
  const compacted = scored.slice(maxDiscoveries);
  if (compacted.length > 0) {
    const summaryDiscovery: HomrDiscovery = {
      type: 'pattern',
      content: `[Compacted ${compacted.length} earlier discoveries] Including: ${
        compacted.slice(0, 3).map(c => c.discovery.content.substring(0, 50)).join('; ')
      }...`,
      relevantTasks: ['*'],
      source: 'HOMЯ Compaction',
    };
    kept.push(summaryDiscovery);
  }

  // Update context store
  updateHomrContext(outcomeId, { discoveries: kept });

  console.log(`[HOMЯ Steerer] Compacted context: ${discoveries.length} -> ${kept.length} discoveries`);

  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'context_compaction',
      before: discoveries.length,
      after: kept.length,
      compacted: compacted.length,
    },
    summary: `Compacted ${compacted.length} discoveries to maintain context size`,
  });
}

/**
 * Calculate relevance score for a discovery
 */
function calculateRelevanceScore(
  discovery: HomrDiscovery,
  index: number,
  total: number
): number {
  let score = 0;

  // Type priority (blockers are most important)
  const typePriority: Record<string, number> = {
    blocker: 100,
    constraint: 80,
    dependency: 70,
    decision: 60,
    pattern: 40,
  };
  score += typePriority[discovery.type] || 30;

  // Recency (newer items score higher)
  const recencyScore = (index / total) * 50;
  score += recencyScore;

  // Relevance to all tasks scores higher
  if (discovery.relevantTasks.includes('*')) {
    score += 20;
  }

  return score;
}

// ============================================================================
// Decision Management
// ============================================================================

/**
 * Add a decision to the context store
 */
export function recordDecision(
  outcomeId: string,
  content: string,
  madeBy: 'human' | 'worker' | 'homr',
  context: string,
  affectedAreas: string[] = []
): void {
  const contextStore = getOrCreateHomrContext(outcomeId);
  const decisions: HomrDecision[] = JSON.parse(contextStore.decisions);

  decisions.push({
    id: generateId('dec'),
    content,
    madeBy,
    madeAt: Date.now(),
    context,
    affectedAreas,
  });

  updateHomrContext(outcomeId, { decisions });

  console.log(`[HOMЯ Steerer] Recorded decision: ${content.substring(0, 50)}...`);
}

/**
 * Add a constraint to the context store
 */
export function recordConstraint(
  outcomeId: string,
  type: HomrConstraint['type'],
  content: string,
  source: string
): void {
  const contextStore = getOrCreateHomrContext(outcomeId);
  const constraints: HomrConstraint[] = JSON.parse(contextStore.constraints);

  constraints.push({
    id: generateId('con'),
    type,
    content,
    discoveredAt: Date.now(),
    source,
    active: true,
  });

  updateHomrContext(outcomeId, { constraints });

  console.log(`[HOMЯ Steerer] Recorded constraint: ${content.substring(0, 50)}...`);
}

/**
 * Deactivate a constraint
 */
export function deactivateConstraint(outcomeId: string, constraintId: string): void {
  const contextStore = getHomrContext(outcomeId);
  if (!contextStore) return;

  const constraints: HomrConstraint[] = JSON.parse(contextStore.constraints);
  const constraint = constraints.find(c => c.id === constraintId);

  if (constraint) {
    constraint.active = false;
    updateHomrContext(outcomeId, { constraints });
    console.log(`[HOMЯ Steerer] Deactivated constraint: ${constraintId}`);
  }
}
