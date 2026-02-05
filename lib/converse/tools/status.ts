/**
 * Status Tools
 *
 * Tools for getting system status information.
 */

import { getActiveOutcomes as dbGetActiveOutcomes, getAllOutcomes as dbGetAllOutcomes, getOutcomesWithCounts } from '../../db/outcomes';
import { getActiveWorkers as dbGetActiveWorkers } from '../../db/workers';
import { getTaskStats } from '../../db/tasks';
import type { OutcomeStatus } from '../../db/schema';

export interface SystemStatusResult {
  activeOutcomes: number;
  totalOutcomes: number;
  runningWorkers: number;
  pendingEscalations: number;
  outcomes: Array<{
    id: string;
    name: string;
    status: string;
    pendingTasks: number;
    completedTasks: number;
    totalTasks: number;
    runningWorkers: number;
  }>;
}

/**
 * Get overall system status including worker counts, active outcomes, etc.
 */
export function getSystemStatus(): SystemStatusResult {
  const allOutcomes = getOutcomesWithCounts();
  const activeOutcomes = allOutcomes.filter((o) => o.status === 'active');
  const runningWorkers = dbGetActiveWorkers();

  // Dynamically import to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPendingEscalations } = require('../../db/homr');

  // Count pending escalations across active outcomes
  let pendingEscalations = 0;
  for (const outcome of activeOutcomes) {
    const escalations = getPendingEscalations(outcome.id);
    pendingEscalations += escalations.length;
  }

  // Build outcome summaries (limit to 10 most recent)
  const outcomeSummaries = activeOutcomes.slice(0, 10).map((outcome) => ({
    id: outcome.id,
    name: outcome.name,
    status: outcome.status,
    pendingTasks: outcome.pending_tasks,
    completedTasks: outcome.completed_tasks,
    totalTasks: outcome.total_tasks,
    runningWorkers: outcome.active_workers,
  }));

  return {
    activeOutcomes: activeOutcomes.length,
    totalOutcomes: allOutcomes.length,
    runningWorkers: runningWorkers.length,
    pendingEscalations,
    outcomes: outcomeSummaries,
  };
}

export interface ActiveOutcomesResult {
  count: number;
  outcomes: Array<{
    id: string;
    name: string;
    status: string;
    pendingTasks: number;
    completedTasks: number;
    totalTasks: number;
    runningWorkers: number;
    pendingEscalations: number;
  }>;
}

/**
 * Get all active outcomes with their counts
 */
export function getActiveOutcomes(): ActiveOutcomesResult {
  const outcomes = getOutcomesWithCounts().filter((o) => o.status === 'active');

  // Dynamically import to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPendingEscalations } = require('../../db/homr');

  const outcomesWithEscalations = outcomes.map((outcome) => {
    const escalations = getPendingEscalations(outcome.id);
    return {
      id: outcome.id,
      name: outcome.name,
      status: outcome.status,
      pendingTasks: outcome.pending_tasks,
      completedTasks: outcome.completed_tasks,
      totalTasks: outcome.total_tasks,
      runningWorkers: outcome.active_workers,
      pendingEscalations: escalations.length,
    };
  });

  return {
    count: outcomes.length,
    outcomes: outcomesWithEscalations,
  };
}

export interface AllOutcomesResult {
  count: number;
  outcomes: Array<{
    id: string;
    name: string;
    status: string;
    pendingTasks: number;
    completedTasks: number;
    totalTasks: number;
    runningWorkers: number;
    lastActivityAt: number;
  }>;
}

/**
 * Get all outcomes with optional status filter
 */
export function getAllOutcomes(status?: OutcomeStatus): AllOutcomesResult {
  let outcomes = getOutcomesWithCounts();

  if (status) {
    outcomes = outcomes.filter((o) => o.status === status);
  }

  const outcomeSummaries = outcomes.map((outcome) => ({
    id: outcome.id,
    name: outcome.name,
    status: outcome.status,
    pendingTasks: outcome.pending_tasks,
    completedTasks: outcome.completed_tasks,
    totalTasks: outcome.total_tasks,
    runningWorkers: outcome.active_workers,
    lastActivityAt: outcome.last_activity_at,
  }));

  return {
    count: outcomes.length,
    outcomes: outcomeSummaries,
  };
}
