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

import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createWorker,
  updateWorker,
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
} from '../db/tasks';
import type { Task, Intent, TaskPhase } from '../db/schema';
import { getOutcomeById } from '../db/outcomes';
import { createProgressEntry } from '../db/progress';
import {
  getPendingInterventionsForWorker,
  acknowledgeIntervention,
  completeIntervention,
} from '../db/interventions';
import { updateWorker as updateWorkerDb } from '../db/workers';
import { createWorktree, removeWorktree, isGitRepo } from '../worktree/manager';

// ============================================================================
// Types
// ============================================================================

export interface RalphConfig {
  outcomeId: string;
  workspacePath?: string;
  maxIterations?: number; // Default 50
  heartbeatIntervalMs?: number; // Default 30000 (30 seconds)
  useWorktree?: boolean; // Use git worktree for isolation (parallel workers)
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
// Instruction Generation
// ============================================================================

/**
 * Generate CLAUDE.md instructions for the current task
 */
function generateTaskInstructions(
  outcomeName: string,
  intent: Intent | null,
  task: Task,
  additionalSkillContext?: string
): string {
  const intentSummary = intent?.summary || 'No specific intent defined.';

  // Try to load relevant skills based on task title and description
  const searchQuery = `${task.title} ${task.description || ''}`;
  const skillContext = buildSkillContext(searchQuery, 2);

  // Combine built-in skill matching with any additional context from orchestrator
  const combinedSkillContext = [skillContext, additionalSkillContext]
    .filter(Boolean)
    .join('\n\n');

  return `# Current Task

## Outcome: ${outcomeName}
${intentSummary}

---

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
- Commit your work when making significant progress
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
  } = config;

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
  const dbWorker = createWorker({
    outcome_id: outcomeId,
    name: `Ralph Worker ${Date.now()}`,
  });
  const workerId = dbWorker.id;

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
  }

  // Start the worker (sets status to 'running', started_at, heartbeat)
  startWorkerDb(workerId);

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

  // Start the work loop
  (async () => {
    let iteration = 0;
    let hasError = false;
    let errorMessage: string | undefined;

    try {
      while (workerState.running && iteration < maxIterations) {
        iteration++;
        incrementIteration(workerId);

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
        writeFileSync(claudeMdPath, generateTaskInstructions(outcome.name, intent, task));

        const progressPath = join(taskWorkspace, 'progress.txt');
        writeFileSync(progressPath, generateInitialProgress(task));

        // Spawn Claude for this task
        const ralphPrompt = `You are working on a specific task. Read CLAUDE.md for full instructions.
Complete the task, updating progress.txt as you go. When done, write DONE to progress.txt.`;

        const args = [
          '-p', ralphPrompt,
          '--dangerously-skip-permissions',
          '--max-turns', '20',
        ];

        appendLog(`Spawning Claude for task: claude ${args.join(' ')}`);

        const taskResult = await executeTask(
          taskWorkspace,
          args,
          progressPath,
          workerId,
          task,
          appendLog
        );

        if (taskResult.success) {
          completeTask(task.id);
          progress.completedTasks++;
          appendLog(`Task completed: ${task.title}`);

          // Record progress entry
          createProgressEntry({
            outcome_id: outcomeId,
            worker_id: workerId,
            iteration,
            content: `Completed: ${task.title}`,
          });
        } else {
          failTask(task.id);
          appendLog(`Task failed: ${task.title} - ${taskResult.error}`);

          // Record failure
          createProgressEntry({
            outcome_id: outcomeId,
            worker_id: workerId,
            iteration,
            content: `Failed: ${task.title} - ${taskResult.error}`,
          });

          // Check if this is a critical error
          if (taskResult.error?.includes('critical') || taskResult.error?.includes('blocked')) {
            hasError = true;
            errorMessage = taskResult.error;
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

    // Final status - check if paused by intervention or stopped manually
    const wasPaused = !workerState.running && !hasError;
    if (hasError) {
      failWorker(workerId);
      progress.status = 'failed';
      progress.error = errorMessage;
    } else if (wasPaused) {
      updateWorker(workerId, { status: 'paused' });
      progress.status = 'stopped';
    } else {
      completeWorker(workerId);
      progress.status = 'completed';
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

/**
 * Execute a single task with Claude CLI
 */
async function executeTask(
  taskWorkspace: string,
  args: string[],
  progressPath: string,
  workerId: string,
  task: Task,
  appendLog: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      const claudeProcess = spawn('claude', args, {
        cwd: taskWorkspace,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const worker = activeWorkers.get(workerId);
      if (worker) {
        worker.process = claudeProcess;
      }

      let lastProgressContent = '';
      let checkInterval: NodeJS.Timeout;

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

      // Handle output
      claudeProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().substring(0, 500);
        appendLog(`stdout: ${output}`);
      });

      claudeProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().substring(0, 500);
        appendLog(`stderr: ${output}`);
      });

      // Handle completion
      claudeProcess.on('close', (code) => {
        clearInterval(checkInterval);

        // Final progress check
        checkProgress();

        if (existsSync(progressPath)) {
          const content = readFileSync(progressPath, 'utf-8');
          const parsed = parseTaskProgress(content);

          if (parsed.done) {
            resolve({ success: true });
          } else if (parsed.error) {
            resolve({ success: false, error: parsed.error });
          } else if (code === 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `Process exited with code ${code}` });
          }
        } else {
          resolve({ success: code === 0, error: code !== 0 ? `Exit code ${code}` : undefined });
        }
      });

      claudeProcess.on('error', (err) => {
        clearInterval(checkInterval);
        resolve({ success: false, error: err.message });
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
      });
    }
  });
}

// ============================================================================
// Worker Control
// ============================================================================

/**
 * Stop a running Ralph worker
 */
export function stopRalphWorker(workerId: string): boolean {
  const worker = activeWorkers.get(workerId);
  if (!worker) {
    return false;
  }

  worker.running = false;

  if (worker.process) {
    worker.process.kill('SIGTERM');
  }

  if (worker.heartbeatInterval) {
    clearInterval(worker.heartbeatInterval);
  }

  updateWorker(workerId, { status: 'paused' });
  activeWorkers.delete(workerId);

  return true;
}

/**
 * Get status of a Ralph worker
 */
export function getRalphWorkerStatus(workerId: string): RalphProgress | null {
  const worker = activeWorkers.get(workerId);
  return worker?.progress || null;
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

// ============================================================================
// Worker Loop (for Orchestrator)
// ============================================================================

export interface WorkerLoopOptions {
  singleTask?: boolean;           // Only process one task then exit
  phase?: TaskPhase;              // Filter tasks by phase
  skillContext?: string;          // Additional skill context to inject
  maxIterations?: number;         // Override max iterations
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
  } = options;

  // Get outcome
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    throw new Error('Outcome not found');
  }

  // Parse intent
  let intent: Intent | null = null;
  if (outcome.intent) {
    try {
      intent = JSON.parse(outcome.intent) as Intent;
    } catch {
      // Intent might not be valid JSON
    }
  }

  // Set up workspace
  const workspacePath = join(process.cwd(), 'workspaces');
  const outcomeWorkspace = join(workspacePath, outcomeId);

  if (!existsSync(outcomeWorkspace)) {
    mkdirSync(outcomeWorkspace, { recursive: true });
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

    // Try to claim a task (with optional phase filter)
    const claimResult = claimNextTask(outcomeId, workerId, phase);

    if (!claimResult.success || !claimResult.task) {
      appendLog(`No more tasks available for phase: ${phase || 'any'}`);
      break;
    }

    const task = claimResult.task;
    appendLog(`Claimed task: ${task.title} (${task.id})`);

    // Mark task as running
    startTask(task.id);

    // Create task workspace
    const taskWorkspace = join(outcomeWorkspace, task.id);
    if (!existsSync(taskWorkspace)) {
      mkdirSync(taskWorkspace, { recursive: true });
    }

    // Write CLAUDE.md with skill context
    const claudeMdPath = join(taskWorkspace, 'CLAUDE.md');
    writeFileSync(
      claudeMdPath,
      generateTaskInstructions(outcome.name, intent, task, skillContext)
    );

    const progressPath = join(taskWorkspace, 'progress.txt');
    writeFileSync(progressPath, generateInitialProgress(task));

    // Spawn Claude for this task
    const ralphPrompt = `You are working on a specific task. Read CLAUDE.md for full instructions.
Complete the task, updating progress.txt as you go. When done, write DONE to progress.txt.`;

    const args = [
      '-p', ralphPrompt,
      '--dangerously-skip-permissions',
      '--max-turns', '20',
    ];

    appendLog(`Spawning Claude for task`);

    const taskResult = await executeTask(
      taskWorkspace,
      args,
      progressPath,
      workerId,
      task,
      appendLog
    );

    if (taskResult.success) {
      completeTask(task.id);
      appendLog(`Task completed: ${task.title}`);

      // Record progress
      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Completed: ${task.title}`,
      });
    } else {
      failTask(task.id);
      appendLog(`Task failed: ${task.title} - ${taskResult.error}`);

      createProgressEntry({
        outcome_id: outcomeId,
        worker_id: workerId,
        iteration,
        content: `Failed: ${task.title} - ${taskResult.error}`,
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
