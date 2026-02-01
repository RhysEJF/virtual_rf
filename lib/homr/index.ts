/**
 * HOMЯ Protocol - Main Module
 *
 * The HOMЯ Protocol is an intelligent orchestration layer that:
 * - Observes task outputs to extract learnings
 * - Steers ongoing work based on discoveries
 * - Escalates to humans when ambiguity is detected
 *
 * Usage:
 * ```typescript
 * import * as homr from '@/lib/homr';
 *
 * // After a task completes:
 * if (homr.isEnabled(outcomeId)) {
 *   const observation = await homr.observe({ task, fullOutput, ... });
 *   if (observation) {
 *     await homr.processObservation(observation);
 *   }
 * }
 *
 * // When building task context:
 * const context = homr.buildTaskContext(taskId, outcomeId);
 * ```
 */

// Re-export types
export * from './types';

// Re-export specific functions
export { observeTask, quickObserve, detectAmbiguityPatterns, detectFailurePatterns, createFailurePatternAmbiguity } from './observer';
export type { FailurePatternConfig, FailurePatternResult } from './observer';
export {
  buildTaskContext,
  getTaskContext,
  steer,
  compactContext,
  recordDecision,
  recordConstraint,
  // Dependency graph management
  insertCorrectiveTask,
  addDependency,
  blockTaskChain,
  removeDependency,
  getTasksDependingOn,
  // Escalation decision application
  applyEscalationDecision,
} from './steerer';
export type {
  DependencyModificationResult,
  EscalationDecisionAction,
  EscalationDecisionResult,
  ApplyEscalationDecisionOptions,
} from './steerer';
export { createEscalation, resolveEscalation, dismissEscalation, hasPendingEscalations, getPendingEscalationCount } from './escalator';
export { buildTaskContextSection } from './prompts';

// Re-export DB functions for convenience
export {
  isHomrEnabled,
  getHomrStatus,
  getHomrContext,
  getRecentObservations,
  getPendingEscalations,
  getHomrActivity,
  parseObservation,
  parseEscalation,
} from '../db/homr';

import { observeTask, detectFailurePatterns, createFailurePatternAmbiguity } from './observer';
import { steer } from './steerer';
import { createEscalation, hasPendingEscalations } from './escalator';
import { isHomrEnabled, logHomrActivity } from '../db/homr';
import { pauseWorker, getActiveWorkersByOutcome } from '../db/workers';
import type { Task, Intent } from '../db/schema';
import type { ObservationResult } from './types';
import type { FailurePatternConfig } from './observer';

// ============================================================================
// Main HOMЯ Entry Points
// ============================================================================

/**
 * Check if HOMЯ is enabled for an outcome
 */
export function isEnabled(outcomeId: string): boolean {
  return isHomrEnabled(outcomeId);
}

/**
 * Observe a task and process the results
 * This is the main entry point after a task completes
 */
export async function observe(input: {
  task: Task;
  fullOutput: string;
  intent: Intent | null;
  outcomeId: string;
}): Promise<ObservationResult | null> {
  if (!isEnabled(input.outcomeId)) {
    return null;
  }

  return observeTask({
    ...input,
    designDoc: null, // Will be fetched by observer
  });
}

/**
 * Process an observation result
 * Handles steering and escalation based on findings
 */
export async function processObservation(observation: ObservationResult): Promise<void> {
  const { outcomeId, ambiguity, taskId } = observation;

  // If ambiguity detected, create escalation
  if (ambiguity && ambiguity.detected) {
    const task = await import('../db/tasks').then(m => m.getTaskById(taskId));
    if (task) {
      await createEscalation(outcomeId, ambiguity, task);
    }
  } else {
    // No ambiguity - proceed with steering
    await steer(observation);
  }
}

/**
 * Full observation and processing pipeline
 * Use this for the complete HOMЯ flow
 */
export async function observeAndProcess(input: {
  task: Task;
  fullOutput: string;
  intent: Intent | null;
  outcomeId: string;
  /** Optional: worker ID to pause if failure pattern detected */
  workerId?: string;
  /** Optional: configuration for failure pattern detection */
  failurePatternConfig?: FailurePatternConfig;
}): Promise<{
  observation: ObservationResult | null;
  escalated: boolean;
  steered: boolean;
  failurePatternDetected: boolean;
  workerPaused: boolean;
}> {
  const observation = await observe(input);

  if (!observation) {
    return { observation: null, escalated: false, steered: false, failurePatternDetected: false, workerPaused: false };
  }

  let escalated = false;
  let steered = false;
  let failurePatternDetected = false;
  let workerPaused = false;

  // Check for failure patterns FIRST (before other escalations)
  const failureResult = detectFailurePatterns(
    input.outcomeId,
    observation,
    input.failurePatternConfig
  );

  if (failureResult.detected && failureResult.recommendation === 'escalate') {
    failurePatternDetected = true;

    // Create escalation for the failure pattern
    const failureAmbiguity = createFailurePatternAmbiguity(failureResult, input.task.id);
    await createEscalation(input.outcomeId, failureAmbiguity, input.task);
    escalated = true;

    // Pause all active workers for this outcome
    const activeWorkers = getActiveWorkersByOutcome(input.outcomeId);
    for (const worker of activeWorkers) {
      pauseWorker(worker.id);
      workerPaused = true;
    }

    // Log the failure pattern detection
    logHomrActivity({
      outcome_id: input.outcomeId,
      type: 'escalation',
      details: {
        event: 'failure_pattern_detected',
        pattern: failureResult.pattern,
        consecutiveFailures: failureResult.consecutiveFailures,
        averageAlignment: failureResult.averageAlignment,
        workersPaused: activeWorkers.map(w => w.id),
      },
      summary: `Failure pattern detected: ${failureResult.pattern} (${failureResult.consecutiveFailures} consecutive failures). Workers paused.`,
    });

    console.log(`[HOMЯ] Failure pattern detected: ${failureResult.pattern}. Escalating and pausing workers.`);
  } else if (observation.ambiguity && observation.ambiguity.detected) {
    // Regular ambiguity escalation
    await createEscalation(input.outcomeId, observation.ambiguity, input.task);
    escalated = true;
  } else {
    // No issues - proceed with steering
    const steerResult = await steer(observation);
    steered = steerResult.actions.length > 0;
  }

  return { observation, escalated, steered, failurePatternDetected, workerPaused };
}

/**
 * Check if work should be blocked due to pending escalations
 */
export function shouldBlockWork(outcomeId: string): boolean {
  if (!isEnabled(outcomeId)) {
    return false;
  }

  return hasPendingEscalations(outcomeId);
}

// ============================================================================
// Lifecycle Hooks for Ralph Worker
// ============================================================================

/**
 * Called when a Ralph worker starts
 */
export function onWorkerStart(outcomeId: string, workerId: string): void {
  if (!isEnabled(outcomeId)) return;

  logHomrActivity({
    outcome_id: outcomeId,
    type: 'observation',
    details: {
      event: 'worker_start',
      workerId,
    },
    summary: `Worker ${workerId} started - HOMЯ monitoring enabled`,
  });
}

/**
 * Called when a Ralph worker stops
 */
export function onWorkerStop(outcomeId: string, workerId: string): void {
  if (!isEnabled(outcomeId)) return;

  logHomrActivity({
    outcome_id: outcomeId,
    type: 'observation',
    details: {
      event: 'worker_stop',
      workerId,
    },
    summary: `Worker ${workerId} stopped`,
  });
}
