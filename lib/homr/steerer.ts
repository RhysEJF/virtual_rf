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

// ============================================================================
// Dependency Graph Management
// ============================================================================

/**
 * Result of a dependency modification operation
 */
export interface DependencyModificationResult {
  success: boolean;
  taskId?: string;
  affectedTasks: string[];
  reason?: string;
}

/**
 * Insert a corrective task that blocks a target task.
 * The corrective task becomes a dependency of the target task,
 * meaning the target cannot proceed until the corrective task completes.
 *
 * @param outcomeId - The outcome to create the task in
 * @param title - Title of the corrective task
 * @param description - Description of what needs to be corrected
 * @param targetTaskId - The task that should be blocked until correction completes
 * @param priority - Priority of the corrective task (default 1 = high)
 * @returns Result including the new task ID and affected tasks
 */
export function insertCorrectiveTask(
  outcomeId: string,
  title: string,
  description: string,
  targetTaskId: string,
  priority: number = 1
): DependencyModificationResult {
  // Verify target task exists
  const targetTask = getTaskById(targetTaskId);
  if (!targetTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Target task ${targetTaskId} not found`,
    };
  }

  // Verify target task belongs to this outcome
  if (targetTask.outcome_id !== outcomeId) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Target task ${targetTaskId} does not belong to outcome ${outcomeId}`,
    };
  }

  // Create the corrective task
  const correctiveTask = createTask({
    outcome_id: outcomeId,
    title,
    description: `**Corrective Task Created by HOMЯ**\n\n${description}\n\n**Blocks:** ${targetTask.title}`,
    priority,
    phase: targetTask.phase, // Same phase as target
  });

  // Add the corrective task as a dependency of the target task
  const addResult = addDependency(targetTaskId, correctiveTask.id);

  if (!addResult.success) {
    // Rollback: we could delete the task, but leaving it is safer
    console.log(`[HOMЯ Steerer] Warning: Created corrective task but failed to add dependency: ${addResult.reason}`);
  }

  // Log the activity
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'insert_corrective_task',
      correctiveTaskId: correctiveTask.id,
      targetTaskId,
      title,
    },
    summary: `Inserted corrective task "${title}" blocking task ${targetTaskId}`,
  });

  console.log(`[HOMЯ Steerer] Inserted corrective task ${correctiveTask.id} blocking ${targetTaskId}`);

  return {
    success: true,
    taskId: correctiveTask.id,
    affectedTasks: [correctiveTask.id, targetTaskId],
  };
}

/**
 * Add a dependency from one task to another.
 * After this operation, dependentTaskId cannot be claimed until dependencyTaskId completes.
 *
 * @param dependentTaskId - The task that should wait (will have a new dependency)
 * @param dependencyTaskId - The task that must complete first (the dependency)
 * @returns Result of the operation
 */
export function addDependency(
  dependentTaskId: string,
  dependencyTaskId: string
): DependencyModificationResult {
  // Get both tasks
  const dependentTask = getTaskById(dependentTaskId);
  const dependencyTask = getTaskById(dependencyTaskId);

  if (!dependentTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Dependent task ${dependentTaskId} not found`,
    };
  }

  if (!dependencyTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Dependency task ${dependencyTaskId} not found`,
    };
  }

  // Prevent self-dependency
  if (dependentTaskId === dependencyTaskId) {
    return {
      success: false,
      affectedTasks: [],
      reason: 'A task cannot depend on itself',
    };
  }

  // Verify both tasks belong to the same outcome
  if (dependentTask.outcome_id !== dependencyTask.outcome_id) {
    return {
      success: false,
      affectedTasks: [],
      reason: 'Tasks must belong to the same outcome to create a dependency',
    };
  }

  // Parse existing dependencies
  let existingDeps: string[] = [];
  if (dependentTask.depends_on) {
    try {
      existingDeps = JSON.parse(dependentTask.depends_on);
      if (!Array.isArray(existingDeps)) {
        existingDeps = [];
      }
    } catch {
      existingDeps = [];
    }
  }

  // Check if dependency already exists
  if (existingDeps.includes(dependencyTaskId)) {
    return {
      success: true, // Already exists, not an error
      affectedTasks: [dependentTaskId],
      reason: 'Dependency already exists',
    };
  }

  // Check for circular dependency
  if (wouldCreateCircularDependency(dependentTaskId, dependencyTaskId)) {
    return {
      success: false,
      affectedTasks: [],
      reason: 'Adding this dependency would create a circular dependency',
    };
  }

  // Add the new dependency
  existingDeps.push(dependencyTaskId);

  // Update the task
  updateTask(dependentTaskId, { depends_on: existingDeps });

  console.log(`[HOMЯ Steerer] Added dependency: ${dependentTaskId} now depends on ${dependencyTaskId}`);

  return {
    success: true,
    affectedTasks: [dependentTaskId],
  };
}

/**
 * Check if adding a dependency would create a circular dependency.
 * This traverses the dependency graph from dependencyTaskId to see if
 * we can reach dependentTaskId (which would indicate a cycle).
 */
function wouldCreateCircularDependency(dependentTaskId: string, dependencyTaskId: string): boolean {
  const visited = new Set<string>();
  const queue = [dependencyTaskId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (currentId === dependentTaskId) {
      return true; // Found a cycle
    }

    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    // Get this task's dependencies
    const task = getTaskById(currentId);
    if (!task || !task.depends_on) {
      continue;
    }

    try {
      const deps = JSON.parse(task.depends_on);
      if (Array.isArray(deps)) {
        for (const depId of deps) {
          if (!visited.has(depId)) {
            queue.push(depId);
          }
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return false;
}

/**
 * Block a chain of tasks by adding a blocker task as a dependency to all of them.
 * This is useful when a fundamental issue is discovered that affects multiple downstream tasks.
 *
 * @param outcomeId - The outcome containing the tasks
 * @param blockerTaskId - The task that must complete first (already exists or newly created)
 * @param taskIdsToBlock - Array of task IDs that should be blocked
 * @returns Result including all affected tasks
 */
export function blockTaskChain(
  outcomeId: string,
  blockerTaskId: string,
  taskIdsToBlock: string[]
): DependencyModificationResult {
  // Verify blocker task exists
  const blockerTask = getTaskById(blockerTaskId);
  if (!blockerTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Blocker task ${blockerTaskId} not found`,
    };
  }

  // Verify blocker task belongs to this outcome
  if (blockerTask.outcome_id !== outcomeId) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Blocker task ${blockerTaskId} does not belong to outcome ${outcomeId}`,
    };
  }

  const affectedTasks: string[] = [];
  const errors: string[] = [];

  for (const taskId of taskIdsToBlock) {
    // Skip if trying to block the blocker itself
    if (taskId === blockerTaskId) {
      continue;
    }

    const result = addDependency(taskId, blockerTaskId);
    if (result.success) {
      affectedTasks.push(taskId);
    } else {
      errors.push(`${taskId}: ${result.reason}`);
    }
  }

  // Log the activity
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'block_task_chain',
      blockerTaskId,
      blockedTasks: affectedTasks,
      errors: errors.length > 0 ? errors : undefined,
    },
    summary: `Blocked ${affectedTasks.length} task(s) with blocker task ${blockerTaskId}`,
  });

  if (affectedTasks.length > 0) {
    console.log(`[HOMЯ Steerer] Blocked ${affectedTasks.length} tasks with blocker ${blockerTaskId}`);
  }

  return {
    success: affectedTasks.length > 0 || errors.length === 0,
    affectedTasks,
    reason: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Remove a dependency from a task.
 * After this operation, dependentTaskId no longer waits for dependencyTaskId.
 *
 * @param dependentTaskId - The task to remove the dependency from
 * @param dependencyTaskId - The dependency to remove
 * @returns Result of the operation
 */
export function removeDependency(
  dependentTaskId: string,
  dependencyTaskId: string
): DependencyModificationResult {
  const dependentTask = getTaskById(dependentTaskId);

  if (!dependentTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Task ${dependentTaskId} not found`,
    };
  }

  // Parse existing dependencies
  let existingDeps: string[] = [];
  if (dependentTask.depends_on) {
    try {
      existingDeps = JSON.parse(dependentTask.depends_on);
      if (!Array.isArray(existingDeps)) {
        existingDeps = [];
      }
    } catch {
      existingDeps = [];
    }
  }

  // Check if dependency exists
  const index = existingDeps.indexOf(dependencyTaskId);
  if (index === -1) {
    return {
      success: true, // Already doesn't exist
      affectedTasks: [dependentTaskId],
      reason: 'Dependency does not exist',
    };
  }

  // Remove the dependency
  existingDeps.splice(index, 1);

  // Update the task
  updateTask(dependentTaskId, { depends_on: existingDeps });

  console.log(`[HOMЯ Steerer] Removed dependency: ${dependentTaskId} no longer depends on ${dependencyTaskId}`);

  return {
    success: true,
    affectedTasks: [dependentTaskId],
  };
}

/**
 * Get all tasks that are directly blocked by a given task.
 * These are tasks that have the given task as a dependency.
 *
 * @param taskId - The task to check for dependents
 * @returns Array of task IDs that depend on this task
 */
export function getTasksDependingOn(taskId: string): string[] {
  const task = getTaskById(taskId);
  if (!task) return [];

  const allTasks = getPendingTasks(task.outcome_id);
  const dependents: string[] = [];

  for (const t of allTasks) {
    if (!t.depends_on) continue;

    try {
      const deps = JSON.parse(t.depends_on);
      if (Array.isArray(deps) && deps.includes(taskId)) {
        dependents.push(t.id);
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return dependents;
}
