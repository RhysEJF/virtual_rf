/**
 * Outcome Tools
 *
 * Tools for managing outcomes.
 */

import {
  getOutcomeById,
  getAllOutcomes,
  createOutcome as dbCreateOutcome,
  getOutcomeWithRelations,
} from '../../db/outcomes';
import { getTasksByOutcome, getTaskStats, createTask } from '../../db/tasks';
import { getWorkersByOutcome } from '../../db/workers';
import { getPendingEscalations } from '../../db/homr';
import { generateBrief } from '../../agents/briefer';
import { claudeComplete } from '../../claude/client';
import type { Outcome, Task, Worker, IsolationMode } from '../../db/schema';

export interface OutcomeResult {
  found: boolean;
  outcome?: {
    id: string;
    name: string;
    status: string;
    brief: string | null;
    intent: string | null;
    createdAt: number;
    lastActivityAt: number;
    stats: {
      totalTasks: number;
      pendingTasks: number;
      completedTasks: number;
      runningTasks: number;
      failedTasks: number;
    };
    runningWorkers: number;
    pendingEscalations: number;
  };
  error?: string;
}

/**
 * Get outcome by ID or fuzzy name match
 */
export function getOutcome(identifier: string): OutcomeResult {
  // First try direct ID lookup
  let outcome = getOutcomeById(identifier);

  // If not found by ID, try fuzzy name match
  if (!outcome) {
    const allOutcomes = getAllOutcomes();
    const lowerIdentifier = identifier.toLowerCase();

    // Try exact name match first
    const exactMatch = allOutcomes.find(
      (o) => o.name.toLowerCase() === lowerIdentifier
    );
    outcome = exactMatch ?? null;

    // Then try partial match
    if (!outcome) {
      const partialMatch = allOutcomes.find((o) =>
        o.name.toLowerCase().includes(lowerIdentifier)
      );
      outcome = partialMatch ?? null;
    }
  }

  if (!outcome) {
    return {
      found: false,
      error: `Could not find outcome matching "${identifier}"`,
    };
  }

  const stats = getTaskStats(outcome.id);
  const workers = getWorkersByOutcome(outcome.id);
  const escalations = getPendingEscalations(outcome.id);

  return {
    found: true,
    outcome: {
      id: outcome.id,
      name: outcome.name,
      status: outcome.status,
      brief: outcome.brief,
      intent: outcome.intent,
      createdAt: outcome.created_at,
      lastActivityAt: outcome.last_activity_at,
      stats: {
        totalTasks: stats.total,
        pendingTasks: stats.pending,
        completedTasks: stats.completed,
        runningTasks: stats.running,
        failedTasks: stats.failed,
      },
      runningWorkers: workers.filter((w) => w.status === 'running').length,
      pendingEscalations: escalations.length,
    },
  };
}

export interface OutcomeTasksResult {
  outcomeId: string;
  outcomeName: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
    description: string | null;
  }>;
  stats: {
    total: number;
    pending: number;
    completed: number;
    running: number;
    failed: number;
  };
}

/**
 * Get tasks for an outcome with optional status filter
 */
export function getOutcomeTasks(
  outcomeId: string,
  status?: string
): OutcomeTasksResult | { error: string } {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { error: `Outcome ${outcomeId} not found` };
  }

  let tasks = getTasksByOutcome(outcomeId);

  if (status) {
    tasks = tasks.filter((t) => t.status === status);
  }

  const stats = getTaskStats(outcomeId);

  return {
    outcomeId: outcome.id,
    outcomeName: outcome.name,
    tasks: tasks.slice(0, 20).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      description: t.description,
    })),
    stats: {
      total: stats.total,
      pending: stats.pending,
      completed: stats.completed,
      running: stats.running,
      failed: stats.failed,
    },
  };
}

export interface OutcomeWorkersResult {
  outcomeId: string;
  outcomeName: string;
  workers: Array<{
    id: string;
    name: string;
    status: string;
    currentTaskId: string | null;
    iteration: number;
    lastHeartbeat: number | null;
  }>;
  runningCount: number;
  totalCount: number;
}

/**
 * Get workers for an outcome
 */
export function getOutcomeWorkers(
  outcomeId: string
): OutcomeWorkersResult | { error: string } {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { error: `Outcome ${outcomeId} not found` };
  }

  const workers = getWorkersByOutcome(outcomeId);

  return {
    outcomeId: outcome.id,
    outcomeName: outcome.name,
    workers: workers.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      currentTaskId: w.current_task_id,
      iteration: w.iteration,
      lastHeartbeat: w.last_heartbeat,
    })),
    runningCount: workers.filter((w) => w.status === 'running').length,
    totalCount: workers.length,
  };
}

export interface CreateOutcomeResult {
  success: boolean;
  outcome?: {
    id: string;
    name: string;
    objective: string;
    taskCount: number;
  };
  error?: string;
}

/**
 * Create a new outcome from a description
 */
export async function createOutcome(
  description: string,
  isolationMode?: IsolationMode
): Promise<CreateOutcomeResult> {
  try {
    // Use briefer to generate outcome structure
    const brief = await generateBrief(description);

    if (!brief) {
      return {
        success: false,
        error: 'Could not understand the request. Please provide more details.',
      };
    }

    // Create the outcome
    const outcome = dbCreateOutcome({
      name: brief.title,
      brief: description,
      intent: JSON.stringify({
        summary: brief.objective,
        items: brief.prd.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          acceptance_criteria: [],
          priority:
            item.priority <= 3 ? 'high' : item.priority <= 6 ? 'medium' : 'low',
          status: 'pending',
        })),
        success_criteria: brief.deliverables,
      }),
      isolation_mode: isolationMode, // Pass through isolation mode (undefined = use system default)
    });

    // Create tasks from PRD items
    for (const item of brief.prd) {
      createTask({
        outcome_id: outcome.id,
        title: item.title,
        description: item.description,
        prd_context: JSON.stringify(item),
        priority: item.priority * 10,
      });
    }

    return {
      success: true,
      outcome: {
        id: outcome.id,
        name: brief.title,
        objective: brief.objective,
        taskCount: brief.prd.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to create outcome',
    };
  }
}

export interface IterateResult {
  success: boolean;
  tasksCreated: number;
  taskIds: string[];
  error?: string;
}

/**
 * Add feedback to an outcome, creating new tasks
 */
export async function iterateOnOutcome(
  outcomeId: string,
  feedback: string,
  startWorker: boolean = false
): Promise<IterateResult> {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { success: false, tasksCreated: 0, taskIds: [], error: 'Outcome not found' };
  }

  try {
    // Use Claude to parse feedback into tasks
    const prompt = `Convert this feedback into specific tasks for the project "${outcome.name}":

Feedback: ${feedback}

Respond with ONLY a JSON array:
[{"title": "Task title", "description": "What to do", "priority": 1}]

Priority: 1=critical, 2=important, 3=nice-to-have`;

    const result = await claudeComplete({ prompt, timeout: 30000 });

    let tasks: Array<{ title: string; description: string; priority: number }> =
      [];
    try {
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        tasks = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fallback to single task
      tasks = [{ title: 'Address feedback', description: feedback, priority: 1 }];
    }

    // Create tasks
    const createdIds: string[] = [];
    for (const task of tasks) {
      const created = createTask({
        outcome_id: outcomeId,
        title: task.title,
        description: task.description,
        priority: task.priority || 2,
        from_review: true,
      });
      if (created) createdIds.push(created.id);
    }

    // Optionally start worker (handled by caller if needed)
    // We don't start the worker here - let the caller decide

    return {
      success: true,
      tasksCreated: createdIds.length,
      taskIds: createdIds,
    };
  } catch (error) {
    return {
      success: false,
      tasksCreated: 0,
      taskIds: [],
      error: error instanceof Error ? error.message : 'Failed to process feedback',
    };
  }
}
