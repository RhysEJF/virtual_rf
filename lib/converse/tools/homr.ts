/**
 * HOMR Tools
 *
 * Tools for managing HOMR (intelligent orchestration layer).
 * Includes status, activity, and auto-resolve functionality.
 */

import {
  getHomrStatus as dbGetHomrStatus,
  getHomrContext,
  getPendingEscalations,
  getHomrActivity,
  getRecentObservations,
} from '../../db/homr';
import { getOutcomeById } from '../../db/outcomes';
import {
  autoResolveAllPending,
  getAutoResolveConfig,
} from '../../homr/auto-resolver';

// ============================================================================
// HOMR Status
// ============================================================================

export interface HomrStatusResult {
  found: boolean;
  outcomeId?: string;
  outcomeName?: string;
  status?: {
    enabled: boolean;
    pendingEscalations: number;
    stats: {
      tasksObserved: number;
      discoveriesExtracted: number;
      escalationsCreated: number;
      steeringActions: number;
    };
    context: {
      discoveries: number;
      decisions: number;
      constraints: number;
    };
    autoResolve: {
      mode: string;
      confidenceThreshold: number;
    };
  };
  recentActivity?: Array<{
    type: string;
    summary: string;
    createdAt: number;
  }>;
  error?: string;
}

/**
 * Get HOMR status and recent activity for an outcome
 */
export function getHomrStatusTool(outcomeId: string): HomrStatusResult {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      found: false,
      error: `Outcome ${outcomeId} not found`,
    };
  }

  const status = dbGetHomrStatus(outcomeId);
  const activity = getHomrActivity(outcomeId, 5);
  const autoResolveConfig = getAutoResolveConfig(outcome);

  return {
    found: true,
    outcomeId: outcome.id,
    outcomeName: outcome.name,
    status: {
      enabled: status.enabled,
      pendingEscalations: status.pendingEscalations,
      stats: status.stats,
      context: status.context,
      autoResolve: {
        mode: autoResolveConfig.mode,
        confidenceThreshold: autoResolveConfig.confidenceThreshold,
      },
    },
    recentActivity: activity.map((a) => ({
      type: a.type,
      summary: a.summary,
      createdAt: a.created_at,
    })),
  };
}

// ============================================================================
// Auto-Resolve
// ============================================================================

export interface RunAutoResolveResult {
  success: boolean;
  outcomeId?: string;
  outcomeName?: string;
  totalEscalations?: number;
  resolvedCount?: number;
  deferredCount?: number;
  results?: Array<{
    escalationId: string;
    resolved: boolean;
    reasoning: string;
  }>;
  error?: string;
}

/**
 * Run auto-resolve on pending escalations for an outcome
 */
export async function runAutoResolve(outcomeId: string): Promise<RunAutoResolveResult> {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      success: false,
      error: `Outcome ${outcomeId} not found`,
    };
  }

  const pendingEscalations = getPendingEscalations(outcomeId);
  if (pendingEscalations.length === 0) {
    return {
      success: true,
      outcomeId: outcome.id,
      outcomeName: outcome.name,
      totalEscalations: 0,
      resolvedCount: 0,
      deferredCount: 0,
      results: [],
    };
  }

  try {
    // Get the auto-resolve config for this outcome
    const config = getAutoResolveConfig(outcome);

    // Run auto-resolve with the config
    const resolveResult = await autoResolveAllPending(outcomeId, config);

    return {
      success: true,
      outcomeId: outcome.id,
      outcomeName: outcome.name,
      totalEscalations: pendingEscalations.length,
      resolvedCount: resolveResult.resolved,
      deferredCount: resolveResult.deferred,
      results: resolveResult.results.map((r) => ({
        escalationId: r.escalationId,
        resolved: r.resolved,
        reasoning: r.reasoning,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Auto-resolve failed',
    };
  }
}

// ============================================================================
// HOMR Dashboard (combined view)
// ============================================================================

export interface HomrDashboardResult {
  found: boolean;
  outcomeId?: string;
  outcomeName?: string;
  summary?: {
    pendingEscalations: number;
    tasksObserved: number;
    discoveries: number;
    autoResolveMode: string;
  };
  escalations?: Array<{
    id: string;
    question: string;
    options: string[];
    createdAt: number;
  }>;
  recentObservations?: Array<{
    taskId: string;
    quality: string;
    onTrack: boolean;
    createdAt: number;
  }>;
  error?: string;
}

/**
 * Get a combined HOMR dashboard view for an outcome
 */
export function getHomrDashboard(outcomeId: string): HomrDashboardResult {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      found: false,
      error: `Outcome ${outcomeId} not found`,
    };
  }

  const status = dbGetHomrStatus(outcomeId);
  const escalations = getPendingEscalations(outcomeId);
  const observations = getRecentObservations(outcomeId, 3);
  const autoResolveConfig = getAutoResolveConfig(outcome);

  return {
    found: true,
    outcomeId: outcome.id,
    outcomeName: outcome.name,
    summary: {
      pendingEscalations: status.pendingEscalations,
      tasksObserved: status.stats.tasksObserved,
      discoveries: status.context.discoveries,
      autoResolveMode: autoResolveConfig.mode,
    },
    escalations: escalations.slice(0, 5).map((esc) => {
      let options: string[] = [];
      try {
        const parsed = JSON.parse(esc.question_options);
        options = parsed.map((o: { label: string }) => o.label);
      } catch {
        // ignore
      }
      return {
        id: esc.id,
        question: esc.question_text,
        options,
        createdAt: esc.created_at,
      };
    }),
    recentObservations: observations.map((obs) => ({
      taskId: obs.task_id,
      quality: obs.quality,
      onTrack: obs.on_track === 1,
      createdAt: obs.created_at,
    })),
  };
}
