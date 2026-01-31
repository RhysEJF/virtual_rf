/**
 * Task Dependency Validation Utilities
 *
 * Functions for validating and managing task dependencies:
 * - validateDependencies: Check all dependencies exist and belong to same outcome
 * - detectCircularDependency: Prevent dependency cycles
 * - getBlockingTasks: Return incomplete dependencies for a task
 */

import { getDb } from './index';
import type { Task, TaskStatus } from './schema';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BlockingTask {
  id: string;
  title: string;
  status: TaskStatus;
}

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Parse the depends_on JSON array from a task
 * Returns empty array if null, undefined, or invalid JSON
 */
export function parseDependsOn(dependsOn: string | null | undefined): string[] {
  if (!dependsOn) return [];
  try {
    const parsed = JSON.parse(dependsOn);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/**
 * Validate that all dependency task IDs exist and belong to the same outcome.
 *
 * @param outcomeId - The outcome ID that the task belongs to
 * @param dependencyIds - Array of task IDs that this task depends on
 * @returns ValidationResult with valid flag and any error messages
 */
export function validateDependencies(
  outcomeId: string,
  dependencyIds: string[]
): ValidationResult {
  const errors: string[] = [];

  if (dependencyIds.length === 0) {
    return { valid: true, errors: [] };
  }

  const db = getDb();

  // Check each dependency exists and belongs to the same outcome
  for (const depId of dependencyIds) {
    const task = db.prepare(`
      SELECT id, outcome_id, title FROM tasks WHERE id = ?
    `).get(depId) as { id: string; outcome_id: string; title: string } | undefined;

    if (!task) {
      errors.push(`Dependency task '${depId}' does not exist`);
    } else if (task.outcome_id !== outcomeId) {
      errors.push(
        `Dependency task '${depId}' (${task.title}) belongs to a different outcome`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate dependencies for an existing task by its ID.
 * Convenience wrapper that fetches the task's outcome_id automatically.
 *
 * @param taskId - The task ID to validate dependencies for
 * @param dependencyIds - Array of task IDs that this task would depend on
 * @returns ValidationResult with valid flag and any error messages
 */
export function validateDependenciesForTask(
  taskId: string,
  dependencyIds: string[]
): ValidationResult {
  const db = getDb();
  const task = db.prepare('SELECT outcome_id FROM tasks WHERE id = ?').get(taskId) as { outcome_id: string } | undefined;

  if (!task) {
    return {
      valid: false,
      errors: [`Task '${taskId}' does not exist`],
    };
  }

  // Don't allow self-dependency
  if (dependencyIds.includes(taskId)) {
    return {
      valid: false,
      errors: ['A task cannot depend on itself'],
    };
  }

  return validateDependencies(task.outcome_id, dependencyIds);
}

// ============================================================================
// Circular Dependency Detection
// ============================================================================

/**
 * Detect if adding a dependency would create a circular dependency.
 * Uses depth-first search to traverse the dependency graph.
 *
 * @param taskId - The task that would have the new dependency
 * @param newDependencyId - The task ID to add as a dependency
 * @returns true if adding this dependency would create a cycle
 */
export function detectCircularDependency(
  taskId: string,
  newDependencyId: string
): boolean {
  // Self-dependency is always circular
  if (taskId === newDependencyId) {
    return true;
  }

  const db = getDb();

  // Get all tasks' dependencies for the outcome (for efficient traversal)
  const task = db.prepare('SELECT outcome_id FROM tasks WHERE id = ?').get(taskId) as { outcome_id: string } | undefined;
  if (!task) return false;

  // Build a map of taskId -> dependencyIds for the entire outcome
  const allTasks = db.prepare(`
    SELECT id, depends_on FROM tasks WHERE outcome_id = ?
  `).all(task.outcome_id) as { id: string; depends_on: string | null }[];

  const dependencyMap = new Map<string, string[]>();
  for (const t of allTasks) {
    dependencyMap.set(t.id, parseDependsOn(t.depends_on));
  }

  // Add the proposed new dependency temporarily
  const currentDeps = dependencyMap.get(taskId) || [];
  dependencyMap.set(taskId, [...currentDeps, newDependencyId]);

  // DFS to detect cycle starting from taskId
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (recursionStack.has(nodeId)) {
      return true; // Found a cycle
    }
    if (visited.has(nodeId)) {
      return false; // Already fully explored, no cycle from here
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const deps = dependencyMap.get(nodeId) || [];
    for (const depId of deps) {
      if (hasCycle(depId)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  return hasCycle(taskId);
}

/**
 * Detect if a set of dependencies would create any circular dependencies.
 * Checks the entire proposed dependency set at once.
 *
 * @param taskId - The task that would have the new dependencies
 * @param dependencyIds - Array of task IDs to check as dependencies
 * @returns Array of dependency IDs that would create cycles (empty if none)
 */
export function detectCircularDependencies(
  taskId: string,
  dependencyIds: string[]
): string[] {
  const circularIds: string[] = [];

  for (const depId of dependencyIds) {
    if (detectCircularDependency(taskId, depId)) {
      circularIds.push(depId);
    }
  }

  return circularIds;
}

// ============================================================================
// Blocking Task Queries
// ============================================================================

/**
 * Get all incomplete dependency tasks that are blocking a task from being claimed.
 * A task is blocked if any of its dependencies are not in 'completed' status.
 *
 * @param taskId - The task ID to check blocking dependencies for
 * @returns Array of blocking tasks with their id, title, and status
 */
export function getBlockingTasks(taskId: string): BlockingTask[] {
  const db = getDb();

  const task = db.prepare('SELECT depends_on FROM tasks WHERE id = ?').get(taskId) as { depends_on: string | null } | undefined;
  if (!task) return [];

  const dependencyIds = parseDependsOn(task.depends_on);
  if (dependencyIds.length === 0) return [];

  const blockingTasks: BlockingTask[] = [];

  for (const depId of dependencyIds) {
    const depTask = db.prepare(`
      SELECT id, title, status FROM tasks WHERE id = ?
    `).get(depId) as { id: string; title: string; status: TaskStatus } | undefined;

    if (depTask && depTask.status !== 'completed') {
      blockingTasks.push({
        id: depTask.id,
        title: depTask.title,
        status: depTask.status,
      });
    }
  }

  return blockingTasks;
}

/**
 * Check if a task is blocked by any incomplete dependencies.
 *
 * @param taskId - The task ID to check
 * @returns true if the task has any incomplete dependencies
 */
export function isTaskBlocked(taskId: string): boolean {
  return getBlockingTasks(taskId).length > 0;
}

/**
 * Get all tasks in an outcome that are ready to be claimed
 * (pending status and no blocking dependencies).
 *
 * @param outcomeId - The outcome ID to get claimable tasks for
 * @returns Array of tasks that can be claimed
 */
export function getClaimableTasks(outcomeId: string): Task[] {
  const db = getDb();

  const pendingTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE outcome_id = ? AND status = 'pending'
    ORDER BY priority ASC, score DESC
  `).all(outcomeId) as Task[];

  return pendingTasks.filter(task => !isTaskBlocked(task.id));
}

/**
 * Get all tasks in an outcome that are blocked by dependencies.
 *
 * @param outcomeId - The outcome ID to get blocked tasks for
 * @returns Array of objects with task and its blocking dependencies
 */
export function getBlockedTasks(outcomeId: string): { task: Task; blockedBy: BlockingTask[] }[] {
  const db = getDb();

  const pendingTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE outcome_id = ? AND status = 'pending'
    ORDER BY priority ASC, score DESC
  `).all(outcomeId) as Task[];

  const blockedTasks: { task: Task; blockedBy: BlockingTask[] }[] = [];

  for (const task of pendingTasks) {
    const blockedBy = getBlockingTasks(task.id);
    if (blockedBy.length > 0) {
      blockedTasks.push({ task, blockedBy });
    }
  }

  return blockedTasks;
}

// ============================================================================
// Dependency Graph Utilities
// ============================================================================

/**
 * Get the full dependency chain for a task (all transitive dependencies).
 * Uses breadth-first traversal to get all dependencies recursively.
 *
 * @param taskId - The task ID to get dependency chain for
 * @returns Array of all task IDs in the dependency chain (ordered by depth)
 */
export function getDependencyChain(taskId: string): string[] {
  const db = getDb();
  const visited = new Set<string>();
  const chain: string[] = [];
  const queue: string[] = [];

  const task = db.prepare('SELECT depends_on FROM tasks WHERE id = ?').get(taskId) as { depends_on: string | null } | undefined;
  if (!task) return [];

  // Initialize queue with direct dependencies
  const directDeps = parseDependsOn(task.depends_on);
  queue.push(...directDeps);

  while (queue.length > 0) {
    const depId = queue.shift()!;
    if (visited.has(depId)) continue;

    visited.add(depId);
    chain.push(depId);

    // Get this task's dependencies and add to queue
    const depTask = db.prepare('SELECT depends_on FROM tasks WHERE id = ?').get(depId) as { depends_on: string | null } | undefined;
    if (depTask) {
      const transitiveDeps = parseDependsOn(depTask.depends_on);
      for (const transDepId of transitiveDeps) {
        if (!visited.has(transDepId)) {
          queue.push(transDepId);
        }
      }
    }
  }

  return chain;
}

/**
 * Get all tasks that depend on a given task (reverse dependencies).
 * Useful for understanding impact when a task changes status.
 *
 * @param taskId - The task ID to find dependents for
 * @returns Array of task IDs that depend on this task
 */
export function getDependentTasks(taskId: string): string[] {
  const db = getDb();

  // Get outcome for this task
  const task = db.prepare('SELECT outcome_id FROM tasks WHERE id = ?').get(taskId) as { outcome_id: string } | undefined;
  if (!task) return [];

  // Find all tasks in the same outcome that have this task in their depends_on
  const allTasks = db.prepare(`
    SELECT id, depends_on FROM tasks WHERE outcome_id = ?
  `).all(task.outcome_id) as { id: string; depends_on: string | null }[];

  const dependents: string[] = [];

  for (const t of allTasks) {
    const deps = parseDependsOn(t.depends_on);
    if (deps.includes(taskId)) {
      dependents.push(t.id);
    }
  }

  return dependents;
}
