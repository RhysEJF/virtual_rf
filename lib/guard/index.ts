/**
 * Destructive Command Guard - Main Integration Module
 *
 * This module provides the main entry point for the guard system,
 * integrating command validation, blocking, and alerting into
 * the Ralph worker execution flow.
 *
 * The guard intercepts commands before execution, validates them
 * against dangerous patterns, logs blocks to the database, and
 * creates supervisor alerts for dangerous attempts.
 */

import { validateCommand, validateCommandWithContext, ValidationResult, ValidationContext } from './command-validator';
import { matchDangerousPattern, analyzeCommand, CommandAnalysis, DangerCategory } from './patterns';
import { createGuardBlock, getBlockCountForWorker, getGuardBlocksByWorker, GuardBlockStats, getGuardBlockStats } from '../db/guard-blocks';
import { createSupervisorAlert, hasActiveAlertOfType } from '../db/supervisor-alerts';
import type { SupervisorAlertType, SupervisorAlertSeverity } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface GuardResult {
  /** Whether the command is allowed to execute */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Pattern that matched (if blocked) */
  patternMatched?: string;
  /** Whether a guard block was recorded */
  blockRecorded: boolean;
  /** Whether a supervisor alert was created */
  alertCreated: boolean;
  /** The block ID if one was created */
  blockId?: string;
}

export interface GuardContext {
  /** Worker ID executing the command */
  workerId: string;
  /** Outcome ID the worker belongs to */
  outcomeId: string;
  /** Working directory where the command executes */
  workspacePath: string;
  /** Current working directory (optional, for resolving relative paths) */
  cwd?: string;
  /** Task ID being worked on (optional) */
  taskId?: string;
}

export interface GuardConfig {
  /** Whether to log all blocked commands to database (default: true) */
  logBlocks: boolean;
  /** Whether to create supervisor alerts for dangerous attempts (default: true) */
  createAlerts: boolean;
  /** Threshold for repeated blocks before escalating alert severity */
  repeatBlockThreshold: number;
  /** Time window (ms) for counting repeated blocks */
  repeatBlockWindowMs: number;
  /** Whether to auto-pause worker on critical severity blocks */
  autoPauseOnCritical: boolean;
}

const DEFAULT_CONFIG: GuardConfig = {
  logBlocks: true,
  createAlerts: true,
  repeatBlockThreshold: 3,
  repeatBlockWindowMs: 5 * 60 * 1000, // 5 minutes
  autoPauseOnCritical: true,
};

// ============================================================================
// Severity Mapping
// ============================================================================

/**
 * Map danger categories to supervisor alert types
 */
function categoryToAlertType(category: DangerCategory): SupervisorAlertType {
  switch (category) {
    case 'filesystem_destruction':
      return 'mass_deletion';
    case 'git_destructive':
      return 'scope_violation';
    case 'database_destructive':
      return 'mass_deletion';
    case 'privilege_escalation':
      return 'suspicious_behavior';
    case 'network_dangerous':
      return 'suspicious_behavior';
    case 'system_modification':
      return 'system_file_access';
    case 'credential_exposure':
      return 'env_access';
    default:
      return 'suspicious_behavior';
  }
}

/**
 * Map pattern severity to alert severity
 */
function patternSeverityToAlertSeverity(
  severity: 'critical' | 'high' | 'medium',
  repeatCount: number
): SupervisorAlertSeverity {
  // Escalate severity based on repeat count
  if (repeatCount >= 5) {
    return 'critical';
  }
  if (repeatCount >= 3) {
    return severity === 'medium' ? 'high' : severity;
  }

  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return 'low';
  }
}

// ============================================================================
// Core Guard Functions
// ============================================================================

/**
 * Check a command against the guard and take appropriate action.
 *
 * This is the main entry point for command validation. It:
 * 1. Validates the command against dangerous patterns
 * 2. Checks path-based restrictions
 * 3. Logs blocks to the database if configured
 * 4. Creates supervisor alerts for dangerous attempts
 *
 * @param command - The shell command to validate
 * @param context - Context about the worker and execution environment
 * @param config - Optional configuration overrides
 * @returns GuardResult with decision and metadata
 */
export function checkCommand(
  command: string,
  context: GuardContext,
  config: Partial<GuardConfig> = {}
): GuardResult {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const { workerId, outcomeId, workspacePath, cwd } = context;

  // Validate the command
  const validation = validateCommand(command, workspacePath, cwd);

  // If allowed, return immediately
  if (validation.allowed) {
    return {
      allowed: true,
      reason: validation.reason,
      blockRecorded: false,
      alertCreated: false,
    };
  }

  // Command is blocked - get pattern details
  const patternMatched = validation.pattern || 'path_violation';

  // Analyze command to get category for alert type
  const analysis = analyzeCommand(command);
  const category = analysis.dangerousPattern?.category || 'filesystem_destruction';
  const severity = analysis.dangerousPattern?.severity || 'high';

  // Check repeat count for escalation
  const repeatCount = getBlockCountForWorker(workerId, mergedConfig.repeatBlockWindowMs);

  // Build result
  const result: GuardResult = {
    allowed: false,
    reason: validation.reason,
    patternMatched,
    blockRecorded: false,
    alertCreated: false,
  };

  // Log block to database
  if (mergedConfig.logBlocks) {
    try {
      const block = createGuardBlock({
        worker_id: workerId,
        outcome_id: outcomeId,
        command: command.substring(0, 2000), // Truncate very long commands
        pattern_matched: patternMatched,
        context: {
          workspacePath,
          cwd,
          taskId: context.taskId,
          analyzedPaths: validation.analyzedPaths,
          repeatCount: repeatCount + 1,
        },
      });
      result.blockRecorded = true;
      result.blockId = block.id;
    } catch (err) {
      // Log error but don't fail the guard check
      console.error('[Guard] Failed to record block:', err);
    }
  }

  // Create supervisor alert
  if (mergedConfig.createAlerts) {
    const alertType = categoryToAlertType(category);

    // Only create alert if there isn't already an active one of this type for this worker
    // This prevents alert spam
    if (!hasActiveAlertOfType(workerId, alertType)) {
      try {
        const alertSeverity = patternSeverityToAlertSeverity(severity, repeatCount + 1);

        // Build alert message
        let message = `Blocked dangerous command: ${validation.reason}`;
        if (repeatCount > 0) {
          message += ` (${repeatCount + 1} attempts in last ${mergedConfig.repeatBlockWindowMs / 60000} minutes)`;
        }

        // Determine if we should auto-pause
        const shouldAutoPause =
          mergedConfig.autoPauseOnCritical &&
          (alertSeverity === 'critical' || repeatCount >= mergedConfig.repeatBlockThreshold);

        createSupervisorAlert({
          worker_id: workerId,
          outcome_id: outcomeId,
          type: alertType,
          severity: alertSeverity,
          message,
          auto_paused: shouldAutoPause,
        });

        result.alertCreated = true;
      } catch (err) {
        // Log error but don't fail the guard check
        console.error('[Guard] Failed to create alert:', err);
      }
    }
  }

  return result;
}

/**
 * Batch check multiple commands.
 * Returns all results, optionally stopping at first block.
 */
export function checkCommands(
  commands: string[],
  context: GuardContext,
  options: { stopOnBlock?: boolean; config?: Partial<GuardConfig> } = {}
): { command: string; result: GuardResult }[] {
  const results: { command: string; result: GuardResult }[] = [];

  for (const command of commands) {
    const result = checkCommand(command, context, options.config);
    results.push({ command, result });

    if (options.stopOnBlock && !result.allowed) {
      break;
    }
  }

  return results;
}

/**
 * Quick check if a command would be blocked without recording anything.
 * Useful for preview/validation without side effects.
 */
export function wouldBlock(
  command: string,
  workspacePath: string,
  cwd?: string
): { blocked: boolean; reason?: string } {
  const validation = validateCommand(command, workspacePath, cwd);

  if (validation.allowed) {
    return { blocked: false };
  }

  return { blocked: true, reason: validation.reason };
}

/**
 * Get guard statistics for a worker.
 */
export function getWorkerGuardStats(workerId: string): {
  totalBlocks: number;
  recentBlocks: number;
  blocks: ReturnType<typeof getGuardBlocksByWorker>;
} {
  const blocks = getGuardBlocksByWorker(workerId, 50);
  const recentBlocks = getBlockCountForWorker(workerId, 24 * 60 * 60 * 1000); // Last 24h

  return {
    totalBlocks: blocks.length,
    recentBlocks,
    blocks,
  };
}

/**
 * Get global guard statistics.
 */
export function getGuardStats(): GuardBlockStats {
  return getGuardBlockStats();
}

// ============================================================================
// Re-exports
// ============================================================================

// Re-export core validation for direct use if needed
export { validateCommand, validateCommandWithContext };
export type { ValidationResult, ValidationContext };

// Re-export pattern analysis
export { analyzeCommand };
export type { CommandAnalysis, DangerCategory };

// Re-export guard block operations for external access
export {
  createGuardBlock,
  getGuardBlocksByWorker,
  getGuardBlocksByOutcome,
  getRecentGuardBlocks,
} from '../db/guard-blocks';
