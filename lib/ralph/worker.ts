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

import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
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
} from '../db/tasks';
import type { Task, Intent, TaskPhase } from '../db/schema';
import { getOutcomeById } from '../db/outcomes';
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
import * as homr from '../homr';
import * as guard from '../guard';
import { estimateTaskComplexity, assessTurnLimitRisk, ComplexityEstimate } from '../agents/task-complexity-estimator';
import { autoDecomposeIfNeeded, DecompositionResult } from '../agents/task-decomposer';
import { logCost } from '../db/logs';
import {
  logTaskCompleted,
  logTaskClaimed,
  logTaskFailed,
  logWorkerStarted,
  logWorkerCompleted,
  logWorkerFailed,
} from '../db/activity';

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
  maxTurns?: number; // Default 20 - worker's max turns per task
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
  if (errorLower.includes('turn') || errorLower.includes('iteration') || errorLower.includes('max_turns')) {
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
 * Configuration for pre-claim complexity check
 */
export interface ComplexityCheckConfig {
  maxTurns: number;                 // Worker's max turns limit (default: 20)
  autoDecompose: boolean;           // Auto-decompose high-complexity tasks (default: false)
  escalateOnHighComplexity: boolean; // Create escalation for human decision (default: true)
  complexityThreshold: number;      // Complexity score threshold (default: 6)
  turnsWarningRatio: number;        // Warn if estimated > maxTurns * ratio (default: 0.8)
}

const DEFAULT_COMPLEXITY_CHECK_CONFIG: ComplexityCheckConfig = {
  maxTurns: 20,
  autoDecompose: false,
  escalateOnHighComplexity: true,
  complexityThreshold: 6,
  turnsWarningRatio: 0.8,
};

/**
 * Result of pre-claim complexity check
 */
export interface ComplexityCheckResult {
  shouldProceed: boolean;
  estimate: ComplexityEstimate | null;
  action: 'proceed' | 'decomposed' | 'escalated' | 'skipped';
  decompositionResult?: DecompositionResult;
  escalationId?: string;
  reason: string;
}

/**
 * Run pre-claim complexity check on a task before claiming it.
 * Returns whether the task should proceed or be handled differently.
 */
async function runPreClaimComplexityCheck(
  task: Task,
  outcomeId: string,
  intent: Intent | null,
  config: ComplexityCheckConfig,
  appendLog: (msg: string) => void
): Promise<ComplexityCheckResult> {
  // Skip re-estimation if task already has complexity score below threshold
  if (task.complexity_score !== null && task.complexity_score !== undefined) {
    const existingScore = task.complexity_score;
    const existingTurns = task.estimated_turns ?? config.maxTurns;

    appendLog(`[Complexity] Using existing estimate: score=${existingScore}, turns=${existingTurns}`);

    if (existingScore < config.complexityThreshold && existingTurns <= config.maxTurns) {
      return {
        shouldProceed: true,
        estimate: {
          complexity_score: existingScore,
          estimated_turns: existingTurns,
          confidence: 'high' as const,
          reasoning: 'Using pre-existing complexity estimate',
          risk_factors: [],
          recommendations: [],
        },
        action: 'proceed',
        reason: `Task has existing complexity score (${existingScore}) below threshold (${config.complexityThreshold})`,
      };
    }
    // If existing score is high, still re-estimate to be safe (user may have changed task)
    appendLog(`[Complexity] Existing score ${existingScore} >= threshold ${config.complexityThreshold}, re-estimating...`);
  }

  appendLog(`[Complexity] Estimating complexity for task: ${task.title}`);

  try {
    // Estimate task complexity
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

    appendLog(`[Complexity] Score: ${estimate.complexity_score}/10, Estimated turns: ${estimate.estimated_turns}`);

    // Assess turn limit risk
    const riskAssessment = assessTurnLimitRisk(estimate, config.maxTurns);
    appendLog(`[Complexity] Risk level: ${riskAssessment.riskLevel}`);

    // If task is within limits, proceed normally
    if (!riskAssessment.atRisk && estimate.complexity_score < config.complexityThreshold) {
      return {
        shouldProceed: true,
        estimate,
        action: 'proceed',
        reason: `Task complexity (${estimate.complexity_score}) and estimated turns (${estimate.estimated_turns}) are within acceptable limits`,
      };
    }

    // Task exceeds limits - take action
    appendLog(`[Complexity] Task may exceed turn limit. Risk: ${riskAssessment.message}`);

    // Option 1: Auto-decompose if enabled
    if (config.autoDecompose) {
      appendLog(`[Complexity] Auto-decomposing high-complexity task...`);

      const decompositionResult = await autoDecomposeIfNeeded(
        task,
        intent,
        null, // approach
        {
          minComplexityToDecompose: config.complexityThreshold,
          maxTurnsPerSubtask: Math.floor(config.maxTurns / 2), // Each subtask should be half the max
          maxSubtasks: 6,
          workerMaxTurns: config.maxTurns,
        }
      );

      if (decompositionResult && decompositionResult.success) {
        appendLog(`[Complexity] Task decomposed into ${decompositionResult.createdTaskIds.length} subtasks`);
        return {
          shouldProceed: false,
          estimate,
          action: 'decomposed',
          decompositionResult,
          reason: `Task was too complex (${estimate.complexity_score}/10, ${estimate.estimated_turns} estimated turns). Decomposed into ${decompositionResult.createdTaskIds.length} subtasks.`,
        };
      } else {
        appendLog(`[Complexity] Auto-decomposition failed: ${decompositionResult?.error || decompositionResult?.reasoning || 'unknown'}`);
        // Fall through to escalation
      }
    }

    // Option 2: Create escalation for human decision
    if (config.escalateOnHighComplexity) {
      appendLog(`[Complexity] Creating escalation for human decision...`);

      const ambiguity: homr.HomrAmbiguitySignal = {
        detected: true,
        type: 'blocking_decision',
        description: `Task "${task.title}" has high complexity (${estimate.complexity_score}/10) and is estimated to require ${estimate.estimated_turns} turns, which exceeds the worker's ${config.maxTurns} turn limit.`,
        evidence: [
          `Complexity score: ${estimate.complexity_score}/10`,
          `Estimated turns: ${estimate.estimated_turns}`,
          `Worker max turns: ${config.maxTurns}`,
          `Risk level: ${riskAssessment.riskLevel}`,
          ...estimate.risk_factors.map(f => `Risk factor: ${f}`),
        ],
        affectedTasks: [task.id],
        suggestedQuestion: 'This task is too complex for the current turn limit. How should we proceed?',
        options: [
          {
            id: 'break_into_subtasks',
            label: 'Break Into Subtasks',
            description: 'Decompose this task into smaller, more manageable pieces',
            implications: 'Creates new subtasks that replace this task. Original task will be marked as decomposed.',
          },
          {
            id: 'increase_turn_limit',
            label: 'Increase Turn Limit',
            description: 'Double the turn limit and attempt this task as-is',
            implications: `Worker will have ${config.maxTurns * 2} turns instead of ${config.maxTurns}. Task may still fail if complexity is underestimated.`,
          },
          {
            id: 'proceed_anyway',
            label: 'Proceed Anyway',
            description: 'Attempt the task with current limits, accepting the risk of failure',
            implications: 'Task may hit turn limit and fail, requiring retry or manual intervention.',
          },
          {
            id: 'skip_task',
            label: 'Skip This Task',
            description: 'Mark this task as skipped and continue with other work',
            implications: 'Task will not be attempted. You may need to complete it manually.',
          },
        ],
      };

      try {
        const escalationId = await homr.createEscalation(outcomeId, ambiguity, task);
        appendLog(`[Complexity] Escalation created: ${escalationId}`);

        return {
          shouldProceed: false,
          estimate,
          action: 'escalated',
          escalationId,
          reason: `Task complexity too high. Created escalation ${escalationId} for human decision.`,
        };
      } catch (escalationError) {
        appendLog(`[Complexity] Failed to create escalation: ${escalationError instanceof Error ? escalationError.message : 'unknown'}`);
        // Fall through to skip
      }
    }

    // If all else fails, skip the task
    appendLog(`[Complexity] Skipping high-complexity task`);
    return {
      shouldProceed: false,
      estimate,
      action: 'skipped',
      reason: `Task complexity too high (${estimate.complexity_score}/10, ${estimate.estimated_turns} estimated turns) and no action could be taken.`,
    };

  } catch (error) {
    appendLog(`[Complexity] Estimation failed: ${error instanceof Error ? error.message : 'unknown'}`);

    // On error, proceed with caution (let the task run)
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
      execSync(`git checkout ${workBranch}`, { encoding: 'utf-8', stdio: 'pipe' });
      console.log(`[Worker] Checked out existing branch: ${workBranch}`);
    } else {
      // Create new branch from base
      const base = baseBranch || 'main';
      execSync(`git checkout -b ${workBranch} ${base}`, { encoding: 'utf-8', stdio: 'pipe' });
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
    execSync(`git checkout ${branchName}`, { encoding: 'utf-8', stdio: 'pipe' });
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
  gitConfig?: GitConfig
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

  return `# Current Task

## Outcome: ${outcomeName}
${intentSummary}

---
${gitInstructions}${homrContext ? `\n${homrContext}` : ''}
## Your Current Task

**ID:** ${task.id}
**Title:** ${task.title}

${task.description || 'No additional description provided.'}

${task.prd_context ? `### PRD Context\n${task.prd_context}\n` : ''}
${task.design_context ? `### Design Context\n${task.design_context}\n` : ''}

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
    workspacePath = join(process.cwd(), 'workspaces'),
    maxIterations = 50,
    heartbeatIntervalMs = 30000,
    useWorktree = false,
    circuitBreakerThreshold = 3,
    enableComplexityCheck = true,
    autoDecompose = false,
    maxTurns = 20,
  } = config;

  // Build complexity check config
  const complexityCheckConfig: ComplexityCheckConfig = {
    maxTurns,
    autoDecompose,
    escalateOnHighComplexity: true,
    complexityThreshold: 6,
    turnsWarningRatio: 0.8,
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

  // Start the work loop
  (async () => {
    let iteration = 0;
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
          // No more tasks available
          appendLog(`No more pending tasks. Work complete.`);
          break;
        }

        const task = claimResult.task;
        appendLog(`Claimed task: ${task.title} (${task.id})`);
        logTaskClaimed(outcomeId, outcome.name, task.title, workerName);

        // Pre-claim complexity check
        if (enableComplexityCheck) {
          const complexityResult = await runPreClaimComplexityCheck(
            task,
            outcomeId,
            intent,
            complexityCheckConfig,
            appendLog
          );

          if (!complexityResult.shouldProceed) {
            appendLog(`[Complexity] Task will not proceed: ${complexityResult.reason}`);

            // Release the task since we won't run it
            releaseTask(task.id);

            // Record progress entry
            createProgressEntry({
              outcome_id: outcomeId,
              worker_id: workerId,
              iteration,
              content: `Complexity check: ${complexityResult.action} - ${task.title}`,
            });

            // If decomposed, the new subtasks will be picked up in the next iteration
            if (complexityResult.action === 'decomposed') {
              appendLog(`[Complexity] Task decomposed. Subtasks: ${complexityResult.decompositionResult?.createdTaskIds.join(', ')}`);
              continue; // Move to next iteration to pick up subtasks
            }

            // If escalated, worker should pause and wait for human decision
            if (complexityResult.action === 'escalated') {
              appendLog(`[Complexity] Worker pausing for human decision on task complexity`);
              workerState.running = false;
              break;
            }

            // If skipped for other reasons, continue to next task
            continue;
          }

          // Store estimate on task for future reference
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
        startTask(task.id);

        // Create task workspace
        const taskWorkspace = join(outcomeWorkspace, task.id);
        if (!existsSync(taskWorkspace)) {
          mkdirSync(taskWorkspace, { recursive: true });
        }

        // Write CLAUDE.md and progress.txt
        const claudeMdPath = join(taskWorkspace, 'CLAUDE.md');
        writeFileSync(claudeMdPath, generateTaskInstructions(outcome.name, intent, task, undefined, outcomeId, gitConfig));

        const progressPath = join(taskWorkspace, 'progress.txt');
        writeFileSync(progressPath, generateInitialProgress(task));

        // Spawn Claude for this task
        const ralphPrompt = `You are working on a specific task. Read CLAUDE.md for full instructions.
Complete the task, updating progress.txt as you go. When done, write DONE to progress.txt.`;

        const args = [
          '-p', ralphPrompt,
          '--dangerously-skip-permissions',
          '--max-turns', String(maxTurns),
        ];

        appendLog(`Spawning Claude for task: claude ${args.join(' ')}`);

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

        if (taskResult.success) {
          completeTask(task.id);
          progress.completedTasks++;
          appendLog(`Task completed: ${task.title}`);
          logTaskCompleted(outcomeId, outcome.name, task.title, workerId);

          // Circuit breaker: Record success (resets consecutive failures)
          recordSuccess(outcomeId);

          // Record progress entry with full output for auditing
          createProgressEntry({
            outcome_id: outcomeId,
            worker_id: workerId,
            iteration,
            content: `Completed: ${task.title}`,
            full_output: taskResult.fullOutput,
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
                if (observationResult.failurePatternDetected) {
                  appendLog(`HOMЯ: Failure pattern detected - consecutive failures`);
                  if (observationResult.workerPaused) {
                    appendLog(`HOMЯ: Worker paused for review - awaiting human input`);
                    workerState.running = false; // Stop the worker loop
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
        } else {
          failTask(task.id);
          appendLog(`Task failed: ${task.title} - ${taskResult.error}`);
          logTaskFailed(outcomeId, outcome.name, task.title, taskResult.error);

          // Circuit breaker: Record failure for pattern analysis
          recordFailure(outcomeId, task.id, taskResult.error || 'unknown error');

          // Record failure with full output for debugging
          createProgressEntry({
            outcome_id: outcomeId,
            worker_id: workerId,
            iteration,
            content: `Failed: ${task.title} - ${taskResult.error}`,
            full_output: taskResult.fullOutput,
          });

          // Check if this is a critical error
          if (taskResult.error?.includes('critical') || taskResult.error?.includes('blocked')) {
            hasError = true;
            errorMessage = taskResult.error;
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
          break;
        }
      }
    } catch (err) {
      hasError = true;
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      appendLog(`Worker error: ${errorMessage}`);
    }

    // Cleanup
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
    } else if (wasPaused) {
      updateWorker(workerId, { status: 'paused' });
      progress.status = 'stopped';
    } else {
      completeWorker(workerId);
      progress.status = 'completed';
      logWorkerCompleted(outcomeId, outcome.name, workerName, progress.completedTasks);
    }

    progress.lastUpdate = Date.now();
    activeWorkers.delete(workerId);

    appendLog(`Worker finished: ${progress.status}`);

    if (onProgress) {
      onProgress({ ...progress });
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
function extractCostFromOutput(output: string): number {
  try {
    // Claude CLI may output multiple JSON lines (streaming), find the result message
    const lines = output.split('\n').filter(l => l.trim());

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.type === 'result' && typeof parsed.total_cost_usd === 'number') {
          return parsed.total_cost_usd;
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // Try parsing the entire output as JSON (single-line response)
    const parsed = JSON.parse(output);
    if (typeof parsed.total_cost_usd === 'number') {
      return parsed.total_cost_usd;
    }
  } catch {
    // Failed to parse - no cost available
  }

  return 0;
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
): Promise<{ success: boolean; error?: string; fullOutput?: string; guardBlocks?: number }> {
  return new Promise((resolve) => {
    try {
      const claudeProcess = spawn('claude', args, {
        cwd: taskWorkspace,
        env: { ...process.env },
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
        const cost = extractCostFromOutput(fullOutput);
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
  maxTurns?: number;               // Worker's max turns per task (default: 20)
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
    maxTurns = 20,
  } = options;

  // Build complexity check config
  const complexityCheckConfig: ComplexityCheckConfig = {
    maxTurns,
    autoDecompose,
    escalateOnHighComplexity: true,
    complexityThreshold: 6,
    turnsWarningRatio: 0.8,
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
  const workspacePath = join(process.cwd(), 'workspaces');
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
      appendLog(`No more tasks available for phase: ${phase || 'any'}`);
      break;
    }

    const task = claimResult.task;
    appendLog(`Claimed task: ${task.title} (${task.id})`);
    logTaskClaimed(outcomeId, outcome.name, task.title, workerName);

    // Pre-claim complexity check
    if (enableComplexityCheck) {
      const complexityResult = await runPreClaimComplexityCheck(
        task,
        outcomeId,
        intent,
        complexityCheckConfig,
        appendLog
      );

      if (!complexityResult.shouldProceed) {
        appendLog(`[Complexity] Task will not proceed: ${complexityResult.reason}`);

        // Release the task since we won't run it
        releaseTask(task.id);

        // If decomposed, the new subtasks will be picked up in the next iteration
        if (complexityResult.action === 'decomposed') {
          appendLog(`[Complexity] Task decomposed. Subtasks: ${complexityResult.decompositionResult?.createdTaskIds.join(', ')}`);
          continue; // Move to next iteration to pick up subtasks
        }

        // If escalated, worker loop should stop and wait for human decision
        if (complexityResult.action === 'escalated') {
          appendLog(`[Complexity] Worker pausing for human decision on task complexity`);
          break;
        }

        // If skipped for other reasons, continue to next task
        continue;
      }

      // Store estimate on task for future reference
      if (complexityResult.estimate) {
        updateTaskDb(task.id, {
          complexity_score: complexityResult.estimate.complexity_score,
          estimated_turns: complexityResult.estimate.estimated_turns,
        });
      }
    }

    // Mark task as running
    startTask(task.id);

    // Create task workspace
    const taskWorkspace = join(outcomeWorkspace, task.id);
    if (!existsSync(taskWorkspace)) {
      mkdirSync(taskWorkspace, { recursive: true });
    }

    // Write CLAUDE.md with skill context and HOMЯ context
    const claudeMdPath = join(taskWorkspace, 'CLAUDE.md');
    writeFileSync(
      claudeMdPath,
      generateTaskInstructions(outcome.name, intent, task, skillContext, outcomeId, gitConfig)
    );

    const progressPath = join(taskWorkspace, 'progress.txt');
    writeFileSync(progressPath, generateInitialProgress(task));

    // Spawn Claude for this task
    const ralphPrompt = `You are working on a specific task. Read CLAUDE.md for full instructions.
Complete the task, updating progress.txt as you go. When done, write DONE to progress.txt.`;

    const args = [
      '-p', ralphPrompt,
      '--dangerously-skip-permissions',
      '--max-turns', String(maxTurns),
    ];

    appendLog(`Spawning Claude for task`);

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

    if (taskResult.success) {
      completeTask(task.id);
      appendLog(`Task completed: ${task.title}`);
      logTaskCompleted(outcomeId, outcome.name, task.title, workerId);

      // Record progress with full output for auditing
      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Completed: ${task.title}`,
        full_output: taskResult.fullOutput,
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
      failTask(task.id);
      appendLog(`Task failed: ${task.title} - ${taskResult.error}`);
      logTaskFailed(outcomeId, outcome.name, task.title, taskResult.error);

      // Record failure with full output for debugging
      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Failed: ${task.title} - ${taskResult.error}`,
        full_output: taskResult.fullOutput,
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
