/**
 * Supervisor Agent
 *
 * Monitors workers and creates alerts when issues are detected.
 * Detection rules:
 * - stuck: Same task > 10 minutes
 * - no_progress: No progress entry > 5 minutes for running workers
 * - repeated_errors: 3+ consecutive failed tasks
 */

import { getDb, now } from '../db';
import { getWorkerById } from '../db/workers';
import { getTasksByOutcome } from '../db/tasks';
import { getProgressEntriesByWorker } from '../db/progress';
import {
  createSupervisorAlert,
  hasActiveAlertOfType,
  resolveAlertsForWorker,
} from '../db/supervisor-alerts';
import { createIntervention } from '../db/interventions';
import type { Worker, Task, ProgressEntry, SupervisorAlertType } from '../db/schema';

// ============================================================================
// Configuration
// ============================================================================

const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const NO_PROGRESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const CONSECUTIVE_FAILURES_THRESHOLD = 3;
const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

// ============================================================================
// State
// ============================================================================

let supervisorInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// ============================================================================
// Detection Functions
// ============================================================================

interface WorkerContext {
  worker: Worker;
  currentTask: Task | null;
  recentTasks: Task[];
  lastProgress: ProgressEntry | null;
}

/**
 * Get context needed to analyze a worker
 */
function getWorkerContext(workerId: string): WorkerContext | null {
  const worker = getWorkerById(workerId);
  if (!worker) return null;

  const tasks = getTasksByOutcome(worker.outcome_id);
  const currentTask = worker.current_task_id
    ? tasks.find(t => t.id === worker.current_task_id) || null
    : null;

  // Get tasks that this worker claimed, ordered by claimed_at
  const workerTasks = tasks
    .filter(t => t.claimed_by === workerId && t.claimed_at)
    .sort((a, b) => (b.claimed_at || 0) - (a.claimed_at || 0));

  const progressEntries = getProgressEntriesByWorker(workerId);
  const lastProgress = progressEntries.length > 0
    ? progressEntries[progressEntries.length - 1]
    : null;

  return {
    worker,
    currentTask,
    recentTasks: workerTasks.slice(0, 10), // Last 10 tasks
    lastProgress,
  };
}

/**
 * Check if a worker is stuck on a task for too long
 */
function checkStuck(context: WorkerContext): boolean {
  const { worker, currentTask } = context;

  if (worker.status !== 'running' || !currentTask) {
    return false;
  }

  // Check if we already have an active stuck alert
  if (hasActiveAlertOfType(worker.id, 'stuck')) {
    return false;
  }

  // Check if task has been running for too long
  const taskStartTime = currentTask.claimed_at;
  if (!taskStartTime) return false;

  const elapsed = now() - taskStartTime;
  if (elapsed > STUCK_THRESHOLD_MS) {
    createSupervisorAlert({
      worker_id: worker.id,
      outcome_id: worker.outcome_id,
      type: 'stuck',
      severity: 'warning',
      message: `Worker has been on task "${currentTask.title}" for ${Math.floor(elapsed / 60000)} minutes`,
    });
    return true;
  }

  return false;
}

/**
 * Check if a worker hasn't made progress recently
 */
function checkNoProgress(context: WorkerContext): boolean {
  const { worker, lastProgress } = context;

  if (worker.status !== 'running') {
    return false;
  }

  // Check if we already have an active no_progress alert
  if (hasActiveAlertOfType(worker.id, 'no_progress')) {
    return false;
  }

  // If no progress entries at all, use worker start time
  const lastActivityTime = lastProgress?.created_at || worker.started_at;
  if (!lastActivityTime) return false;

  const elapsed = now() - lastActivityTime;
  if (elapsed > NO_PROGRESS_THRESHOLD_MS) {
    createSupervisorAlert({
      worker_id: worker.id,
      outcome_id: worker.outcome_id,
      type: 'no_progress',
      severity: 'warning',
      message: `No progress logged for ${Math.floor(elapsed / 60000)} minutes`,
    });
    return true;
  }

  return false;
}

/**
 * Check if a worker has had consecutive task failures
 */
function checkRepeatedErrors(context: WorkerContext): boolean {
  const { worker, recentTasks } = context;

  // Check if we already have an active repeated_errors alert
  if (hasActiveAlertOfType(worker.id, 'repeated_errors')) {
    return false;
  }

  // Count consecutive failures from the beginning of recent tasks
  let consecutiveFailures = 0;
  for (const task of recentTasks) {
    if (task.status === 'failed') {
      consecutiveFailures++;
    } else if (task.status === 'completed') {
      break; // Stop counting after a success
    }
  }

  if (consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) {
    // Create critical alert
    const alert = createSupervisorAlert({
      worker_id: worker.id,
      outcome_id: worker.outcome_id,
      type: 'repeated_errors',
      severity: 'critical',
      message: `${consecutiveFailures} consecutive task failures detected`,
      auto_paused: true,
    });

    // Auto-pause the worker via intervention
    createIntervention({
      outcome_id: worker.outcome_id,
      worker_id: worker.id,
      type: 'pause',
      message: `Auto-paused due to ${consecutiveFailures} consecutive failures (Supervisor Alert #${alert.id})`,
      priority: 10, // High priority
    });

    return true;
  }

  return false;
}

/**
 * Check a single worker for all issues
 */
function checkWorker(workerId: string): void {
  const context = getWorkerContext(workerId);
  if (!context) return;

  // If worker is no longer running, resolve any active alerts
  if (context.worker.status !== 'running') {
    resolveAlertsForWorker(workerId);
    return;
  }

  // Run all checks
  checkStuck(context);
  checkNoProgress(context);
  checkRepeatedErrors(context);
}

/**
 * Get all running workers and check them
 */
function checkAllWorkers(): void {
  const db = getDb();
  const workers = db.prepare(`
    SELECT id FROM workers WHERE status = 'running'
  `).all() as { id: string }[];

  for (const { id } of workers) {
    try {
      checkWorker(id);
    } catch (err) {
      console.error(`Supervisor error checking worker ${id}:`, err);
    }
  }
}

// ============================================================================
// Control Functions
// ============================================================================

/**
 * Start the supervisor monitoring loop
 */
export function startSupervisor(): { success: boolean; message: string } {
  if (isRunning) {
    return { success: false, message: 'Supervisor is already running' };
  }

  isRunning = true;

  // Run immediately on start
  checkAllWorkers();

  // Then run on interval
  supervisorInterval = setInterval(checkAllWorkers, CHECK_INTERVAL_MS);

  console.log('[Supervisor] Started monitoring workers');
  return { success: true, message: 'Supervisor started' };
}

/**
 * Stop the supervisor monitoring loop
 */
export function stopSupervisor(): { success: boolean; message: string } {
  if (!isRunning || !supervisorInterval) {
    return { success: false, message: 'Supervisor is not running' };
  }

  clearInterval(supervisorInterval);
  supervisorInterval = null;
  isRunning = false;

  console.log('[Supervisor] Stopped monitoring workers');
  return { success: true, message: 'Supervisor stopped' };
}

/**
 * Get supervisor status
 */
export function getSupervisorStatus(): { running: boolean; checkIntervalMs: number } {
  return {
    running: isRunning,
    checkIntervalMs: CHECK_INTERVAL_MS,
  };
}

/**
 * Manually trigger a check (useful for testing)
 */
export function triggerCheck(): void {
  checkAllWorkers();
}
