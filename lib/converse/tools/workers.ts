/**
 * Worker Tools
 *
 * Tools for managing workers.
 */

import {
  getActiveWorkers as dbGetActiveWorkers,
  getWorkersByOutcome,
  getWorkerById,
} from '../../db/workers';
import { getOutcomeById } from '../../db/outcomes';
import { getTaskStats, getTaskById } from '../../db/tasks';
import { getProgressEntriesByWorker } from '../../db/progress';
import {
  startRalphWorker,
  stopRalphWorker,
} from '../../ralph/worker';

export interface ActiveWorkersResult {
  count: number;
  workers: Array<{
    id: string;
    name: string;
    outcomeId: string;
    outcomeName: string;
    status: string;
    currentTaskId: string | null;
    iteration: number;
    lastHeartbeat: number | null;
  }>;
}

/**
 * Get all currently running workers
 */
export function getActiveWorkers(): ActiveWorkersResult {
  const workers = dbGetActiveWorkers();

  const workersWithOutcome = workers.map((worker) => {
    const outcome = getOutcomeById(worker.outcome_id);
    return {
      id: worker.id,
      name: worker.name,
      outcomeId: worker.outcome_id,
      outcomeName: outcome?.name || 'Unknown',
      status: worker.status,
      currentTaskId: worker.current_task_id,
      iteration: worker.iteration,
      lastHeartbeat: worker.last_heartbeat,
    };
  });

  return {
    count: workers.length,
    workers: workersWithOutcome,
  };
}

export interface StartWorkerResult {
  success: boolean;
  workerId?: string;
  outcomeName?: string;
  pendingTasks?: number;
  error?: string;
}

/**
 * Start a worker for an outcome
 */
export async function startWorker(outcomeId: string): Promise<StartWorkerResult> {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { success: false, error: `Outcome ${outcomeId} not found` };
  }

  const stats = getTaskStats(outcomeId);
  if (stats.pending === 0) {
    return {
      success: false,
      error: `No pending tasks for "${outcome.name}". Nothing to work on.`,
    };
  }

  try {
    const result = await startRalphWorker({ outcomeId });

    if (!result.started) {
      return {
        success: false,
        error: result.error || 'Failed to start worker',
      };
    }

    return {
      success: true,
      workerId: result.workerId,
      outcomeName: outcome.name,
      pendingTasks: stats.pending,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start worker',
    };
  }
}

export interface StopWorkerResult {
  success: boolean;
  stoppedCount: number;
  error?: string;
}

/**
 * Stop worker(s) by worker ID or outcome ID
 */
export function stopWorker(
  workerId?: string,
  outcomeId?: string
): StopWorkerResult {
  // Stop specific worker
  if (workerId) {
    const worker = getWorkerById(workerId);
    if (!worker) {
      return { success: false, stoppedCount: 0, error: `Worker ${workerId} not found` };
    }

    const stopped = stopRalphWorker(workerId);
    return {
      success: stopped,
      stoppedCount: stopped ? 1 : 0,
      error: stopped ? undefined : 'Could not stop worker',
    };
  }

  // Stop all workers for an outcome
  if (outcomeId) {
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return { success: false, stoppedCount: 0, error: `Outcome ${outcomeId} not found` };
    }

    const workers = getWorkersByOutcome(outcomeId);
    const runningWorkers = workers.filter((w) => w.status === 'running');

    if (runningWorkers.length === 0) {
      return {
        success: true,
        stoppedCount: 0,
        error: 'No running workers for this outcome',
      };
    }

    let stoppedCount = 0;
    for (const worker of runningWorkers) {
      if (stopRalphWorker(worker.id)) {
        stoppedCount++;
      }
    }

    return {
      success: stoppedCount > 0,
      stoppedCount,
    };
  }

  return {
    success: false,
    stoppedCount: 0,
    error: 'Must specify either worker_id or outcome_id',
  };
}

// ============================================================================
// Worker Details
// ============================================================================

export interface WorkerDetailsResult {
  found: boolean;
  worker?: {
    id: string;
    name: string;
    status: string;
    outcomeId: string;
    outcomeName: string;
    currentTask: {
      id: string;
      title: string;
      status: string;
    } | null;
    iteration: number;
    progressSummary: string | null;
    lastHeartbeat: number | null;
    startedAt: number | null;
    cost: number;
  };
  error?: string;
}

/**
 * Get detailed information about a specific worker
 */
export function getWorkerDetails(workerId: string): WorkerDetailsResult {
  const worker = getWorkerById(workerId);

  if (!worker) {
    return {
      found: false,
      error: `Worker ${workerId} not found`,
    };
  }

  const outcome = getOutcomeById(worker.outcome_id);
  let currentTask = null;

  if (worker.current_task_id) {
    const task = getTaskById(worker.current_task_id);
    if (task) {
      currentTask = {
        id: task.id,
        title: task.title,
        status: task.status,
      };
    }
  }

  return {
    found: true,
    worker: {
      id: worker.id,
      name: worker.name,
      status: worker.status,
      outcomeId: worker.outcome_id,
      outcomeName: outcome?.name || 'Unknown',
      currentTask,
      iteration: worker.iteration,
      progressSummary: worker.progress_summary,
      lastHeartbeat: worker.last_heartbeat,
      startedAt: worker.started_at,
      cost: worker.cost,
    },
  };
}

// ============================================================================
// Worker Progress / Logs
// ============================================================================

export interface WorkerProgressResult {
  found: boolean;
  workerId?: string;
  workerName?: string;
  outcomeName?: string;
  totalEntries?: number;
  recentEntries?: Array<{
    iteration: number;
    content: string;
    createdAt: number;
  }>;
  error?: string;
}

/**
 * Get recent progress entries for a worker
 */
export function getWorkerProgress(workerId: string): WorkerProgressResult {
  const worker = getWorkerById(workerId);

  if (!worker) {
    return {
      found: false,
      error: `Worker ${workerId} not found`,
    };
  }

  const outcome = getOutcomeById(worker.outcome_id);
  const entries = getProgressEntriesByWorker(workerId);

  // Get the most recent entries (last 5)
  const recentEntries = entries
    .slice(-5)
    .reverse()
    .map((entry) => ({
      iteration: entry.iteration,
      content: entry.content.length > 500
        ? entry.content.substring(0, 500) + '...'
        : entry.content,
      createdAt: entry.created_at,
    }));

  return {
    found: true,
    workerId: worker.id,
    workerName: worker.name,
    outcomeName: outcome?.name || 'Unknown',
    totalEntries: entries.length,
    recentEntries,
  };
}
