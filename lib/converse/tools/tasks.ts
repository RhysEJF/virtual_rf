/**
 * Task Tools
 *
 * Tools for managing tasks.
 */

import {
  getTaskById,
  createTask as dbCreateTask,
  getTaskStats,
  updateTask as dbUpdateTask,
} from '../../db/tasks';
import { getOutcomeById } from '../../db/outcomes';

export interface TaskResult {
  found: boolean;
  task?: {
    id: string;
    outcomeId: string;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    attempts: number;
    maxAttempts: number;
    claimedBy: string | null;
    createdAt: number;
    completedAt: number | null;
  };
  error?: string;
}

/**
 * Get details of a specific task
 */
export function getTask(taskId: string): TaskResult {
  const task = getTaskById(taskId);

  if (!task) {
    return {
      found: false,
      error: `Task ${taskId} not found`,
    };
  }

  return {
    found: true,
    task: {
      id: task.id,
      outcomeId: task.outcome_id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      attempts: task.attempts,
      maxAttempts: task.max_attempts,
      claimedBy: task.claimed_by,
      createdAt: task.created_at,
      completedAt: task.completed_at,
    },
  };
}

export interface AddTaskResult {
  success: boolean;
  task?: {
    id: string;
    title: string;
    priority: number;
  };
  outcomeStats?: {
    total: number;
    pending: number;
  };
  error?: string;
}

/**
 * Create a new task for an outcome
 */
export function addTask(
  outcomeId: string,
  title: string,
  description?: string,
  priority?: number
): AddTaskResult {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { success: false, error: `Outcome ${outcomeId} not found` };
  }

  try {
    const task = dbCreateTask({
      outcome_id: outcomeId,
      title,
      description: description,
      priority: priority ?? 100,
    });

    const stats = getTaskStats(outcomeId);

    return {
      success: true,
      task: {
        id: task.id,
        title: task.title,
        priority: task.priority,
      },
      outcomeStats: {
        total: stats.total,
        pending: stats.pending,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create task',
    };
  }
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  prd_context?: string;
  design_context?: string;
  task_intent?: string;
  task_approach?: string;
  required_skills?: string;
  priority?: number;
}

export interface UpdateTaskResult {
  success: boolean;
  task?: {
    id: string;
    title: string;
    description: string | null;
    prd_context: string | null;
    design_context: string | null;
    task_intent: string | null;
    task_approach: string | null;
    required_skills: string | null;
    priority: number;
  };
  error?: string;
}

/**
 * Update a task with new context or details
 */
export function updateTask(
  taskId: string,
  updates: UpdateTaskInput
): UpdateTaskResult {
  const existingTask = getTaskById(taskId);
  if (!existingTask) {
    return { success: false, error: `Task ${taskId} not found` };
  }

  // Ensure at least one field is being updated
  const hasUpdates = Object.values(updates).some((v) => v !== undefined);
  if (!hasUpdates) {
    return { success: false, error: 'No updates provided' };
  }

  try {
    const updated = dbUpdateTask(taskId, updates);

    if (!updated) {
      return { success: false, error: 'Failed to update task' };
    }

    return {
      success: true,
      task: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        prd_context: updated.prd_context,
        design_context: updated.design_context,
        task_intent: updated.task_intent,
        task_approach: updated.task_approach,
        required_skills: updated.required_skills,
        priority: updated.priority,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update task',
    };
  }
}
