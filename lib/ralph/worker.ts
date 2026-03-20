/**
 * Ralph Worker (Task-Based Execution)
 *
 * Spawns an autonomous Claude Code CLI process that works through tasks.
 * Named after the "Ralph Wiggum" loop pattern.
 *
 * New Model:
 * - Claims tasks atomically from the outcome's task pool
 * - Executes one task at a time with full context
 * - Sends heartbeats to prevent stale detection
 * - Loops until all tasks complete or max iterations reached
 */

import { spawn, ChildProcess, execSync, execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import {
  createWorker,
  updateWorker,
  getWorkerById,
  startWorker as startWorkerDb,
  sendHeartbeat,
  incrementIteration,
  completeWorker,
  failWorker,
} from '../db/workers';
import { buildSkillContext } from '../agents/skill-manager';
import {
  claimNextTask,
  startTask,
  completeTask,
  failTask,
  getTaskStats,
  getPendingTasks,
  releaseTask,
  updateTask as updateTaskDb,
  getFailedBlockerTasks,
  resetTaskForRetry,
} from '../db/tasks';
import type { Task, Intent, TaskPhase, IsolationMode } from '../db/schema';
import { getOutcomeById, getDesignDoc } from '../db/outcomes';
import { createProgressEntry } from '../db/progress';
import {
  getPendingInterventionsForWorker,
  acknowledgeIntervention,
  completeIntervention,
} from '../db/interventions';
import { resolveAlertsForWorker } from '../db/supervisor-alerts';
import { updateWorker as updateWorkerDb } from '../db/workers';
import { createWorktree, removeWorktree, isGitRepo } from '../worktree/manager';
import { startSupervisor, stopSupervisor } from '../supervisor';
import {
  areSkillDependenciesMet,
  resolveSkillDependencies,
} from '../agents/skill-dependency-resolver';
import { loadOutcomeSkills } from '../agents/skill-builder';
import { loadOutcomeTools } from '../agents/tool-builder';
import * as homr from '../homr';
import * as guard from '../guard';
import { estimateTaskComplexity, assessTurnLimitRisk, ComplexityEstimate } from '../agents/task-complexity-estimator';
import { autoDecomposeIfNeeded, DecompositionResult, decomposeRemainingWork } from '../agents/task-decomposer';
import { logCost } from '../db/logs';
import {
  logTaskCompleted,
  logTaskClaimed,
  logTaskFailed,
  logWorkerStarted,
  logWorkerCompleted,
  logWorkerFailed,
  logWorkerRestarted,
} from '../db/activity';
import { paths } from '../config/paths';
import { getEventBus } from '../events/bus';
import { recordAttempt, getAttemptCount } from '../db/attempts';
import { saveCheckpoint, getLatestCheckpoint as _getLatestCheckpoint } from '../db/checkpoints';
import { runVerification } from './verification';
import { buildTeachingContext } from './teaching-errors';
import { runSafetyCheck, buildSafetyEscalationSignal } from './safety-check';
import { getDiscoveriesForTask } from '../db/homr';
import { getDefaultTurnBudget } from '../db/system-config';

// ============================================================================
// Types
// ============================================================================

export interface RalphConfig {
  outcomeId: string;
  workspacePath?: string;
  maxIterations?: number; // Default 50
  heartbeatIntervalMs?: number; // Default 30000 (30 seconds)
  useWorktree?: boolean; // Use git worktree for isolation (parallel workers)
  circuitBreakerThreshold?: number; // Default 3 - consecutive failures before auto-pause
  // Pre-claim complexity check options
  enableComplexityCheck?: boolean; // Default true - check task complexity before claiming
  autoDecompose?: boolean; // Default false - auto-decompose high-complexity tasks
  maxTurns?: number; // Default 100 - worker's max turns per task
  selfHeal?: boolean; // Default true - auto-restart on infrastructure failures
  selfHealConfig?: Partial<SelfHealConfig>;
}

// ============================================================================
// Self-Healing Types
// ============================================================================

type WorkerExitReason =
  | 'user_paused'           // Explicit pause via API or intervention
  | 'all_tasks_complete'    // No more work
  | 'gate_reached'          // Only gated tasks remain
  | 'complexity_escalation' // Human decision needed
  | 'safety_blocked'        // Safety check flagged adversarial content
  | 'circuit_breaker'       // Repeated failures, human review
  | 'homr_paused'           // HOMR observer paused for review
  | 'critical_error'        // Task reported critical/blocked error
  | 'rate_limited'          // Hit subscription rate limit — pause, not fail
  | 'uncaught_exception'    // Unexpected throw — RESTARTABLE
  | 'max_iterations'        // Hit iteration limit — RESTARTABLE
  | 'unknown';              // Fallback — RESTARTABLE

interface SelfHealConfig {
  maxRestarts: number;          // Default 5
  initialBackoffMs: number;     // Default 10_000 (10s)
  maxBackoffMs: number;         // Default 120_000 (2 min)
  backoffMultiplier: number;    // Default 2
}

const DEFAULT_SELF_HEAL: SelfHealConfig = {
  maxRestarts: 5,
  initialBackoffMs: 10_000,
  maxBackoffMs: 120_000,
  backoffMultiplier: 2,
};

const RESTARTABLE_EXITS = new Set<WorkerExitReason>([
  'uncaught_exception',
  'max_iterations',
  'unknown',
]);

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Circuit Breaker Types and State
// ============================================================================

/**
 * Failure record for circuit breaker analysis
 */
interface FailureRecord {
  taskId: string;
  errorType: string; // Categorized error type
  driftType?: string; // If HOMЯ detected drift
  timestamp: number;
}

/**
 * Circuit breaker state per outcome
 */
interface CircuitBreakerState {
  consecutiveFailures: FailureRecord[];
  lastSuccessAt: number | null;
  tripCount: number; // How many times the circuit breaker has tripped
}

// Track circuit breaker state per outcome
const circuitBreakerStates = new Map<string, CircuitBreakerState>();

/**
 * Get or create circuit breaker state for an outcome
 */
function getCircuitBreakerState(outcomeId: string): CircuitBreakerState {
  let state = circuitBreakerStates.get(outcomeId);
  if (!state) {
    state = {
      consecutiveFailures: [],
      lastSuccessAt: null,
      tripCount: 0,
    };
    circuitBreakerStates.set(outcomeId, state);
  }
  return state;
}

/**
 * Record a task failure for circuit breaker analysis
 */
function recordFailure(outcomeId: string, taskId: string, error: string, driftType?: string): void {
  const state = getCircuitBreakerState(outcomeId);

  // Categorize the error type
  const errorType = categorizeError(error);

  state.consecutiveFailures.push({
    taskId,
    errorType,
    driftType,
    timestamp: Date.now(),
  });

  // Keep only the last 10 failures for analysis
  if (state.consecutiveFailures.length > 10) {
    state.consecutiveFailures.shift();
  }
}

/**
 * Record a task success - resets consecutive failures
 */
function recordSuccess(outcomeId: string): void {
  const state = getCircuitBreakerState(outcomeId);
  state.consecutiveFailures = [];
  state.lastSuccessAt = Date.now();
}

/**
 * Categorize an error string into a general type
 */
function categorizeError(error: string): string {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
    return 'timeout';
  }
  if (errorLower.includes('turn') || errorLower.includes('iteration') || errorLower.includes('max_turns') || errorLower.includes('code null')) {
    return 'turn_limit_exhausted';
  }
  if (errorLower.includes('permission') || errorLower.includes('access denied')) {
    return 'permission_error';
  }
  if (errorLower.includes('syntax') || errorLower.includes('parse error')) {
    return 'syntax_error';
  }
  if (errorLower.includes('not found') || errorLower.includes('missing')) {
    return 'not_found';
  }
  if (errorLower.includes('exit code')) {
    return 'process_exit_error';
  }
  if (errorLower.includes('blocked') || errorLower.includes('guard')) {
    return 'command_blocked';
  }
  return 'unknown';
}

/**
 * Check if failures have a similar pattern (same error type or drift type)
 */
function hasSimilarPattern(failures: FailureRecord[]): { hasSimilar: boolean; pattern: string } {
  if (failures.length < 2) {
    return { hasSimilar: false, pattern: '' };
  }

  // Check for repeated error types
  const errorTypes = failures.map(f => f.errorType);
  const errorCounts = errorTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Find the most common error type
  const mostCommonError = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])[0];

  if (mostCommonError && mostCommonError[1] >= 2) {
    return { hasSimilar: true, pattern: `error:${mostCommonError[0]}` };
  }

  // Check for repeated drift types
  const driftTypes = failures.map(f => f.driftType).filter(Boolean) as string[];
  const driftCounts = driftTypes.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const mostCommonDrift = Object.entries(driftCounts)
    .sort((a, b) => b[1] - a[1])[0];

  if (mostCommonDrift && mostCommonDrift[1] >= 2) {
    return { hasSimilar: true, pattern: `drift:${mostCommonDrift[0]}` };
  }

  return { hasSimilar: false, pattern: '' };
}

/**
 * Check if circuit breaker should trip
 */
function shouldTripCircuitBreaker(outcomeId: string, threshold: number): {
  shouldTrip: boolean;
  reason: string;
  pattern: string;
  failureCount: number;
} {
  const state = getCircuitBreakerState(outcomeId);
  const failures = state.consecutiveFailures;

  // Check for HOMR blocker discoveries first — stop immediately if found
  try {
    const discoveries = getDiscoveriesForTask(outcomeId, '*');
    const hasBlocker = discoveries.some(d => d.type === 'blocker');
    if (hasBlocker) {
      return {
        shouldTrip: true,
        reason: 'HOMR blocker discovery detected — stopping to prevent wasted work',
        pattern: 'homr_blocker',
        failureCount: failures.length,
      };
    }
  } catch {
    // HOMR not available, fall through to count-based check
  }

  if (failures.length < threshold) {
    return { shouldTrip: false, reason: '', pattern: '', failureCount: failures.length };
  }

  // Get the most recent failures up to threshold
  const recentFailures = failures.slice(-threshold);

  // Check for similar patterns
  const { hasSimilar, pattern } = hasSimilarPattern(recentFailures);

  if (hasSimilar) {
    return {
      shouldTrip: true,
      reason: `${threshold} consecutive failures with similar pattern`,
      pattern,
      failureCount: failures.length,
    };
  }

  // Even without similar patterns, too many consecutive failures should trip
  if (failures.length >= threshold + 1) {
    return {
      shouldTrip: true,
      reason: `${failures.length} consecutive failures (exceeds threshold of ${threshold})`,
      pattern: 'mixed_failures',
      failureCount: failures.length,
    };
  }

  return { shouldTrip: false, reason: '', pattern: '', failureCount: failures.length };
}

/**
 * Mark the circuit breaker as tripped (increment trip count)
 */
function markCircuitBreakerTripped(outcomeId: string): void {
  const state = getCircuitBreakerState(outcomeId);
  state.tripCount++;
}

/**
 * Reset circuit breaker state for an outcome
 */
export function resetCircuitBreaker(outcomeId: string): void {
  circuitBreakerStates.delete(outcomeId);
}

/**
 * Get circuit breaker status for an outcome (for monitoring/debugging)
 */
export function getCircuitBreakerStatus(outcomeId: string): {
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  tripCount: number;
  recentFailures: Array<{ taskId: string; errorType: string; timestamp: number }>;
} {
  const state = getCircuitBreakerState(outcomeId);
  return {
    consecutiveFailures: state.consecutiveFailures.length,
    lastSuccessAt: state.lastSuccessAt,
    tripCount: state.tripCount,
    recentFailures: state.consecutiveFailures.map(f => ({
      taskId: f.taskId,
      errorType: f.errorType,
      timestamp: f.timestamp,
    })),
  };
}

// ============================================================================
// Pre-Claim Complexity Check
// ============================================================================

/**
 * Tiered complexity response action
 */
export type ComplexityTierAction = 'proceed' | 'proceed_extended' | 'decompose' | 'escalate';

/**
 * A single complexity tier defining how to handle tasks at a given score range
 */
export interface ComplexityTier {
  minScore: number;
  maxScore: number;
  action: ComplexityTierAction;
  turnMultiplier?: number;          // For proceed_extended: multiply maxTurns by this (default: 2)
}

/**
 * Default complexity tiers:
 *   0-5  → proceed (normal turn budget)
 *   6-7  → proceed_extended (double turn budget)
 *   8-9  → auto-decompose before starting
 *   10   → escalate to human (truly massive only)
 */
const DEFAULT_COMPLEXITY_TIERS: ComplexityTier[] = [
  { minScore: 0, maxScore: 5, action: 'proceed' },
  { minScore: 6, maxScore: 7, action: 'proceed_extended', turnMultiplier: 2 },
  { minScore: 8, maxScore: 9, action: 'decompose' },
  { minScore: 10, maxScore: 10, action: 'escalate' },
];

/**
 * Configuration for pre-claim complexity check (logging-only mode)
 *
 * The complexity check no longer gates task execution. It runs purely for
 * data collection — logging predicted complexity and turns so we can build
 * better adaptive budgeting in the future.
 */
export interface ComplexityCheckConfig {
  maxTurns: number;                 // Worker's max turns limit (default: 100)
  autoDecompose: boolean;           // Legacy — kept for interface compat, not used
  escalateOnHighComplexity: boolean; // Legacy — kept for interface compat, not used
  complexityThreshold: number;      // Legacy — kept for interface compat, not used
  turnsWarningRatio: number;        // Legacy — kept for interface compat, not used
  tiers?: ComplexityTier[];         // Legacy — kept for interface compat, not used
}

const DEFAULT_COMPLEXITY_CHECK_CONFIG: ComplexityCheckConfig = {
  maxTurns: 100,
  autoDecompose: false,
  escalateOnHighComplexity: false,
  complexityThreshold: 6,
  turnsWarningRatio: 0.8,
  tiers: DEFAULT_COMPLEXITY_TIERS,
};

/**
 * Result of pre-claim complexity check (logging-only mode)
 */
export interface ComplexityCheckResult {
  shouldProceed: boolean;
  estimate: ComplexityEstimate | null;
  action: 'proceed' | 'proceed_extended' | 'decomposed' | 'escalated' | 'skipped';
  decompositionResult?: DecompositionResult;
  escalationId?: string;
  effectiveMaxTurns?: number;
  reason: string;
}

/**
 * Run pre-claim complexity check on a task (LOGGING-ONLY MODE).
 *
 * This no longer gates task execution. It estimates complexity and logs
 * the prediction for data collection, then always returns shouldProceed: true.
 * The logged data (predicted score, predicted turns) will be compared against
 * actual turns consumed to build better adaptive budgeting in the future.
 */
async function runPreClaimComplexityCheck(
  task: Task,
  outcomeId: string,
  intent: Intent | null,
  config: ComplexityCheckConfig,
  appendLog: (msg: string) => void
): Promise<ComplexityCheckResult> {
  // Guard: Skip tasks that are being decomposed or have already been decomposed.
  if (task.decomposition_status === 'in_progress' || task.decomposition_status === 'completed') {
    appendLog(`[Complexity] Skipping task ${task.id} - decomposition_status is '${task.decomposition_status}'`);
    return {
      shouldProceed: false,
      estimate: null,
      action: 'skipped',
      reason: `Task is ${task.decomposition_status === 'in_progress' ? 'currently being decomposed' : 'already decomposed into subtasks'}.`,
    };
  }

  // Skip estimation if task already has a recorded complexity score
  if (task.complexity_score !== null && task.complexity_score !== undefined) {
    appendLog(`[Complexity] Already estimated: score=${task.complexity_score}, turns=${task.estimated_turns ?? 'unknown'}`);
    return {
      shouldProceed: true,
      estimate: {
        complexity_score: task.complexity_score,
        estimated_turns: task.estimated_turns ?? config.maxTurns,
        confidence: 'high' as const,
        reasoning: 'Using pre-existing complexity estimate',
        risk_factors: [],
        recommendations: [],
      },
      action: 'proceed',
      reason: `Task has existing complexity score (${task.complexity_score}). Logging only — no gating.`,
    };
  }

  appendLog(`[Complexity] Estimating complexity for task: ${task.title} (logging only)`);

  try {
    // Estimate task complexity (for data collection)
    const estimate = await estimateTaskComplexity(
      {
        task,
        outcomeIntent: intent,
        priorTaskFailures: task.attempts,
      },
      {
        maxTurns: config.maxTurns,
        warningRatio: config.turnsWarningRatio,
        splitThreshold: config.complexityThreshold,
      }
    );

    appendLog(`[Complexity] Score: ${estimate.complexity_score}/10, Estimated turns: ${estimate.estimated_turns} (logged, not gating)`);

    // Log risk assessment for data collection
    const riskAssessment = assessTurnLimitRisk(estimate, config.maxTurns);
    appendLog(`[Complexity] Risk level: ${riskAssessment.riskLevel} (informational)`);

    // Always proceed — complexity is logged but does not gate execution
    return {
      shouldProceed: true,
      estimate,
      action: 'proceed',
      reason: `Complexity logged: score=${estimate.complexity_score}/10, turns=${estimate.estimated_turns}. No gating — generous turn budget applied.`,
    };

  } catch (error) {
    appendLog(`[Complexity] Estimation failed: ${error instanceof Error ? error.message : 'unknown'}`);

    // On error, proceed (no gating)
    return {
      shouldProceed: true,
      estimate: null,
      action: 'proceed',
      reason: `Complexity estimation failed, proceeding with task. Error: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
}

export interface RalphProgress {
  workerId: string;
  status: 'starting' | 'claiming' | 'running' | 'completed' | 'failed' | 'stopped';
  currentTaskId?: string;
  currentTaskTitle?: string;
  completedTasks: number;
  totalTasks: number;
  iteration: number;
  lastUpdate: number;
  error?: string;
}

export interface RalphResult {
  success: boolean;
  workerId: string;
  completedTasks: number;
  totalTasks: number;
  iterations: number;
  error?: string;
}

// Active workers map for tracking
const activeWorkers = new Map<string, {
  process: ChildProcess | null;
  config: RalphConfig;
  progress: RalphProgress;
  heartbeatInterval?: NodeJS.Timeout;
  running: boolean;
}>();

// ============================================================================
// Git Branch Management
// ============================================================================

/**
 * Get the current git branch
 */
function getCurrentBranch(): string | null {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Check out a branch, creating it if it doesn't exist
 * Returns the previous branch name for restoration later
 */
function checkoutWorkBranch(workBranch: string, baseBranch?: string): string | null {
  const previousBranch = getCurrentBranch();

  try {
    // Check if branch exists locally
    const localBranches = execSync('git branch --list', { encoding: 'utf-8' });
    const branchExists = localBranches.split('\n').some(b => b.trim().replace('* ', '') === workBranch);

    if (branchExists) {
      // Branch exists, just check it out
      execFileSync('git', ['checkout', workBranch], { encoding: 'utf-8', stdio: 'pipe' });
      console.log(`[Worker] Checked out existing branch: ${workBranch}`);
    } else {
      // Create new branch from base
      const base = baseBranch || 'main';
      execFileSync('git', ['checkout', '-b', workBranch, base], { encoding: 'utf-8', stdio: 'pipe' });
      console.log(`[Worker] Created and checked out new branch: ${workBranch} from ${base}`);
    }

    return previousBranch;
  } catch (err) {
    console.error(`[Worker] Failed to checkout branch ${workBranch}:`, err);
    return null;
  }
}

/**
 * Restore the previous branch (best effort)
 */
function restoreBranch(branchName: string): void {
  try {
    execFileSync('git', ['checkout', branchName], { encoding: 'utf-8', stdio: 'pipe' });
    console.log(`[Worker] Restored branch: ${branchName}`);
  } catch (err) {
    console.error(`[Worker] Failed to restore branch ${branchName}:`, err);
  }
}

// ============================================================================
// Instruction Generation
// ============================================================================

interface GitConfig {
  mode: string;
  workBranch?: string;
  baseBranch?: string;
  autoCommit: boolean;
}

/**
 * Generate CLAUDE.md instructions for the current task
 */
function generateTaskInstructions(
  outcomeName: string,
  intent: Intent | null,
  task: Task,
  additionalSkillContext?: string,
  outcomeId?: string,
  gitConfig?: GitConfig,
  isolationMode?: IsolationMode,
  workspacePath?: string
): string {
  const intentSummary = intent?.summary || 'No specific intent defined.';

  // Try to load relevant skills based on task title and description
  const searchQuery = `${task.title} ${task.description || ''}`;
  const skillContext = buildSkillContext(searchQuery, 2);

  // Combine built-in skill matching with any additional context from orchestrator
  const combinedSkillContext = [skillContext, additionalSkillContext]
    .filter(Boolean)
    .join('\n\n');

  // Get HOMЯ context (cross-task learnings) if available
  let homrContext = '';
  if (outcomeId && homr.isEnabled(outcomeId)) {
    homrContext = homr.buildTaskContext(task.id, outcomeId);
  }

  // Get the full design document for architectural context
  let designDocSection = '';
  if (outcomeId) {
    const designDoc = getDesignDoc(outcomeId);
    if (designDoc?.approach) {
      designDocSection = `## Design Document\n\nThis is the overall design/approach for the outcome. Use it for architectural context when making implementation decisions.\n\n${designDoc.approach}\n`;
    }
  }

  // Build git instructions if configured
  let gitInstructions = '';
  if (gitConfig && gitConfig.mode === 'branch' && gitConfig.workBranch) {
    gitInstructions = `
## Git Configuration

**IMPORTANT:** You are working on branch \`${gitConfig.workBranch}\`.
- Before committing, verify you are on the correct branch: \`git branch --show-current\`
- If not on \`${gitConfig.workBranch}\`, run: \`git checkout ${gitConfig.workBranch}\`
- All commits should go to this branch, NOT to main
${gitConfig.autoCommit ? '- Auto-commit is enabled: commit when making significant progress' : '- Manual commit mode: wait for explicit commit instruction'}

`;
  }

  // Build workspace isolation instructions
  let isolationInstructions = '';
  if (isolationMode === 'workspace' && workspacePath) {
    isolationInstructions = `
## Workspace Boundary

**CRITICAL:** This outcome operates in ISOLATED mode.
- Only create/modify files within: \`${workspacePath}/\`
- Do NOT modify files in app/, lib/, or other main codebase directories
- Do NOT access sensitive files (~/.ssh, ~/.aws, .env, credentials, etc.)
- If a task requires files outside workspace, report as ERROR in progress.txt

This isolation protects the main codebase. Violations will be flagged.

## File Paths

Your current working directory is a **task-specific** subdirectory. Other tasks have their own directories and CANNOT see files you create with relative paths.

**For shared outputs** (deliverables, documents, files that other tasks will read):
- ALWAYS use absolute paths starting with: \`${workspacePath}/\`
- Example: \`${workspacePath}/guide/final/my-output.md\`

**For scratch files** (intermediate notes only you need):
- Relative paths are fine (they stay in your task directory)

**IMPORTANT:** If your task description references files like \`guide/final/something.md\`, those are shared files. Use the absolute path: \`${workspacePath}/guide/final/something.md\`

`;
  } else if (isolationMode === 'codebase') {
    isolationInstructions = `
## Codebase Access Mode

This outcome has **codebase access** - you may modify files in the main codebase.
- Use this power responsibly - follow existing patterns and conventions
- Do NOT access sensitive files (~/.ssh, ~/.aws, .env, credentials, etc.)
- Prefer focused, minimal changes over broad refactoring

## File Paths

Your current working directory is a **task-specific** subdirectory. Other tasks have their own directories and CANNOT see files you create with relative paths.

**For shared outputs** (deliverables, documents, files that other tasks will read):
- Use absolute paths to the outcome workspace: \`${workspacePath}/\`
- Or absolute paths to the main codebase as needed

**For scratch files** (intermediate notes only you need):
- Relative paths are fine (they stay in your task directory)

`;
  }

  // Build teaching context from previous attempts and checkpoints
  const teachingContext = buildTeachingContext(task.id);

  return `# Current Task

## Outcome: ${outcomeName}
${intentSummary}

---
${isolationInstructions}${gitInstructions}${homrContext ? `\n${homrContext}` : ''}
${designDocSection ? `${designDocSection}\n---\n` : ''}${teachingContext ? `${teachingContext}\n---\n` : ''}## Your Current Task

**ID:** ${task.id}
**Title:** ${task.title}

${task.description || 'No additional description provided.'}

${task.prd_context ? `### PRD Context\n${task.prd_context}\n` : ''}
${task.design_context ? `### Design Context\n${task.design_context}\n` : ''}
${task.task_intent ? `### Task Intent\n${task.task_intent}\n` : ''}
${task.task_approach ? `### Task Approach\n${task.task_approach}\n` : ''}
${(() => {
  // Inject satisfied gate response data as human input
  try {
    const gates = task.gates ? JSON.parse(task.gates) : [];
    const satisfiedWithData = gates.filter((g: { status: string; response_data: string | null }) => g.status === 'satisfied' && g.response_data);
    if (satisfiedWithData.length > 0) {
      let section = '### Human Input\nThe following human input was provided for this task:\n\n';
      for (const gate of satisfiedWithData) {
        section += `#### ${gate.label}\n${gate.response_data}\n\n`;
      }
      return section;
    }
  } catch { /* ignore parse errors */ }
  return '';
})()}
---
${combinedSkillContext ? `\n${combinedSkillContext}\n---\n` : ''}
## Instructions

1. Complete the task described above
2. Write your progress to \`progress.txt\` as you work
3. When finished, write \`DONE\` to progress.txt

## Progress Format
\`\`\`
STATUS: [what you're currently doing]
DONE  (when complete, include this on its own line)
ERROR: [if you hit a blocker, describe it]
\`\`\`

## Rules
- Focus only on this specific task
- Create clean, well-structured code
${gitConfig?.workBranch ? `- Commit to branch \`${gitConfig.workBranch}\` when making significant progress` : '- Commit your work when making significant progress'}
- If you hit a blocker you can't resolve, write ERROR: [reason]
- When complete, write DONE and stop
${task.verify_command ? `\n## Verification\nAfter completing your work, verify it passes: \`${task.verify_command}\`` : ''}
Start by understanding the task, then implement it.
`;
}

/**
 * Generate initial progress.txt
 */
function generateInitialProgress(task: Task): string {
  return `STATUS: Starting task - ${task.title}
`;
}

/**
 * Parse progress.txt content
 */
function parseTaskProgress(content: string): {
  status: string;
  done: boolean;
  error?: string;
} {
  const lines = content.split('\n');
  let status = 'Working';
  let done = false;
  let error: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('STATUS:')) {
      status = trimmed.replace('STATUS:', '').trim();
    } else if (trimmed === 'DONE') {
      done = true;
    } else if (trimmed.startsWith('ERROR:')) {
      error = trimmed.replace('ERROR:', '').trim();
    }
  }

  return { status, done, error };
}

// ============================================================================
// Skill & Tool Catalogs
// ============================================================================

/**
 * Extract a description from a tool file by reading its first comment block.
 * Reads at most 500 bytes and parses // or /** ... * / style comments.
 */
function extractToolDescription(filePath: string): string {
  try {
    const fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(500);
    const bytesRead = readSync(fd, buffer, 0, 500, 0);
    closeSync(fd);
    const head = buffer.toString('utf-8', 0, bytesRead);

    // Try JSDoc: /** ... */
    const jsdocMatch = head.match(/\/\*\*\s*\n?\s*\*?\s*(.+?)(?:\n|\*\/)/);
    if (jsdocMatch) {
      return jsdocMatch[1].trim();
    }

    // Try single-line comment on first non-empty line
    const lines = head.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) {
        const comment = trimmed.replace(/^\/\/\s*/, '').trim();
        if (comment.length > 5) return comment;
      }
      // Skip empty lines and shebang
      if (trimmed && !trimmed.startsWith('#!')) break;
    }
  } catch {
    // File read error
  }
  return 'See file for details';
}

/**
 * Build a lightweight skill catalog table for worker CLAUDE.md.
 * Lists skill names, triggers, and file paths — no full content.
 */
function buildSkillCatalog(
  outcomeId: string,
  appendLog: (msg: string) => void
): string {
  const outcomeSkills = loadOutcomeSkills(outcomeId);
  if (outcomeSkills.length === 0) return '';

  const lines = [
    '## Available Skills',
    '',
    'Skills are available in `../skills/`. Read the full skill file when your task',
    'matches the triggers listed below.',
    '',
    '| Skill | Triggers | Description |',
    '|-------|----------|-------------|',
  ];

  for (const skill of outcomeSkills) {
    const kebabName = skill.name.toLowerCase().replace(/\s+/g, '-');
    const triggers = skill.triggers.length > 0 ? skill.triggers.join(', ') : 'N/A';
    const desc = skill.description || 'See skill file';
    lines.push(`| ${skill.name} | ${triggers} | ${desc} |`);
    // Keep the file path reference visible
    lines.push('');
  }

  lines.push('');
  lines.push('To use a skill: Read `../skills/{skill-name}.md` for the full methodology.');

  appendLog(`Built skill catalog with ${outcomeSkills.length} skills`);
  return lines.join('\n');
}

/**
 * Build a lightweight tool catalog table for worker CLAUDE.md.
 * Lists tool names, types, and descriptions extracted from file headers.
 */
function buildToolCatalog(
  outcomeId: string,
  appendLog: (msg: string) => void
): string {
  const tools = loadOutcomeTools(outcomeId);
  if (tools.length === 0) return '';

  const lines = [
    '## Available Tools',
    '',
    'Executable tools in `../tools/`. Import or call when needed for your task.',
    '',
    '| Tool | Type | Description |',
    '|------|------|-------------|',
  ];

  for (const tool of tools) {
    const desc = extractToolDescription(tool.path);
    lines.push(`| ${tool.name} | ${tool.type} | ${desc} |`);
  }

  lines.push('');
  lines.push('To use a tool: Read `../tools/{tool-name}.ts` to see its exports and usage.');

  appendLog(`Built tool catalog with ${tools.length} tools`);
  return lines.join('\n');
}

/**
 * Build a lightweight document catalog table for worker CLAUDE.md.
 * Lists documents uploaded to the outcome's docs/ directory.
 */
function buildDocumentCatalog(
  outcomeId: string,
  appendLog: (msg: string) => void
): string {
  const docsPath = join(paths.workspaces, outcomeId, 'docs');
  if (!existsSync(docsPath)) return '';

  let entries: string[];
  try {
    entries = readdirSync(docsPath).filter(f => !f.startsWith('.'));
  } catch {
    return '';
  }
  if (entries.length === 0) return '';

  const extTypeMap: Record<string, string> = {
    '.md': 'markdown', '.txt': 'text', '.pdf': 'pdf',
    '.csv': 'csv', '.tsv': 'tsv', '.json': 'json',
    '.xml': 'xml', '.html': 'html', '.htm': 'html',
    '.doc': 'word', '.docx': 'word', '.xls': 'excel',
    '.xlsx': 'excel', '.png': 'image', '.jpg': 'image',
    '.jpeg': 'image', '.gif': 'image', '.svg': 'svg',
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const extractDescription = (filePath: string): string => {
    try {
      const fd = openSync(filePath, 'r');
      const buffer = Buffer.alloc(200);
      const bytesRead = readSync(fd, buffer, 0, 200, 0);
      closeSync(fd);
      const head = buffer.toString('utf-8', 0, bytesRead);

      // Try first markdown heading
      const headingMatch = head.match(/^#+\s+(.+)/m);
      if (headingMatch) return headingMatch[1].trim();

      // Try first non-empty line
      for (const line of head.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
        }
      }
    } catch {
      // Binary file or read error
    }
    return 'Read file for details';
  };

  const lines = [
    '## Available Documents',
    '',
    'Reference documents uploaded for this outcome are in `../docs/`.',
    'Read any document relevant to your current task.',
    '',
    '| Document | Type | Size | Description |',
    '|----------|------|------|-------------|',
  ];

  for (const entry of entries) {
    const filePath = join(docsPath, entry);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const ext = entry.includes('.') ? '.' + entry.split('.').pop()!.toLowerCase() : '';
    const type = extTypeMap[ext] || ext.replace('.', '') || 'file';
    const size = formatSize(stat.size);
    const name = entry.replace(/\.[^.]+$/, '');
    const desc = extractDescription(filePath);

    lines.push(`| ${name} | ${type} | ${size} | ${desc} |`);
  }

  lines.push('');
  lines.push('To use a document: Read `../docs/{filename}` for the full content.');

  appendLog(`Built document catalog with ${entries.length} documents`);
  return lines.join('\n');
}

// ============================================================================
// Progress Extraction
// ============================================================================

/**
 * Extract a progress summary from Claude CLI full output.
 * Looks for STATUS lines in progress.txt-style output and the last
 * meaningful content before turn exhaustion.
 */
function extractProgressSummary(fullOutput?: string): string | null {
  if (!fullOutput) return null;

  const summaryParts: string[] = [];

  // Look for STATUS lines (from progress.txt updates captured in output)
  const statusMatches = fullOutput.match(/STATUS:\s*(.+)/g);
  if (statusMatches && statusMatches.length > 0) {
    // Take the last few status updates
    const recent = statusMatches.slice(-3).map(s => s.replace(/^STATUS:\s*/, '').trim());
    summaryParts.push(`Last status: ${recent.join(' → ')}`);
  }

  // Look for commit messages (evidence of completed work)
  const commitMatches = fullOutput.match(/\[(?:main|HEAD|[\w/-]+)\s+\w{7,}\]\s*(.+)/g);
  if (commitMatches && commitMatches.length > 0) {
    summaryParts.push(`Commits: ${commitMatches.length}`);
  }

  // Look for file creation/modification signals
  const fileMatches = fullOutput.match(/(?:Created|Modified|Updated|Wrote)\s+(?:file\s+)?[`"]?([^\s`"]+)/gi);
  if (fileMatches && fileMatches.length > 0) {
    const uniqueFiles = Array.from(new Set(fileMatches.slice(-5)));
    summaryParts.push(`Files touched: ${uniqueFiles.join(', ')}`);
  }

  return summaryParts.length > 0 ? summaryParts.join('. ') : null;
}

// ============================================================================
// Main Worker Loop
// ============================================================================

/**
 * Start a Ralph worker for an outcome
 */
export async function startRalphWorker(
  config: RalphConfig,
  onProgress?: (progress: RalphProgress) => void
): Promise<{ workerId: string; started: boolean; error?: string }> {
  const {
    outcomeId,
    workspacePath = paths.workspaces,
    maxIterations = 50,
    heartbeatIntervalMs = 30000,
    useWorktree = false,
    circuitBreakerThreshold = 3,
    enableComplexityCheck = true,
    autoDecompose = false,
    maxTurns = getDefaultTurnBudget(),
  } = config;

  // Build complexity check config
  const complexityCheckConfig: ComplexityCheckConfig = {
    maxTurns,
    autoDecompose,
    escalateOnHighComplexity: true,
    complexityThreshold: 6,
    turnsWarningRatio: 0.8,
    tiers: DEFAULT_COMPLEXITY_TIERS,
  };

  // Verify outcome exists
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { workerId: '', started: false, error: 'Outcome not found' };
  }

  // Parse intent if available
  let intent: Intent | null = null;
  if (outcome.intent) {
    try {
      intent = JSON.parse(outcome.intent) as Intent;
    } catch {
      // Intent might not be valid JSON
    }
  }

  // Create worker in database first (needed for worktree branch name)
  const workerName = `Ralph Worker ${Date.now()}`;
  const dbWorker = createWorker({
    outcome_id: outcomeId,
    name: workerName,
  });
  const workerId = dbWorker.id;

  // Build git configuration from outcome settings
  const gitConfig: GitConfig = {
    mode: outcome.git_mode || 'none',
    workBranch: outcome.work_branch || undefined,
    baseBranch: outcome.base_branch || 'main',
    autoCommit: Boolean(outcome.auto_commit),
  };

  // Track previous branch for restoration when worker completes
  let previousBranch: string | null = null;

  // Set up workspace - either worktree or shared
  let outcomeWorkspace: string;
  let worktreePath: string | null = null;
  let branchName: string | null = null;

  if (useWorktree && isGitRepo()) {
    try {
      const worktree = createWorktree(outcomeId, workerId);
      worktreePath = worktree.path;
      branchName = worktree.branch;
      outcomeWorkspace = worktree.path;

      // Update worker with worktree info
      updateWorkerDb(workerId, {
        worktree_path: worktreePath,
        branch_name: branchName,
      });

      console.log(`[Worker] Using worktree at ${worktreePath} on branch ${branchName}`);
    } catch (err) {
      console.error('[Worker] Failed to create worktree, falling back to shared workspace:', err);
      // Fall back to shared workspace
      outcomeWorkspace = join(workspacePath, outcomeId);
    }
  } else {
    // Create shared workspace
    outcomeWorkspace = join(workspacePath, outcomeId);
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    if (!existsSync(outcomeWorkspace)) {
      mkdirSync(outcomeWorkspace, { recursive: true });
    }

    // If git_mode is 'branch' and not using worktree, check out the work branch
    if (gitConfig.mode === 'branch' && gitConfig.workBranch && isGitRepo()) {
      previousBranch = checkoutWorkBranch(gitConfig.workBranch, gitConfig.baseBranch);
      branchName = gitConfig.workBranch;

      // Update worker with branch info
      updateWorkerDb(workerId, {
        branch_name: branchName,
      });
    }
  }

  // Start the worker (sets status to 'running', started_at, heartbeat)
  startWorkerDb(workerId);

  // Log worker started activity
  logWorkerStarted(outcomeId, outcome.name, workerName, workerId);
  getEventBus().emit({ type: 'worker.started', outcomeId, workerId, timestamp: new Date().toISOString() });

  // Get initial task stats
  const stats = getTaskStats(outcomeId);

  // Initialize progress
  const progress: RalphProgress = {
    workerId,
    status: 'starting',
    completedTasks: stats.completed,
    totalTasks: stats.total,
    iteration: 0,
    lastUpdate: Date.now(),
  };

  // Track the worker
  activeWorkers.set(workerId, {
    process: null,
    config,
    progress,
    running: true,
  });

  // Log file for all worker activity
  const logPath = join(outcomeWorkspace, `worker-${workerId}.log`);
  const appendLog = (message: string) => {
    const timestamp = new Date().toISOString();
    writeFileSync(logPath, `[${timestamp}] ${message}\n`, { flag: 'a' });
  };

  appendLog(`Worker started for outcome: ${outcome.name}`);

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    sendHeartbeat(workerId);
  }, heartbeatIntervalMs);

  const workerState = activeWorkers.get(workerId)!;
  workerState.heartbeatInterval = heartbeatInterval;

  // Notify initial progress
  if (onProgress) {
    onProgress({ ...progress });
  }

  // Start supervisor BEFORE the work loop (critical for security)
  const supervisorResult = await startSupervisor(outcomeId, workerId);
  if (!supervisorResult.success) {
    appendLog(`Warning: Supervisor failed to start - ${supervisorResult.error}`);
    // Continue anyway, but log the warning
  } else {
    appendLog(`Supervisor started and monitoring workspace`);
  }

  // Check skill dependencies and create capability tasks if needed
  const skillDepsCheck = areSkillDependenciesMet(outcomeId);
  if (!skillDepsCheck.allMet) {
    appendLog(`Warning: Missing skills detected: ${skillDepsCheck.missingSkills.join(', ')}`);

    // Resolve by creating capability tasks
    const resolution = resolveSkillDependencies(outcomeId);
    if (resolution.tasksCreated > 0) {
      appendLog(`Created ${resolution.tasksCreated} capability tasks for missing skills`);
    }

    // Note: Worker continues - claimNextTask will skip tasks with unsatisfied dependencies
    // This allows capability tasks to be processed first
  }

  // Build lightweight skill, tool, and document catalogs (summaries, not full content)
  const outcomeSkillContext = buildSkillCatalog(outcomeId, appendLog)
    + '\n\n' + buildToolCatalog(outcomeId, appendLog)
    + '\n\n' + buildDocumentCatalog(outcomeId, appendLog);

  // Start the work loop (with self-healing restart wrapper)
  (async () => {
    const selfHeal = config.selfHeal !== false; // Default true
    const healCfg: SelfHealConfig = { ...DEFAULT_SELF_HEAL, ...config.selfHealConfig };
    let restartCount = 0;
    let backoffMs = healCfg.initialBackoffMs;

    // eslint-disable-next-line no-restricted-syntax
    restart: while (true) {
      let iteration = 0;
      let exitReason: WorkerExitReason = 'unknown';
      let hasError = false;
      let errorMessage: string | undefined;

      try {
        while (workerState.running && iteration < maxIterations) {
          iteration++;
          incrementIteration(workerId);

          // Check if worker has been paused via API
          if (isWorkerPaused(workerId)) {
            appendLog(`Worker paused via API - stopping loop`);
            workerState.running = false;
            exitReason = 'user_paused';
            break;
          }

          // Check for pending interventions before claiming next task
          const interventions = getPendingInterventionsForWorker(workerId, outcomeId);
          for (const intervention of interventions) {
            appendLog(`Processing intervention: ${intervention.type} - ${intervention.message}`);
            acknowledgeIntervention(intervention.id);

            switch (intervention.type) {
              case 'add_task':
                // Task was already created by the API, just log it
                createProgressEntry({
                  outcome_id: outcomeId,
                  worker_id: workerId,
                  iteration,
                  content: `Intervention: Added task - ${intervention.message}`,
                });
                completeIntervention(intervention.id);
                break;

              case 'redirect':
                // Store redirect message to inject into next task context
                createProgressEntry({
                  outcome_id: outcomeId,
                  worker_id: workerId,
                  iteration,
                  content: `Intervention: Redirect instruction - ${intervention.message}`,
                });
                // The redirect message will be visible in progress, worker sees it
                appendLog(`Redirect instruction received: ${intervention.message}`);
                completeIntervention(intervention.id);
                break;

              case 'pause':
                createProgressEntry({
                  outcome_id: outcomeId,
                  worker_id: workerId,
                  iteration,
                  content: `Intervention: Paused - ${intervention.message || 'User requested pause'}`,
                });
                appendLog(`Pause intervention received, stopping worker`);
                completeIntervention(intervention.id);
                workerState.running = false;
                break;

              case 'priority_change':
                // Priority changes are handled at the task level, just acknowledge
                completeIntervention(intervention.id);
                break;
            }

            // If paused, break out of intervention loop
            if (!workerState.running) break;
          }

          // Check if we were paused by an intervention
          if (!workerState.running) {
            appendLog(`Worker paused by intervention`);
            exitReason = 'user_paused';
            break;
          }

          // Update progress
          progress.status = 'claiming';
          progress.iteration = iteration;
          progress.lastUpdate = Date.now();
          if (onProgress) onProgress({ ...progress });

          appendLog(`Iteration ${iteration}: Claiming next task...`);

          // Try to claim a task
          const claimResult = claimNextTask(outcomeId, workerId);

          if (!claimResult.success || !claimResult.task) {
            // Check for failed tasks blocking pending work (auto-retry)
            const { getMaxAutoRetries } = require('../db/system-config');
            const maxAutoRetries = getMaxAutoRetries();
            const failedBlockers = getFailedBlockerTasks(outcomeId);

            if (failedBlockers.length > 0 && maxAutoRetries > 0) {
              // Check which blockers are eligible for auto-retry
              // A task can be auto-retried if its total attempts < max_attempts * (1 + maxAutoRetries)
              // e.g., max_attempts=3, maxAutoRetries=2 → up to 9 total attempts (3 original + 3×2 retries)
              const eligibleBlockers = failedBlockers.filter(t => {
                const totalBudget = t.max_attempts * (1 + maxAutoRetries);
                const totalAttempts = getAttemptCount(t.id);
                return totalAttempts < totalBudget;
              });

              if (eligibleBlockers.length > 0) {
                appendLog(`[Auto-Retry] Found ${failedBlockers.length} failed task(s) blocking progress. ${eligibleBlockers.length} eligible for retry.`);
                for (const blocker of eligibleBlockers) {
                  const attemptsSoFar = getAttemptCount(blocker.id);
                  resetTaskForRetry(blocker.id);
                  appendLog(`[Auto-Retry] Reset "${blocker.title}" (${blocker.id}) to pending (${attemptsSoFar} prior attempts)`);
                  getEventBus().emit({
                    type: 'task.auto_retried' as any,
                    outcomeId,
                    workerId,
                    taskId: blocker.id,
                    timestamp: new Date().toISOString(),
                    data: { attemptsSoFar, reason: 'dependency_deadlock' },
                  });
                }
                // Continue the loop — claimNextTask will now find work
                appendLog(`[Auto-Retry] Continuing worker loop...`);
                continue;
              }
            }

            // Check for gated tasks to provide diagnostic message
            const { getTasksWithPendingGates } = require('../db/tasks');
            const gatedTasks = getTasksWithPendingGates(outcomeId);
            if (gatedTasks.length > 0) {
              appendLog(`No claimable tasks. ${gatedTasks.length} task(s) are gated on human input.`);
              for (const { task: gt, pendingGates } of gatedTasks) {
                const gateLabels = pendingGates.map((g: { label: string }) => g.label).join(', ');
                appendLog(`  - "${gt.title}" (${gateLabels})`);
              }
              exitReason = 'gate_reached';
            } else if (failedBlockers.length > 0) {
              // Failed blockers exist but none are eligible for retry — budget exhausted
              appendLog(`[Auto-Retry] ${failedBlockers.length} failed blocker(s) have exhausted retry budget. Manual intervention needed.`);
              for (const blocker of failedBlockers) {
                appendLog(`  - "${blocker.title}" (${blocker.id}, ${getAttemptCount(blocker.id)} attempts)`);
              }
              exitReason = 'all_tasks_complete';
            } else {
              const pendingTasks = getPendingTasks(outcomeId);
              if (pendingTasks.length > 0) {
                appendLog(`No claimable task right now (${pendingTasks.length} pending). Reason: ${claimResult.reason || 'unknown'}. Retrying...`);
                await sleepMs(1500);
                continue;
              }

              appendLog(`No more pending tasks. Work complete.`);
              exitReason = 'all_tasks_complete';
            }
            break;
          }

          const task = claimResult.task;
          appendLog(`Claimed task: ${task.title} (${task.id})`);
          logTaskClaimed(outcomeId, outcome.name, task.title, workerName);
          getEventBus().emit({ type: 'task.claimed', outcomeId, workerId, taskId: task.id, timestamp: new Date().toISOString() });

          // Safety intent check — blocks execution if prompt injection or malicious content detected
          try {
            appendLog(`[Safety] Running pre-execution safety check...`);
            const safetyResult = await runSafetyCheck(task, outcomeId, intent);

            if (!safetyResult.safe) {
              appendLog(`[Safety] BLOCKED: ${safetyResult.summary} (severity: ${safetyResult.severity})`);
              for (const issue of safetyResult.issues) {
                appendLog(`[Safety]   - [${issue.type}] ${issue.description}`);
              }

              // Release the task
              if (!releaseTask(task.id)) {
                appendLog(`[Safety] Failed to release blocked task ${task.id}`);
              }

              // Create HOMR escalation for human review
              const safetySignal = buildSafetyEscalationSignal(task, safetyResult);
              try {
                const escalationId = await homr.createEscalation(outcomeId, safetySignal, task);
                appendLog(`[Safety] Escalation created: ${escalationId}`);
              } catch (escError) {
                appendLog(`[Safety] Failed to create escalation: ${escError instanceof Error ? escError.message : 'unknown'}`);
              }

              createProgressEntry({
                outcome_id: outcomeId,
                worker_id: workerId,
                iteration,
                content: `Safety check BLOCKED: ${task.title} — ${safetyResult.summary}`,
              });

              workerState.running = false;
              exitReason = 'safety_blocked';
              break;
            }

            appendLog(`[Safety] Passed (${safetyResult.summary})`);
          } catch (safetyError) {
            // Safety check failure should not block the task — log and continue
            appendLog(`[Safety] Check failed (non-blocking): ${safetyError instanceof Error ? safetyError.message : 'unknown'}`);
          }

          // If safety check paused us, break out
          if (!workerState.running) break;

          // Complexity check (logging only — no gating)
          if (enableComplexityCheck) {
            const complexityResult = await runPreClaimComplexityCheck(
              task,
              outcomeId,
              intent,
              complexityCheckConfig,
              appendLog
            );

            // Only case where we don't proceed: task is mid-decomposition
            if (!complexityResult.shouldProceed) {
              appendLog(`[Complexity] Skipping decomposed task: ${complexityResult.reason}`);
              if (!releaseTask(task.id)) {
                appendLog(`[Complexity] Failed to release decomposed task ${task.id}`);
              }
              continue;
            }

            // Store estimate on task for future data collection
            if (complexityResult.estimate) {
              updateTaskDb(task.id, {
                complexity_score: complexityResult.estimate.complexity_score,
                estimated_turns: complexityResult.estimate.estimated_turns,
              });
            }
          }

          // Update progress
          progress.status = 'running';
          progress.currentTaskId = task.id;
          progress.currentTaskTitle = task.title;
          progress.lastUpdate = Date.now();
          if (onProgress) onProgress({ ...progress });

          // Mark task as running
          const startedTask = startTask(task.id);
          if (!startedTask) {
            appendLog(`Failed to transition task to running: ${task.id}`);
            if (!releaseTask(task.id)) {
              appendLog(`Failed to release unstarted task: ${task.id}`);
            }
            continue;
          }
          const taskStartTime = Date.now();

          // Create task workspace
          const taskWorkspace = join(outcomeWorkspace, task.id);
          if (!existsSync(taskWorkspace)) {
            mkdirSync(taskWorkspace, { recursive: true });
          }

          // Evolve mode: if task has metric_command, use hill-climbing optimization loop
          if (task.metric_command) {
            appendLog(`[Evolve] Task has metric_command — entering evolve mode`);

            // If task has an eval recipe, regenerate eval.sh before running
            let recipeContext = '';
            let resolvedRecipe: import('../evolve/recipe-parser').EvolveRecipe | null = null;
            if (task.eval_recipe_name) {
              try {
                const { parseRecipe } = await import('../evolve/recipe-parser');
                const { writeEvalToWorkspace } = await import('../evolve/eval-generator');
                const { findEvalByName, getEvalContent } = await import('../evolve/eval-manager');
                const evalMeta = findEvalByName(task.eval_recipe_name, outcomeId);
                if (evalMeta) {
                  const recipeContent = getEvalContent(evalMeta.path);
                  if (recipeContent) {
                    const recipe = parseRecipe(recipeContent);
                    if (!('error' in recipe)) {
                      // Apply task-level overrides if present
                      let finalRecipe = recipe;
                      if (task.eval_overrides) {
                        try {
                          const overrides = JSON.parse(task.eval_overrides);
                          const { applyOverrides } = await import('../evolve/recipe-parser');
                          finalRecipe = applyOverrides(recipe, overrides);
                        } catch (e) {
                          appendLog(`[Evolve] Warning: could not apply eval overrides: ${e}`);
                        }
                      }
                      resolvedRecipe = finalRecipe;
                      writeEvalToWorkspace(finalRecipe, taskWorkspace);
                      appendLog(`[Evolve] Regenerated eval.sh from recipe: ${task.eval_recipe_name}`);
                      // Build criteria context — strip weights and calibration examples (18a scoring isolation)
                      if (finalRecipe.criteria.length > 0) {
                        recipeContext = '\n### What the metric evaluates\n' +
                          finalRecipe.criteria.map(c => `- **${c.name}**: ${c.description}`).join('\n');
                      }
                      // Calibration examples intentionally omitted — agent should not see judge internals
                    }
                  }
                }
              } catch (recipeErr) {
                appendLog(`[Evolve] Warning: could not regenerate eval.sh from recipe: ${recipeErr}`);
              }
            }

            try {
              const { runEvolveLoop } = await import('./evolve-loop');
              const evolveResult = await runEvolveLoop(
                {
                  id: task.id,
                  outcome_id: String(task.outcome_id),
                  title: task.title,
                  description: task.description || '',
                  metric_command: task.metric_command,
                  metric_baseline: task.metric_baseline,
                  optimization_budget: task.optimization_budget || 5,
                  metric_direction: (task.metric_direction as 'lower' | 'higher') || 'lower',
                  plateau_threshold: resolvedRecipe?.scoring.plateau_threshold,
                  artifact_file: resolvedRecipe?.artifact.file,
                },
                taskWorkspace, // Use task-level workspace to avoid git conflicts with concurrent workers
                async (evolveTask, iter, previousExperiments, wsPath) => {
                  // Write evolve CLAUDE.md with iteration context
                  const evolveClaudeMd = join(taskWorkspace, 'CLAUDE.md');
                  const direction = task.metric_direction === 'higher' ? 'higher' : 'lower';
                  const isJudgeMode = resolvedRecipe?.scoring.mode === 'judge';

                  // Build metric info — hide command path for judge-mode evals (18a)
                  const metricInfo = isJudgeMode
                    ? `**Optimization goal:** ${direction === 'higher' ? 'Increase' : 'Decrease'} the metric value (${direction} is better)`
                    : `**Metric command:** \`${evolveTask.metric_command}\`\n**Optimization goal:** ${direction === 'higher' ? 'Increase' : 'Decrease'} the metric value (${direction} is better)`;

                  // Build allowed files section (18f)
                  const artifactFile = resolvedRecipe?.artifact.file;
                  const allowedFilesSection = artifactFile
                    ? `You may ONLY modify: \`${artifactFile}\` and files in \`state/\`.`
                    : '';

                  const evolveInstructions = generateTaskInstructions(
                    outcome.name,
                    intent,
                    task,
                    outcomeSkillContext || undefined,
                    outcomeId,
                    gitConfig,
                    outcome.isolation_mode || 'workspace',
                    wsPath
                  ) + `
## Evolve Mode — Iteration ${iter} of ${evolveTask.optimization_budget}

${metricInfo}

${previousExperiments ? `${previousExperiments}\n` : ''}
${recipeContext ? `${recipeContext}\n` : ''}
## Simplicity Rule

All else being equal, simpler is better.
- A marginal improvement that adds substantial complexity is NOT worth it.
- Removing code/text while maintaining or improving the metric is an EXCELLENT outcome.
- If you run out of ideas, try simplifying what is already there.
- Do not add complexity unless the metric improvement clearly justifies it.

## Scoring Boundary

The scoring system is hidden. Do NOT read, modify, or recreate files in .evolve/.
Focus on genuinely improving the artifact. The metric measures your changes automatically.

## Allowed Files

${allowedFilesSection}
Do NOT modify: .evolve/, .gitignore, CLAUDE.md, or progress.txt.
Changes outside these boundaries will be automatically rejected.

## Evolve Instructions

1. ${isJudgeMode ? 'Focus on genuinely improving the artifact' : 'Analyze the metric command to understand what you are optimizing'}
2. Make ONE focused, targeted change that you hypothesize will ${direction === 'higher' ? 'increase' : 'reduce'} the metric value
3. Do NOT make sweeping changes — one hypothesis per iteration
4. Do NOT repeat approaches that have already been tried and reverted
5. After making your change, write a ONE-LINE summary of what you changed and why to progress.txt
6. Then write DONE to progress.txt

The system will automatically measure the metric and keep or revert your change.
`;
                  writeFileSync(evolveClaudeMd, evolveInstructions);

                  const evolveProgressPath = join(taskWorkspace, 'progress.txt');
                  writeFileSync(evolveProgressPath, `STATUS: Evolve iteration ${iter} — analyzing metric and planning change\n`);

                  const evolvePrompt = `You are optimizing a metric through targeted, minimal changes. Read CLAUDE.md for full context and instructions. Make ONE focused change, then write a one-line summary to progress.txt and write DONE.`;

                  const evolveArgs = [
                    '-p', evolvePrompt,
                    '--dangerously-skip-permissions',
                    '--output-format', 'json',
                    '--max-turns', String(Math.max(maxTurns, 20)),
                  ];

                  const iterGuardContext: TaskGuardContext = {
                    workerId,
                    outcomeId,
                    taskId: task.id,
                    workspacePath: wsPath,
                  };

                  const iterResult = await executeTask(
                    taskWorkspace,
                    evolveArgs,
                    evolveProgressPath,
                    workerId,
                    task,
                    appendLog,
                    iterGuardContext
                  );

                  if (!iterResult.success) {
                    appendLog(`[Evolve] Iteration ${iter} failed: ${iterResult.error}`);
                    return null;
                  }

                  // Extract change summary from progress.txt (first STATUS: line)
                  try {
                    const progressContent = readFileSync(evolveProgressPath, 'utf-8');
                    const statusMatch = progressContent.match(/^STATUS:\s*(.+)$/m);
                    return statusMatch ? statusMatch[1].trim() : 'change made';
                  } catch {
                    return 'change made';
                  }
                }
              );

              appendLog(`[Evolve] Completed: ${evolveResult.iterations} iterations, improvement=${evolveResult.improvement}, stopped=${evolveResult.stopped}`);

              if (!completeTask(task.id)) {
                appendLog(`[Evolve] Failed to mark task completed in DB: ${task.id}`);
                if (!failTask(task.id)) {
                  appendLog(`[Evolve] Failed to mark task failed after completion transition error: ${task.id}`);
                }
                recordFailure(outcomeId, task.id, 'Evolve completion state transition failed');
                continue;
              }
              progress.completedTasks++;
              logTaskCompleted(outcomeId, outcome.name, task.title, workerId);
              getEventBus().emit({ type: 'task.completed', outcomeId, workerId, taskId: task.id, timestamp: new Date().toISOString() });
              recordSuccess(outcomeId);

              createProgressEntry({
                outcome_id: outcomeId,
                worker_id: workerId,
                iteration,
                content: `Evolve mode completed: ${task.title} — ${evolveResult.iterations} iterations, improvement=${evolveResult.improvement} (${evolveResult.stopped})`,
                task_id: task.id,
              });

              // Update stats and continue
              const evolveStats = getTaskStats(outcomeId);
              progress.totalTasks = evolveStats.total;
              progress.completedTasks = evolveStats.completed;
              progress.lastUpdate = Date.now();
              if (evolveStats.pending === 0 && evolveStats.claimed === 0 && evolveStats.running === 0) {
                exitReason = 'all_tasks_complete';
                break;
              }
              continue;
            } catch (evolveError) {
              appendLog(`[Evolve] Evolve loop error: ${evolveError instanceof Error ? evolveError.message : 'unknown'}`);
              if (!failTask(task.id)) {
                appendLog(`[Evolve] Failed to transition task to failed state: ${task.id}`);
              }
              recordFailure(outcomeId, task.id, `Evolve mode error: ${evolveError instanceof Error ? evolveError.message : 'unknown'}`);
              continue;
            }
          }

          // Write CLAUDE.md and progress.txt
          const claudeMdPath = join(taskWorkspace, 'CLAUDE.md');
          writeFileSync(claudeMdPath, generateTaskInstructions(
            outcome.name,
            intent,
            task,
            outcomeSkillContext || undefined,
            outcomeId,
            gitConfig,
            outcome.isolation_mode || 'workspace',
            outcomeWorkspace
          ));

          const progressPath = join(taskWorkspace, 'progress.txt');
          writeFileSync(progressPath, generateInitialProgress(task));

          // Spawn Claude for this task
          const ralphPrompt = `You are working on a specific task. Read CLAUDE.md for full instructions.
Complete the task, updating progress.txt as you go. When done, write DONE to progress.txt.`;

          // Use task's max_attempts if it's been increased (e.g., via HOMЯ escalation), otherwise use config default
          const taskMaxTurns = Math.max(task.max_attempts || maxTurns, maxTurns);

          const args = [
            '-p', ralphPrompt,
            '--dangerously-skip-permissions',
            '--output-format', 'json',
            '--max-turns', String(taskMaxTurns),
          ];

          appendLog(`Spawning Claude for task (max turns: ${taskMaxTurns})`);

          // Build guard context for command validation
          const taskGuardContext: TaskGuardContext = {
            workerId,
            outcomeId,
            taskId: task.id,
            workspacePath: outcomeWorkspace,
          };

          const taskResult = await executeTask(
            taskWorkspace,
            args,
            progressPath,
            workerId,
            task,
            appendLog,
            taskGuardContext
          );

          // Log guard activity if any commands were blocked
          if (taskResult.guardBlocks && taskResult.guardBlocks > 0) {
            appendLog(`[Guard] ${taskResult.guardBlocks} dangerous commands were blocked during task execution`);
          }

          // Rate limit: release task back to pending and pause the worker
          if (taskResult.rateLimited) {
            appendLog(`[Rate Limit] Hit subscription limit. Releasing task "${task.title}" back to pending.`);
            if (!releaseTask(task.id)) {
              appendLog(`[Rate Limit] Failed to release task ${task.id} after rate limit`);
            }
            createProgressEntry({
              outcome_id: outcomeId,
              worker_id: workerId,
              iteration,
              content: `Rate limited on: ${task.title} — task released back to pending`,
              full_output: taskResult.fullOutput,
              task_id: task.id,
            });
            workerState.running = false;
            exitReason = 'rate_limited';
            break;
          }

          // Turn exhaustion: attempt to decompose remaining work
          if (taskResult.turnExhausted) {
            appendLog(`[Turn Exhaustion] Max turns reached on "${task.title}". Attempting to decompose remaining work.`);

            // Extract progress summary from output
            const progressSummary = extractProgressSummary(taskResult.fullOutput);

            // Save checkpoint
            let checkpoint;
            try {
              checkpoint = saveCheckpoint({
                taskId: task.id,
                workerId: String(workerId),
                progressSummary: progressSummary || 'Turn limit reached — partial progress saved',
                remainingWork: 'Attempting auto-decomposition of remaining work',
              });
            } catch (checkpointErr) {
              appendLog(`[Checkpoint] Failed to save checkpoint: ${checkpointErr instanceof Error ? checkpointErr.message : 'unknown'}`);
            }

            // Attempt decomposition of remaining work
            if (checkpoint) {
              try {
                const decompResult = await decomposeRemainingWork({
                  task,
                  checkpoint,
                  fullOutput: taskResult.fullOutput,
                  outcomeIntent: intent,
                });

                if (decompResult.success) {
                  appendLog(`[Turn Exhaustion] Decomposed remaining work into ${decompResult.createdTaskIds.length} subtasks`);
                  createProgressEntry({
                    outcome_id: outcomeId,
                    worker_id: workerId,
                    iteration,
                    content: `Turn exhaustion on: ${task.title} — remaining work decomposed into ${decompResult.createdTaskIds.length} subtasks`,
                    full_output: taskResult.fullOutput,
                    task_id: task.id,
                  });
                  // Parent is already marked completed by decomposeRemainingWork
                  recordSuccess(outcomeId);
                  const newStats = getTaskStats(outcomeId);
                  progress.totalTasks = newStats.total;
                  progress.completedTasks = newStats.completed;
                  continue; // Subtasks picked up next iteration
                }

                appendLog(`[Turn Exhaustion] Decomposition failed: ${decompResult.error || decompResult.reasoning}`);
              } catch (decompErr) {
                appendLog(`[Turn Exhaustion] Decomposition error: ${decompErr instanceof Error ? decompErr.message : 'unknown'}`);
              }
            }

            // Fallback: release task with attempt tracking
            const exhaustionAttempts = getAttemptCount(task.id);
            const MAX_EXHAUSTION_RETRIES = 3;

            if (exhaustionAttempts >= MAX_EXHAUSTION_RETRIES) {
              appendLog(`[Turn Exhaustion] Task has exhausted ${MAX_EXHAUSTION_RETRIES} retries. Failing task.`);
              if (!failTask(task.id)) {
                appendLog(`[Turn Exhaustion] Failed to mark task failed: ${task.id}`);
              }
              logTaskFailed(outcomeId, outcome.name, task.title, `Turn exhaustion after ${MAX_EXHAUSTION_RETRIES} attempts`);
              recordFailure(outcomeId, task.id, 'Turn exhaustion: max retries exceeded');
              createProgressEntry({
                outcome_id: outcomeId,
                worker_id: workerId,
                iteration,
                content: `Turn limit exhausted on: ${task.title} — decomposition failed, task failed after ${MAX_EXHAUSTION_RETRIES} retries`,
                full_output: taskResult.fullOutput,
                task_id: task.id,
              });
            } else {
              appendLog(`[Turn Exhaustion] Releasing back to pending (attempt ${exhaustionAttempts + 1}/${MAX_EXHAUSTION_RETRIES}).`);
              if (!releaseTask(task.id)) {
                appendLog(`[Turn Exhaustion] Failed to release task ${task.id}`);
              }
              const exhaustionProgressEntry = createProgressEntry({
                outcome_id: outcomeId,
                worker_id: workerId,
                iteration,
                content: `Turn limit exhausted on: ${task.title} — decomposition failed, released to pending`,
                full_output: taskResult.fullOutput,
                task_id: task.id,
              });
              try {
                recordAttempt({
                  taskId: task.id,
                  attemptNumber: exhaustionAttempts + 1,
                  workerId: String(workerId),
                  failureReason: 'Turn limit exhausted, decomposition failed',
                  durationSeconds: Math.floor((Date.now() - taskStartTime) / 1000),
                  progressEntryId: exhaustionProgressEntry.id,
                });
              } catch (attemptErr) {
                appendLog(`[Attempt] Failed to record attempt: ${attemptErr instanceof Error ? attemptErr.message : 'unknown'}`);
              }
            }

            // Quick HOMЯ observation for turn exhaustion (task released for retry)
            if (homr.isEnabled(outcomeId) && taskResult.fullOutput && taskResult.fullOutput.length > 500) {
              try {
                homr.quickObserve(task, outcomeId, false);
                appendLog(`HOMЯ (turn exhaustion): quick observation recorded`);
              } catch (err) {
                appendLog(`HOMЯ observation skipped: ${err instanceof Error ? err.message : 'unknown'}`);
              }
            }
            continue;
          }

          if (taskResult.success) {
            // Run verification if task has a verify_command
            if (task.verify_command) {
              appendLog(`[Verification] Running verify command: ${task.verify_command}`);
              const verifyResult = await runVerification(task.id, task.verify_command, taskWorkspace);
              appendLog(`[Verification] ${verifyResult.passed ? 'PASSED' : 'FAILED'} (${verifyResult.durationMs}ms)`);

              if (!verifyResult.passed) {
                // Treat verification failure as task failure — record attempt and retry
                appendLog(`[Verification] Task will be retried: ${verifyResult.output.slice(0, 200)}`);
                if (!failTask(task.id)) {
                  appendLog(`[Verification] Failed to transition task to failed state: ${task.id}`);
                }
                logTaskFailed(outcomeId, outcome.name, task.title, `Verification failed: ${verifyResult.output.slice(0, 200)}`);
                getEventBus().emit({ type: 'task.failed', outcomeId, taskId: task.id, data: { reason: 'Verification failed' }, timestamp: new Date().toISOString() });

                recordFailure(outcomeId, task.id, `Verification failed: ${verifyResult.output.slice(0, 200)}`);
                const verifyProgressEntry = createProgressEntry({
                  outcome_id: outcomeId,
                  worker_id: workerId,
                  iteration,
                  content: `Verification failed: ${task.title} — ${verifyResult.output.slice(0, 200)}`,
                  full_output: taskResult.fullOutput,
                  task_id: task.id,
                });

                // Record attempt with verification failure details (linked to progress entry)
                try {
                  recordAttempt({
                    taskId: task.id,
                    attemptNumber: getAttemptCount(task.id) + 1,
                    workerId: String(workerId),
                    approachSummary: 'Task completed but verification failed',
                    failureReason: `Verification command failed: ${task.verify_command}`,
                    errorOutput: verifyResult.output,
                    durationSeconds: Math.floor((Date.now() - taskStartTime) / 1000),
                    progressEntryId: verifyProgressEntry.id,
                  });
                } catch (attemptErr) {
                  appendLog(`[Attempt] Failed to record attempt: ${attemptErr instanceof Error ? attemptErr.message : 'unknown'}`);
                }

                // HOMЯ observation for verification failure
                if (homr.isEnabled(outcomeId) && taskResult.fullOutput && taskResult.fullOutput.length > 500) {
                  try {
                    const obsResult = await homr.observeAndProcess({
                      task, fullOutput: taskResult.fullOutput, intent, outcomeId, workerId,
                    });
                    if (obsResult.observation) appendLog(`HOMЯ (verification failure): ${obsResult.observation.summary}`);
                    if (obsResult.workerPaused) {
                      workerState.running = false;
                      exitReason = 'homr_paused';
                      break;
                    }
                  } catch (err) {
                    appendLog(`HOMЯ observation skipped: ${err instanceof Error ? err.message : 'unknown'}`);
                  }
                }

                const circuitBreakerCheck = shouldTripCircuitBreaker(outcomeId, circuitBreakerThreshold);
                if (circuitBreakerCheck.shouldTrip) {
                  appendLog(`[Circuit Breaker] TRIPPED after verification failure: ${circuitBreakerCheck.reason}`);
                  markCircuitBreakerTripped(outcomeId);
                  workerState.running = false;
                  exitReason = 'circuit_breaker';
                  break;
                }
                continue;
              }
            }

            if (!completeTask(task.id)) {
              appendLog(`Failed to mark task completed in DB: ${task.id}`);
              if (!failTask(task.id)) {
                appendLog(`Failed to mark task failed after completion transition error: ${task.id}`);
              }
              recordFailure(outcomeId, task.id, 'Completion state transition failed');
              continue;
            }
            progress.completedTasks++;
            appendLog(`Task completed: ${task.title}`);
            logTaskCompleted(outcomeId, outcome.name, task.title, workerId);
            getEventBus().emit({ type: 'task.completed', outcomeId, workerId, taskId: task.id, timestamp: new Date().toISOString() });

            // Circuit breaker: Record success (resets consecutive failures)
            recordSuccess(outcomeId);

            // Record progress entry with full output for auditing (before attempt, to get ID)
            const successProgressEntry = createProgressEntry({
              outcome_id: outcomeId,
              worker_id: workerId,
              iteration,
              content: `Completed: ${task.title}`,
              full_output: taskResult.fullOutput,
              task_id: task.id,
            });

            // Record successful attempt (linked to progress entry)
            try {
              recordAttempt({
                taskId: task.id,
                attemptNumber: getAttemptCount(task.id) + 1,
                workerId: String(workerId),
                approachSummary: 'Task completed successfully',
                durationSeconds: Math.floor((Date.now() - taskStartTime) / 1000),
                progressEntryId: successProgressEntry.id,
              });
            } catch (attemptErr) {
              appendLog(`[Attempt] Failed to record attempt: ${attemptErr instanceof Error ? attemptErr.message : 'unknown'}`);
            }

            // HOMЯ observation - analyze the completed task
            if (homr.isEnabled(outcomeId) && taskResult.fullOutput) {
              try {
                appendLog(`Running HOMЯ observation...`);
                const observationResult = await homr.observeAndProcess({
                  task,
                  fullOutput: taskResult.fullOutput,
                  intent,
                  outcomeId,
                  workerId,
                });

                if (observationResult.observation) {
                  appendLog(`HOMЯ: ${observationResult.observation.summary}`);
                  if (observationResult.failurePatternDetected) {
                    appendLog(`HOMЯ: Failure pattern detected - consecutive failures`);
                    if (observationResult.workerPaused) {
                      appendLog(`HOMЯ: Worker paused for review - awaiting human input`);
                      workerState.running = false; // Stop the worker loop
                      exitReason = 'homr_paused';
                    }
                  }
                  if (observationResult.escalated) {
                    appendLog(`HOMЯ: Escalation created - human input needed`);
                  }
                  if (observationResult.steered) {
                    appendLog(`HOMЯ: Steering actions executed`);
                  }
                }
              } catch (homrError) {
                appendLog(`HOMЯ observation failed: ${homrError instanceof Error ? homrError.message : 'Unknown error'}`);
              }
            }

            // If HOMЯ paused us, break out
            if (!workerState.running) break;
          } else {
            if (!failTask(task.id)) {
              appendLog(`Failed to transition task to failed state: ${task.id}`);
            }
            appendLog(`Task failed: ${task.title} - ${taskResult.error}`);
            logTaskFailed(outcomeId, outcome.name, task.title, taskResult.error);
            getEventBus().emit({ type: 'task.failed', outcomeId, taskId: task.id, data: { reason: taskResult.error }, timestamp: new Date().toISOString() });

            // Circuit breaker: Record failure for pattern analysis
            recordFailure(outcomeId, task.id, taskResult.error || 'unknown error');

            // Record failure with full output for debugging (before attempt, to get ID)
            const failureProgressEntry = createProgressEntry({
              outcome_id: outcomeId,
              worker_id: workerId,
              iteration,
              content: `Failed: ${task.title} - ${taskResult.error}`,
              full_output: taskResult.fullOutput,
              task_id: task.id,
            });

            // Record failed attempt for teaching-errors context on next retry (linked to progress entry)
            try {
              const attemptNum = getAttemptCount(task.id) + 1;
              recordAttempt({
                taskId: task.id,
                attemptNumber: attemptNum,
                workerId: String(workerId),
                failureReason: taskResult.error,
                errorOutput: taskResult.fullOutput ? taskResult.fullOutput.slice(-8000) : undefined,
                durationSeconds: Math.floor((Date.now() - taskStartTime) / 1000),
                progressEntryId: failureProgressEntry.id,
              });
            } catch (attemptErr) {
              appendLog(`[Attempt] Failed to record attempt: ${attemptErr instanceof Error ? attemptErr.message : 'unknown'}`);
            }

            // HOMЯ observation for failed tasks
            if (homr.isEnabled(outcomeId) && taskResult.fullOutput && taskResult.fullOutput.length > 500) {
              try {
                const obsResult = await homr.observeAndProcess({
                  task, fullOutput: taskResult.fullOutput, intent, outcomeId, workerId,
                });
                if (obsResult.observation) appendLog(`HOMЯ (failure): ${obsResult.observation.summary}`);
                if (obsResult.workerPaused) {
                  workerState.running = false;
                  exitReason = 'homr_paused';
                  break;
                }
              } catch (err) {
                appendLog(`HOMЯ observation skipped: ${err instanceof Error ? err.message : 'unknown'}`);
              }
            }

            // Check if this is a critical error
            if (taskResult.error?.includes('critical') || taskResult.error?.includes('blocked')) {
              hasError = true;
              errorMessage = taskResult.error;
              exitReason = 'critical_error';
              break;
            }

            // Circuit breaker: Check if we should trip
            const circuitBreakerCheck = shouldTripCircuitBreaker(outcomeId, circuitBreakerThreshold);
            if (circuitBreakerCheck.shouldTrip) {
              appendLog(`[Circuit Breaker] TRIPPED: ${circuitBreakerCheck.reason}`);
              appendLog(`[Circuit Breaker] Pattern detected: ${circuitBreakerCheck.pattern}`);

              // Mark the circuit breaker as tripped
              markCircuitBreakerTripped(outcomeId);

              // Create an escalation for human review
              try {
                const circuitBreakerAmbiguity: homr.HomrAmbiguitySignal = {
                  detected: true,
                  type: 'blocking_decision',
                  description: `Circuit breaker tripped: ${circuitBreakerCheck.failureCount} consecutive task failures with pattern "${circuitBreakerCheck.pattern}"`,
                  evidence: [
                    `Threshold: ${circuitBreakerThreshold} consecutive failures`,
                    `Actual failures: ${circuitBreakerCheck.failureCount}`,
                    `Pattern: ${circuitBreakerCheck.pattern}`,
                    `Most recent failed task: ${task.title}`,
                    ...(taskResult.fullOutput ? [`Last output (tail):\n${taskResult.fullOutput.slice(-1500)}`] : []),
                  ],
                  affectedTasks: [task.id],
                  suggestedQuestion: 'Multiple tasks are failing with a similar pattern. How should we proceed?',
                  options: [
                    {
                      id: 'increase_turn_limit',
                      label: 'Increase Turn Limit',
                      description: 'Double the max turns for affected tasks and retry',
                      implications: 'Tasks will have more time to complete but may still fail',
                    },
                    {
                      id: 'break_into_subtasks',
                      label: 'Break Into Subtasks',
                      description: 'Decompose complex tasks into smaller, more manageable pieces',
                      implications: 'Creates new subtasks that replace the original failing tasks',
                    },
                    {
                      id: 'skip_failing_tasks',
                      label: 'Skip Failing Tasks',
                      description: 'Mark failing tasks as skipped and continue with remaining work',
                      implications: 'Some work will be incomplete but progress can continue',
                    },
                    {
                      id: 'pause_and_review',
                      label: 'Pause for Manual Review',
                      description: 'Stop all work and wait for human investigation',
                      implications: 'Workers will remain paused until manually resumed',
                    },
                  ],
                };

                await homr.createEscalation(outcomeId, circuitBreakerAmbiguity, task);
                appendLog(`[Circuit Breaker] Escalation created for human review`);
              } catch (escalationError) {
                appendLog(`[Circuit Breaker] Failed to create escalation: ${escalationError instanceof Error ? escalationError.message : 'Unknown error'}`);
              }

              // Pause the worker
              appendLog(`[Circuit Breaker] Pausing worker to await human decision`);
              workerState.running = false;
              exitReason = 'circuit_breaker';
              break;
            }
          }

          // Update stats
          const newStats = getTaskStats(outcomeId);
          progress.totalTasks = newStats.total;
          progress.completedTasks = newStats.completed;
          progress.lastUpdate = Date.now();

          // Check if all done
          if (newStats.pending === 0 && newStats.claimed === 0 && newStats.running === 0) {
            appendLog(`All tasks completed!`);
            exitReason = 'all_tasks_complete';
            break;
          }
        }

        // If the while condition failed (iteration >= maxIterations), tag exit reason
        if (iteration >= maxIterations && exitReason === 'unknown') {
          const stats = getTaskStats(outcomeId);
          exitReason = (stats.pending > 0 || stats.running > 0) ? 'max_iterations' : 'all_tasks_complete';
        }
      } catch (err) {
        hasError = true;
        errorMessage = err instanceof Error ? err.message : 'Unknown error';
        appendLog(`Worker error: ${errorMessage}`);
        exitReason = 'uncaught_exception';
      }

      // --- Self-heal restart decision ---
      const canRestart = selfHeal
        && RESTARTABLE_EXITS.has(exitReason)
        && restartCount < healCfg.maxRestarts
        && !isWorkerPaused(workerId);

      if (canRestart) {
        const stats = getTaskStats(outcomeId);
        if (stats.pending > 0 || stats.running > 0) {
          restartCount++;
          appendLog(`[Self-Heal] Restarting (${restartCount}/${healCfg.maxRestarts}), reason: ${exitReason}, backoff: ${backoffMs / 1000}s`);

          createProgressEntry({
            outcome_id: outcomeId,
            worker_id: workerId,
            iteration,
            content: `[Self-Heal] Auto-restart ${restartCount}/${healCfg.maxRestarts} after ${exitReason}. Backing off ${backoffMs / 1000}s.`,
          });

          logWorkerRestarted(outcomeId, outcome.name, workerName, restartCount, exitReason);

          await sleepMs(backoffMs);

          // Re-check pause after backoff (user may have stopped us during wait)
          if (isWorkerPaused(workerId)) {
            exitReason = 'user_paused';
            // Fall through to cleanup below
          } else {
            backoffMs = Math.min(backoffMs * healCfg.backoffMultiplier, healCfg.maxBackoffMs);
            // Reset per-cycle state for fresh iteration budget
            workerState.running = true;
            hasError = false;
            errorMessage = undefined;
            continue restart;
          }
        }
      }

      // --- Cleanup (runs once when we're truly done) ---
      clearInterval(heartbeatInterval);

      // Stop supervisor (saves final change snapshot)
      stopSupervisor(outcomeId, workerId);
      appendLog(`Supervisor stopped`);

      // Final status - check if paused by intervention or stopped manually
      const wasPaused = !workerState.running && !hasError;
      if (hasError) {
        failWorker(workerId);
        progress.status = 'failed';
        progress.error = errorMessage;
        logWorkerFailed(outcomeId, outcome.name, workerName, errorMessage);
        getEventBus().emit({ type: 'worker.stopped', outcomeId, workerId, data: { reason: errorMessage }, timestamp: new Date().toISOString() });
      } else if (wasPaused) {
        updateWorker(workerId, { status: 'paused' });
        progress.status = 'stopped';
      } else {
        completeWorker(workerId);
        progress.status = 'completed';
        logWorkerCompleted(outcomeId, outcome.name, workerName, progress.completedTasks);
        getEventBus().emit({ type: 'worker.completed', outcomeId, workerId, data: { tasksCompleted: progress.completedTasks }, timestamp: new Date().toISOString() });
      }

      if (restartCount > 0) {
        appendLog(`[Self-Heal] Finished after ${restartCount} restart(s). Final status: ${progress.status}`);
      }

      progress.lastUpdate = Date.now();
      activeWorkers.delete(workerId);

      appendLog(`Worker finished: ${progress.status}`);

      if (onProgress) {
        onProgress({ ...progress });
      }

      break; // Exit the restart: while loop
    }
  })();

  return { workerId, started: true };
}

// ============================================================================
// Guard Integration
// ============================================================================

/**
 * Extract potential shell commands from worker output.
 * Looks for common patterns like tool calls, bash commands, etc.
 */
function extractCommandsFromOutput(output: string): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();

  // Pattern 1: Lines that look like shell commands (start with common commands)
  // This catches logged bash commands from Claude Code output
  const shellCommandPrefixes = [
    'rm', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'su ', 'dd ',
    'git push', 'git reset', 'git clean', 'git checkout .',
    'curl', 'wget', 'nc ', 'mkfs', 'shred',
    'DROP ', 'TRUNCATE ', 'DELETE FROM',
  ];

  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines or very short lines
    if (trimmed.length < 3) continue;

    // Check if line starts with a shell command prefix
    for (const prefix of shellCommandPrefixes) {
      if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
        if (!seen.has(trimmed)) {
          seen.add(trimmed);
          commands.push(trimmed);
        }
        break;
      }
    }

    // Pattern 2: Look for Bash tool calls in JSON format
    // Claude Code outputs tool uses in a structured format
    const bashMatch = trimmed.match(/"command"\s*:\s*"([^"]+)"/);
    if (bashMatch && bashMatch[1]) {
      const cmd = bashMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      if (!seen.has(cmd)) {
        seen.add(cmd);
        commands.push(cmd);
      }
    }
  }

  return commands;
}

/**
 * Guard context for a worker task.
 */
interface TaskGuardContext {
  workerId: string;
  outcomeId: string;
  taskId: string;
  workspacePath: string;
}

/**
 * Check extracted commands against the guard and log any blocks.
 * Returns the number of blocked commands.
 */
function checkOutputForDangerousCommands(
  output: string,
  context: TaskGuardContext,
  appendLog: (msg: string) => void
): { blockedCount: number; blockedCommands: string[] } {
  const commands = extractCommandsFromOutput(output);
  const blockedCommands: string[] = [];

  if (commands.length === 0) {
    return { blockedCount: 0, blockedCommands: [] };
  }

  appendLog(`[Guard] Checking ${commands.length} extracted commands...`);

  for (const command of commands) {
    const result = guard.checkCommand(command, {
      workerId: context.workerId,
      outcomeId: context.outcomeId,
      taskId: context.taskId,
      workspacePath: context.workspacePath,
    });

    if (!result.allowed) {
      blockedCommands.push(command);
      appendLog(`[Guard] BLOCKED: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`);
      appendLog(`[Guard] Reason: ${result.reason}`);

      if (result.blockRecorded) {
        appendLog(`[Guard] Block recorded with ID: ${result.blockId}`);
      }
      if (result.alertCreated) {
        appendLog(`[Guard] Supervisor alert created`);
      }
    }
  }

  if (blockedCommands.length > 0) {
    appendLog(`[Guard] Total blocked: ${blockedCommands.length} of ${commands.length} commands`);
  }

  return { blockedCount: blockedCommands.length, blockedCommands };
}

// ============================================================================
// Task Execution
// ============================================================================

/**
 * Parse cost from Claude CLI JSON output.
 * The CLI outputs JSON with total_cost_usd field.
 */
function extractCostFromOutput(output: string, taskId?: string): number {
  try {
    // Claude CLI may output multiple JSON lines (streaming), find the result message
    const lines = output.split('\n').filter(l => l.trim());

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        // Strip [stdout] / [stderr] prefixes from captured output chunks
        const line = lines[i].replace(/^\[(stdout|stderr)\]\s*/, '');
        const parsed = JSON.parse(line);
        if (parsed.type === 'result' && typeof parsed.total_cost_usd === 'number') {
          return parsed.total_cost_usd;
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // Try parsing the entire output as JSON (single-line response)
    const stripped = output.replace(/^\[(stdout|stderr)\]\s*/gm, '');
    const parsed = JSON.parse(stripped);
    if (typeof parsed.total_cost_usd === 'number') {
      return parsed.total_cost_usd;
    }
  } catch {
    // Failed to parse - no cost available
  }

  console.warn(`[worker] Failed to extract cost data${taskId ? ` for task ${taskId}` : ''}`);
  return 0;
}

/**
 * Detect if Claude CLI exited due to max turns exhaustion.
 * Checks for JSON result with subtype 'error_max_turns' (primary),
 * and falls back to keyword matching when exit code is null (signal kill).
 */
function detectTurnExhaustion(fullOutput: string, exitCode: number | null): boolean {
  if (!fullOutput) return false;

  // Primary: JSON result with subtype 'error_max_turns' (from --output-format json)
  const lines = fullOutput.split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = lines[i].replace(/^\[(stdout|stderr)\]\s*/, '');
      const parsed = JSON.parse(line);
      if (parsed.type === 'result' && parsed.subtype === 'error_max_turns') {
        return true;
      }
    } catch { /* skip non-JSON lines */ }
  }

  // Secondary: code === null + turn-related keywords in output
  if (exitCode === null) {
    const lower = fullOutput.toLowerCase();
    if (lower.includes('max turns') || lower.includes('max_turns') || lower.includes('turn limit')) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a single task with Claude CLI
 * Returns success status and captured full output for auditing
 */
async function executeTask(
  taskWorkspace: string,
  args: string[],
  progressPath: string,
  workerId: string,
  task: Task,
  appendLog: (msg: string) => void,
  guardContext?: TaskGuardContext
): Promise<{ success: boolean; error?: string; fullOutput?: string; guardBlocks?: number; rateLimited?: boolean; turnExhausted?: boolean }> {
  return new Promise((resolve) => {
    try {
      // Strip CLAUDECODE env var to prevent nested session detection blocking the CLI
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      const claudeProcess = spawn('claude', args, {
        cwd: taskWorkspace,
        env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Store PID in database for proper pause/stop functionality
      const pid = claudeProcess.pid;
      if (pid) {
        updateWorker(workerId, { pid });
        appendLog(`Spawned Claude process with PID: ${pid}`);
      }

      const worker = activeWorkers.get(workerId);
      if (worker) {
        worker.process = claudeProcess;
      }

      let lastProgressContent = '';
      let checkInterval: NodeJS.Timeout;

      // Collect full output for auditing
      const outputChunks: string[] = [];
      const MAX_OUTPUT_SIZE = 500000; // 500KB max to prevent memory issues
      let totalOutputSize = 0;
      let totalGuardBlocks = 0;

      // Poll progress file
      const checkProgress = () => {
        if (existsSync(progressPath)) {
          const content = readFileSync(progressPath, 'utf-8');
          if (content !== lastProgressContent) {
            lastProgressContent = content;
            const parsed = parseTaskProgress(content);

            appendLog(`Progress: ${parsed.status}`);

            if (parsed.done) {
              appendLog(`Task signaled DONE`);
              claudeProcess.kill('SIGTERM');
            } else if (parsed.error) {
              appendLog(`Task signaled ERROR: ${parsed.error}`);
              claudeProcess.kill('SIGTERM');
            }
          }
        }
      };

      checkInterval = setInterval(checkProgress, 2000);

      // Handle stdout - capture full output and check for dangerous commands
      claudeProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        // Log truncated version
        appendLog(`stdout: ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`);
        // Capture full output (up to limit)
        if (totalOutputSize < MAX_OUTPUT_SIZE) {
          outputChunks.push(`[stdout] ${output}`);
          totalOutputSize += output.length;
        }

        // Real-time guard check on output (if context provided)
        if (guardContext) {
          const guardResult = checkOutputForDangerousCommands(output, guardContext, appendLog);
          totalGuardBlocks += guardResult.blockedCount;
        }
      });

      // Handle stderr - capture full output and check for dangerous commands
      claudeProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        // Log truncated version
        appendLog(`stderr: ${output.substring(0, 500)}${output.length > 500 ? '...' : ''}`);
        // Capture full output (up to limit)
        if (totalOutputSize < MAX_OUTPUT_SIZE) {
          outputChunks.push(`[stderr] ${output}`);
          totalOutputSize += output.length;
        }

        // Real-time guard check on output (if context provided)
        if (guardContext) {
          const guardResult = checkOutputForDangerousCommands(output, guardContext, appendLog);
          totalGuardBlocks += guardResult.blockedCount;
        }
      });

      // Handle completion
      claudeProcess.on('close', (code) => {
        clearInterval(checkInterval);

        // Clear PID from database since process has exited
        updateWorker(workerId, { pid: null });

        // Final progress check
        checkProgress();

        // Combine all captured output
        const fullOutput = outputChunks.join('\n');

        // Extract and log cost from Claude CLI output
        const cost = extractCostFromOutput(fullOutput, task.id);
        if (cost > 0) {
          try {
            const dbWorker = getWorkerById(workerId);
            logCost({
              outcome_id: dbWorker?.outcome_id,
              worker_id: workerId,
              amount: cost,
              description: `Task: ${task.title} (${task.id})`,
            });
            appendLog(`[Cost] Task cost: $${cost.toFixed(4)}`);
          } catch (costError) {
            appendLog(`[Cost] Failed to log cost: ${costError instanceof Error ? costError.message : 'unknown'}`);
          }
        }

        // Final guard check on complete output (catches anything missed in streaming)
        if (guardContext && fullOutput) {
          const finalGuardResult = checkOutputForDangerousCommands(fullOutput, guardContext, appendLog);
          // Note: We don't add to totalGuardBlocks here as we already checked in real-time
          // This is just a safety check for edge cases
          if (finalGuardResult.blockedCount > 0) {
            appendLog(`[Guard] Final scan found ${finalGuardResult.blockedCount} additional blocked commands`);
          }
        }

        // Log guard summary
        if (totalGuardBlocks > 0) {
          appendLog(`[Guard] Task completed with ${totalGuardBlocks} blocked dangerous commands`);
        }

        // Detect rate limiting from Claude CLI output
        const isRateLimited = /you've hit your limit|rate.?limit|resets \d+am/i.test(fullOutput);
        if (isRateLimited) {
          resolve({ success: false, error: 'Rate limited', fullOutput, guardBlocks: totalGuardBlocks, rateLimited: true });
          return;
        }

        // Detect turn exhaustion (max turns reached)
        const isTurnExhausted = detectTurnExhaustion(fullOutput, code);
        if (isTurnExhausted) {
          // Check if progress.txt says DONE — work may actually be complete
          if (existsSync(progressPath)) {
            const content = readFileSync(progressPath, 'utf-8');
            const parsed = parseTaskProgress(content);
            if (parsed.done) {
              resolve({ success: true, fullOutput, guardBlocks: totalGuardBlocks });
              return;
            }
          }
          resolve({ success: false, error: 'Turn limit exhausted', fullOutput, guardBlocks: totalGuardBlocks, turnExhausted: true });
          return;
        }

        if (existsSync(progressPath)) {
          const content = readFileSync(progressPath, 'utf-8');
          const parsed = parseTaskProgress(content);

          if (parsed.done) {
            resolve({ success: true, fullOutput, guardBlocks: totalGuardBlocks });
          } else if (parsed.error) {
            resolve({ success: false, error: parsed.error, fullOutput, guardBlocks: totalGuardBlocks });
          } else if (code === 0) {
            resolve({ success: true, fullOutput, guardBlocks: totalGuardBlocks });
          } else {
            resolve({ success: false, error: `Process exited with code ${code}`, fullOutput, guardBlocks: totalGuardBlocks });
          }
        } else {
          resolve({
            success: code === 0,
            error: code !== 0 ? `Exit code ${code}` : undefined,
            fullOutput,
            guardBlocks: totalGuardBlocks
          });
        }
      });

      claudeProcess.on('error', (err) => {
        clearInterval(checkInterval);
        const fullOutput = outputChunks.join('\n');
        resolve({ success: false, error: err.message, fullOutput, guardBlocks: totalGuardBlocks });
      });

      // Timeout after 10 minutes per task
      setTimeout(() => {
        if (!claudeProcess.killed) {
          appendLog(`Task timeout - killing process`);
          claudeProcess.kill('SIGTERM');
        }
      }, 10 * 60 * 1000);

    } catch (err) {
      resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to spawn process',
        guardBlocks: 0,
      });
    }
  });
}

// ============================================================================
// Worker Control
// ============================================================================

/**
 * Stop a running Ralph worker
 * Kills the process by PID (from database) and updates status
 */
export function stopRalphWorker(workerId: string): boolean {
  // First, get the worker from database to find its PID
  const dbWorker = getWorkerById(workerId);

  // If worker is in activeWorkers (in-memory), clean it up
  const worker = activeWorkers.get(workerId);
  if (worker) {
    worker.running = false;

    if (worker.process) {
      worker.process.kill('SIGTERM');
    }

    if (worker.heartbeatInterval) {
      clearInterval(worker.heartbeatInterval);
    }

    activeWorkers.delete(workerId);
  }

  // Kill the process by PID from database (handles orphaned processes)
  if (dbWorker?.pid) {
    try {
      process.kill(dbWorker.pid, 'SIGTERM');
      console.log(`[Worker] Killed process with PID: ${dbWorker.pid}`);
    } catch (err) {
      // Process might already be dead, that's OK
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ESRCH') {
        console.error(`[Worker] Error killing PID ${dbWorker.pid}:`, err);
      }
    }
  }

  // Stop supervisor for this worker (if running)
  if (dbWorker?.outcome_id) {
    stopSupervisor(dbWorker.outcome_id, workerId);
    console.log(`[Worker] Stopped supervisor for worker ${workerId}`);
  }

  // Update the database status and clear the PID
  const result = updateWorker(workerId, { status: 'paused', pid: null });

  // Resolve any active alerts for this worker since it's been explicitly stopped
  resolveAlertsForWorker(workerId);

  return result !== null;
}

/**
 * Get status of a Ralph worker
 */
export function getRalphWorkerStatus(workerId: string): RalphProgress | null {
  const worker = activeWorkers.get(workerId);
  return worker?.progress || null;
}

/**
 * Check if a worker has been paused (from database)
 * This is used by worker loops to check if they should stop
 */
export function isWorkerPaused(workerId: string): boolean {
  const dbWorker = getWorkerById(workerId);
  return dbWorker?.status === 'paused';
}

/**
 * List all active workers
 */
export function listActiveWorkers(): RalphProgress[] {
  return Array.from(activeWorkers.values()).map(w => ({ ...w.progress }));
}

/**
 * Check if there are pending tasks for an outcome
 */
export function hasPendingTasks(outcomeId: string): boolean {
  const pending = getPendingTasks(outcomeId);
  return pending.length > 0;
}

/**
 * Stop all workers for an outcome by killing their processes
 */
export function stopAllWorkersForOutcome(outcomeId: string): number {
  const { getWorkersByOutcome } = require('../db/workers');
  const workers = getWorkersByOutcome(outcomeId);
  let stopped = 0;

  for (const worker of workers) {
    if (worker.status === 'running') {
      if (stopRalphWorker(worker.id)) {
        stopped++;
      }
    }
  }

  console.log(`[Worker] Stopped ${stopped} workers for outcome ${outcomeId}`);
  return stopped;
}

// ============================================================================
// Worker Loop (for Orchestrator)
// ============================================================================

export interface WorkerLoopOptions {
  singleTask?: boolean;           // Only process one task then exit
  phase?: TaskPhase;              // Filter tasks by phase
  skillContext?: string;          // Additional skill context to inject
  maxIterations?: number;         // Override max iterations
  enableComplexityCheck?: boolean; // Enable pre-claim complexity check (default: true)
  autoDecompose?: boolean;         // Auto-decompose high-complexity tasks (default: false)
  maxTurns?: number;               // Worker's max turns per task (default: 100)
}

/**
 * Run a worker loop for the orchestrator.
 * This is a simplified version that processes tasks and can be controlled
 * by the orchestrator for phase-aware execution.
 */
export async function runWorkerLoop(
  outcomeId: string,
  workerId: string,
  options: WorkerLoopOptions = {}
): Promise<void> {
  const {
    singleTask = false,
    phase,
    skillContext,
    maxIterations = 50,
    enableComplexityCheck = true,
    autoDecompose = false,
    maxTurns = getDefaultTurnBudget(),
  } = options;

  // Build complexity check config (logging-only mode)
  const complexityCheckConfig: ComplexityCheckConfig = {
    maxTurns,
    autoDecompose: false,
    escalateOnHighComplexity: false,
    complexityThreshold: 6,
    turnsWarningRatio: 0.8,
    tiers: DEFAULT_COMPLEXITY_TIERS,
  };

  // Get outcome
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    throw new Error('Outcome not found');
  }

  // Get worker name for activity logging
  const worker = getWorkerById(workerId);
  const workerName = worker?.name || `Worker ${workerId}`;

  // Parse intent
  let intent: Intent | null = null;
  if (outcome.intent) {
    try {
      intent = JSON.parse(outcome.intent) as Intent;
    } catch {
      // Intent might not be valid JSON
    }
  }

  // Build git configuration from outcome settings
  const gitConfig: GitConfig = {
    mode: outcome.git_mode || 'none',
    workBranch: outcome.work_branch || undefined,
    baseBranch: outcome.base_branch || 'main',
    autoCommit: Boolean(outcome.auto_commit),
  };

  // Set up workspace
  const workspacePath = paths.workspaces;
  const outcomeWorkspace = join(workspacePath, outcomeId);

  if (!existsSync(outcomeWorkspace)) {
    mkdirSync(outcomeWorkspace, { recursive: true });
  }

  // If git_mode is 'branch', check out the work branch
  if (gitConfig.mode === 'branch' && gitConfig.workBranch && isGitRepo()) {
    checkoutWorkBranch(gitConfig.workBranch, gitConfig.baseBranch);
  }

  // Log file
  const logPath = join(outcomeWorkspace, `worker-${workerId}.log`);
  const appendLog = (message: string) => {
    const timestamp = new Date().toISOString();
    writeFileSync(logPath, `[${timestamp}] ${message}\n`, { flag: 'a' });
  };

  appendLog(`Worker loop started - phase: ${phase || 'any'}, singleTask: ${singleTask}`);

  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Check if worker has been paused before claiming next task
    if (isWorkerPaused(workerId)) {
      appendLog(`Worker paused - stopping loop`);
      break;
    }

    // Try to claim a task (with optional phase filter)
    const claimResult = claimNextTask(outcomeId, workerId, phase);

    if (!claimResult.success || !claimResult.task) {
      // Auto-retry failed dependency blockers before giving up
      const { getMaxAutoRetries } = require('../db/system-config');
      const maxAutoRetries = getMaxAutoRetries();
      const failedBlockers = getFailedBlockerTasks(outcomeId);
      const eligibleBlockers = failedBlockers.filter(t => {
        const totalBudget = t.max_attempts * (1 + maxAutoRetries);
        return getAttemptCount(t.id) < totalBudget;
      });

      if (eligibleBlockers.length > 0) {
        for (const blocker of eligibleBlockers) {
          resetTaskForRetry(blocker.id);
          appendLog(`[Auto-Retry] Reset "${blocker.title}" (${blocker.id}) to pending`);
        }
        continue;
      }

      const pendingInPhase = getPendingTasks(outcomeId).filter(t => !phase || t.phase === phase);
      if (pendingInPhase.length > 0) {
        appendLog(`No claimable tasks for phase ${phase || 'any'} yet (${pendingInPhase.length} pending). Reason: ${claimResult.reason || 'unknown'}. Retrying...`);
        await sleepMs(1500);
        continue;
      }

      appendLog(`No more tasks available for phase: ${phase || 'any'}`);
      break;
    }

    const task = claimResult.task;
    appendLog(`Claimed task: ${task.title} (${task.id})`);
    logTaskClaimed(outcomeId, outcome.name, task.title, workerName);
    getEventBus().emit({ type: 'task.claimed', outcomeId, workerId, taskId: task.id, timestamp: new Date().toISOString() });

    // Safety intent check — blocks execution if prompt injection or malicious content detected
    try {
      appendLog(`[Safety] Running pre-execution safety check...`);
      const safetyResult = await runSafetyCheck(task, outcomeId, intent);

      if (!safetyResult.safe) {
        appendLog(`[Safety] BLOCKED: ${safetyResult.summary} (severity: ${safetyResult.severity})`);

        if (!releaseTask(task.id)) {
          appendLog(`[Safety] Failed to release blocked task ${task.id}`);
        }

        const safetySignal = buildSafetyEscalationSignal(task, safetyResult);
        try {
          await homr.createEscalation(outcomeId, safetySignal, task);
        } catch (escError) {
          appendLog(`[Safety] Failed to create escalation: ${escError instanceof Error ? escError.message : 'unknown'}`);
        }

        break; // Stop the worker loop — safety issue requires human review
      }

      appendLog(`[Safety] Passed (${safetyResult.summary})`);
    } catch (safetyError) {
      appendLog(`[Safety] Check failed (non-blocking): ${safetyError instanceof Error ? safetyError.message : 'unknown'}`);
    }

    // Complexity check (logging only — no gating)
    if (enableComplexityCheck) {
      const complexityResult = await runPreClaimComplexityCheck(
        task,
        outcomeId,
        intent,
        complexityCheckConfig,
        appendLog
      );

      // Only case where we don't proceed: task is mid-decomposition
      if (!complexityResult.shouldProceed) {
        appendLog(`[Complexity] Skipping decomposed task: ${complexityResult.reason}`);
        if (!releaseTask(task.id)) {
          appendLog(`[Complexity] Failed to release decomposed task ${task.id}`);
        }
        continue;
      }

      // Store estimate on task for future data collection
      if (complexityResult.estimate) {
        updateTaskDb(task.id, {
          complexity_score: complexityResult.estimate.complexity_score,
          estimated_turns: complexityResult.estimate.estimated_turns,
        });
      }
    }

    // Mark task as running
    const startedTask = startTask(task.id);
    if (!startedTask) {
      appendLog(`Failed to transition task to running: ${task.id}`);
      if (!releaseTask(task.id)) {
        appendLog(`Failed to release unstarted task: ${task.id}`);
      }
      continue;
    }

    // Create task workspace
    const taskWorkspace = join(outcomeWorkspace, task.id);
    if (!existsSync(taskWorkspace)) {
      mkdirSync(taskWorkspace, { recursive: true });
    }

    // Write CLAUDE.md with skill context and HOMЯ context
    const claudeMdPath = join(taskWorkspace, 'CLAUDE.md');
    writeFileSync(
      claudeMdPath,
      generateTaskInstructions(
        outcome.name,
        intent,
        task,
        skillContext,
        outcomeId,
        gitConfig,
        outcome.isolation_mode || 'workspace',
        outcomeWorkspace
      )
    );

    const progressPath = join(taskWorkspace, 'progress.txt');
    writeFileSync(progressPath, generateInitialProgress(task));

    // Spawn Claude for this task
    const ralphPrompt = `You are working on a specific task. Read CLAUDE.md for full instructions.
Complete the task, updating progress.txt as you go. When done, write DONE to progress.txt.`;

    // Use task's max_attempts if it's been increased (e.g., via HOMЯ escalation), otherwise use config default
    const taskMaxTurns = Math.max(task.max_attempts || maxTurns, maxTurns);

    const args = [
      '-p', ralphPrompt,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--max-turns', String(taskMaxTurns),
    ];

    appendLog(`Spawning Claude for task (max turns: ${taskMaxTurns})`);

    // Build guard context for command validation
    const taskGuardContext: TaskGuardContext = {
      workerId,
      outcomeId,
      taskId: task.id,
      workspacePath: outcomeWorkspace,
    };

    const taskResult = await executeTask(
      taskWorkspace,
      args,
      progressPath,
      workerId,
      task,
      appendLog,
      taskGuardContext
    );

    // Log guard activity if any commands were blocked
    if (taskResult.guardBlocks && taskResult.guardBlocks > 0) {
      appendLog(`[Guard] ${taskResult.guardBlocks} dangerous commands were blocked during task execution`);
    }

    // Turn exhaustion: attempt to decompose remaining work
    if (taskResult.turnExhausted) {
      appendLog(`[Turn Exhaustion] Max turns reached on "${task.title}". Attempting to decompose remaining work.`);

      const progressSummary = extractProgressSummary(taskResult.fullOutput);

      let checkpoint;
      try {
        checkpoint = saveCheckpoint({
          taskId: task.id,
          workerId: String(workerId),
          progressSummary: progressSummary || 'Turn limit reached — partial progress saved',
          remainingWork: 'Attempting auto-decomposition of remaining work',
        });
      } catch (checkpointErr) {
        appendLog(`[Checkpoint] Failed to save checkpoint: ${checkpointErr instanceof Error ? checkpointErr.message : 'unknown'}`);
      }

      if (checkpoint) {
        try {
          const decompResult = await decomposeRemainingWork({
            task,
            checkpoint,
            fullOutput: taskResult.fullOutput,
            outcomeIntent: intent,
          });

          if (decompResult.success) {
            appendLog(`[Turn Exhaustion] Decomposed remaining work into ${decompResult.createdTaskIds.length} subtasks`);
            createProgressEntry({
              outcome_id: outcomeId,
              worker_id: workerId,
              iteration,
              content: `Turn exhaustion on: ${task.title} — remaining work decomposed into ${decompResult.createdTaskIds.length} subtasks`,
              full_output: taskResult.fullOutput,
              task_id: task.id,
            });
            continue; // Subtasks picked up next iteration
          }
          appendLog(`[Turn Exhaustion] Decomposition failed: ${decompResult.error || decompResult.reasoning}`);
        } catch (decompErr) {
          appendLog(`[Turn Exhaustion] Decomposition error: ${decompErr instanceof Error ? decompErr.message : 'unknown'}`);
        }
      }

      // Fallback: release with attempt tracking
      const exhaustionAttempts = getAttemptCount(task.id);
      const MAX_EXHAUSTION_RETRIES = 3;

      if (exhaustionAttempts >= MAX_EXHAUSTION_RETRIES) {
        appendLog(`[Turn Exhaustion] Task has exhausted ${MAX_EXHAUSTION_RETRIES} retries. Failing task.`);
        if (!failTask(task.id)) {
          appendLog(`[Turn Exhaustion] Failed to transition task to failed state: ${task.id}`);
        }
        logTaskFailed(outcomeId, outcome.name, task.title, `Turn exhaustion after ${MAX_EXHAUSTION_RETRIES} attempts`);
      } else {
        appendLog(`[Turn Exhaustion] Releasing back to pending (attempt ${exhaustionAttempts + 1}/${MAX_EXHAUSTION_RETRIES}).`);
        if (!releaseTask(task.id)) {
          appendLog(`[Turn Exhaustion] Failed to release task ${task.id}`);
        }
        try {
          recordAttempt({
            taskId: task.id,
            attemptNumber: exhaustionAttempts + 1,
            workerId: String(workerId),
            failureReason: 'Turn limit exhausted, decomposition failed',
            durationSeconds: 0, // Duration not tracked in worker loop
          });
        } catch (attemptErr) {
          appendLog(`[Attempt] Failed to record attempt: ${attemptErr instanceof Error ? attemptErr.message : 'unknown'}`);
        }
      }

      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Turn limit exhausted on: ${task.title} — decomposition failed, ${exhaustionAttempts >= MAX_EXHAUSTION_RETRIES ? 'task failed' : 'released to pending'}`,
        full_output: taskResult.fullOutput,
        task_id: task.id,
      });
      continue;
    }

    if (taskResult.success) {
      if (!completeTask(task.id)) {
        appendLog(`Failed to mark task completed in DB: ${task.id}`);
        if (!failTask(task.id)) {
          appendLog(`Failed to mark task failed after completion transition error: ${task.id}`);
        }
        continue;
      }
      appendLog(`Task completed: ${task.title}`);
      logTaskCompleted(outcomeId, outcome.name, task.title, workerId);
      getEventBus().emit({ type: 'task.completed', outcomeId, workerId, taskId: task.id, timestamp: new Date().toISOString() });

      // Record progress with full output for auditing
      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Completed: ${task.title}`,
        full_output: taskResult.fullOutput,
        task_id: task.id,
      });

      // HOMЯ observation - analyze the completed task
      if (homr.isEnabled(outcomeId) && taskResult.fullOutput) {
        try {
          appendLog(`Running HOMЯ observation...`);
          const observationResult = await homr.observeAndProcess({
            task,
            fullOutput: taskResult.fullOutput,
            intent,
            outcomeId,
            workerId,
          });

          if (observationResult.observation) {
            appendLog(`HOMЯ: ${observationResult.observation.summary}`);
          }
          if (observationResult.failurePatternDetected) {
            appendLog(`HOMЯ: Failure pattern detected - workers paused for review`);
            // The pause will be picked up by isWorkerPaused() check in next iteration
          }
          if (observationResult.escalated) {
            appendLog(`HOMЯ: Escalation created - human input needed`);
          }
          if (observationResult.steered) {
            appendLog(`HOMЯ: Steering actions executed`);
          }
        } catch (homrError) {
          appendLog(`HOMЯ observation failed: ${homrError instanceof Error ? homrError.message : 'Unknown error'}`);
        }
      }
    } else {
      if (!failTask(task.id)) {
        appendLog(`Failed to transition task to failed state: ${task.id}`);
      }
      appendLog(`Task failed: ${task.title} - ${taskResult.error}`);
      logTaskFailed(outcomeId, outcome.name, task.title, taskResult.error);
      getEventBus().emit({ type: 'task.failed', outcomeId, taskId: task.id, data: { reason: taskResult.error }, timestamp: new Date().toISOString() });

      // Record failure with full output for debugging
      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Failed: ${task.title} - ${taskResult.error}`,
        full_output: taskResult.fullOutput,
        task_id: task.id,
      });
    }

    // If single task mode, exit after processing one task
    if (singleTask) {
      appendLog(`Single task mode - exiting after one task`);
      break;
    }
  }

  appendLog(`Worker loop finished after ${iteration} iterations`);
}
