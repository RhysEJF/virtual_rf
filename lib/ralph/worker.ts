/**
 * Ralph Worker
 *
 * Spawns an autonomous Claude Code CLI process that works through a PRD.
 * Named after the "Ralph Wiggum" loop pattern.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';
import { PRDItem } from '../agents/briefer';
import { updateProject } from '../db/projects';
import { createWorker, updateWorker } from '../db/workers';

export interface RalphConfig {
  projectId: string;
  projectName: string;
  objective: string;
  prd: PRDItem[];
  workspacePath?: string; // Where to create the project, defaults to ./workspaces
}

export interface RalphProgress {
  workerId: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  currentTask?: string;
  completedTasks: number;
  totalTasks: number;
  lastUpdate: number;
  error?: string;
}

export interface RalphResult {
  success: boolean;
  workerId: string;
  completedTasks: number;
  totalTasks: number;
  error?: string;
}

// Active workers map for tracking
const activeWorkers = new Map<string, {
  process: ChildProcess;
  config: RalphConfig;
  progress: RalphProgress;
}>();

/**
 * Generate the CLAUDE.md instructions for the worker
 */
function generateWorkerInstructions(config: RalphConfig): string {
  const prdChecklist = config.prd
    .map((item, i) => `- [ ] **${item.id}. ${item.title}**: ${item.description}`)
    .join('\n');

  return `# Project: ${config.projectName}

## Objective
${config.objective}

## Your Task
Work through the PRD checklist below. For each item:
1. Implement the task
2. Update progress.txt with your status
3. Move to the next item

## PRD Checklist
${prdChecklist}

## Progress Tracking
After completing each task, update \`progress.txt\` with:
\`\`\`
COMPLETED: [task number]
CURRENT: [next task number or "DONE"]
STATUS: [brief status message]
\`\`\`

## Completion
When all tasks are done, write to progress.txt:
\`\`\`
COMPLETED: ALL
CURRENT: DONE
STATUS: Project complete
\`\`\`

## Rules
- Work autonomously through the checklist
- Create clean, well-structured code
- Commit after each major task if this is a git repo
- Keep going until all tasks are complete or you hit a blocker
- If blocked, write BLOCKED: [reason] to progress.txt
`;
}

/**
 * Generate initial progress.txt content
 */
function generateInitialProgress(config: RalphConfig): string {
  return `COMPLETED: 0
CURRENT: 1
STATUS: Starting project - ${config.projectName}
TOTAL: ${config.prd.length}
`;
}

/**
 * Parse progress.txt content
 */
function parseProgress(content: string): { completed: number; current: string; status: string; blocked?: string } {
  const lines = content.split('\n');
  const result: { completed: number; current: string; status: string; blocked?: string } = {
    completed: 0,
    current: '1',
    status: 'Unknown',
  };

  for (const line of lines) {
    if (line.startsWith('COMPLETED:')) {
      const val = line.replace('COMPLETED:', '').trim();
      result.completed = val === 'ALL' ? -1 : parseInt(val, 10) || 0;
    } else if (line.startsWith('CURRENT:')) {
      result.current = line.replace('CURRENT:', '').trim();
    } else if (line.startsWith('STATUS:')) {
      result.status = line.replace('STATUS:', '').trim();
    } else if (line.startsWith('BLOCKED:')) {
      result.blocked = line.replace('BLOCKED:', '').trim();
    }
  }

  return result;
}

/**
 * Start a Ralph worker for a project
 */
export async function startRalphWorker(
  config: RalphConfig,
  onProgress?: (progress: RalphProgress) => void
): Promise<{ workerId: string; started: boolean; error?: string }> {
  const baseWorkspace = config.workspacePath || join(process.cwd(), 'workspaces');
  const projectWorkspace = join(baseWorkspace, config.projectId);

  // Create workspace directory
  if (!existsSync(baseWorkspace)) {
    mkdirSync(baseWorkspace, { recursive: true });
  }
  if (!existsSync(projectWorkspace)) {
    mkdirSync(projectWorkspace, { recursive: true });
  }

  // Write CLAUDE.md
  const claudeMdPath = join(projectWorkspace, 'CLAUDE.md');
  writeFileSync(claudeMdPath, generateWorkerInstructions(config));

  // Write initial progress.txt
  const progressPath = join(projectWorkspace, 'progress.txt');
  writeFileSync(progressPath, generateInitialProgress(config));

  // Create worker in database (returns worker with auto-generated ID)
  const dbWorker = createWorker({
    project_id: config.projectId,
    name: 'Ralph Worker',
    prd_slice: config.prd as unknown as import('../db/schema').PRDFeature[], // Type cast for compat
  });
  const workerId = dbWorker.id;

  // Initialize progress tracking
  const progress: RalphProgress = {
    workerId,
    status: 'starting',
    completedTasks: 0,
    totalTasks: config.prd.length,
    lastUpdate: Date.now(),
  };

  // Build the prompt for Ralph
  const ralphPrompt = `You are working on: ${config.projectName}

Read CLAUDE.md for full instructions and the PRD checklist.
Work through each task in order, updating progress.txt after each one.
Keep going until all tasks are complete.

Start by reading CLAUDE.md, then begin with task 1.`;

  // Spawn Claude CLI
  const args = [
    '-p', ralphPrompt,
    '--dangerously-skip-permissions',
    '--max-turns', '50', // Allow up to 50 turns for complex projects
  ];

  console.log(`[Ralph] Starting worker ${workerId} in ${projectWorkspace}`);
  console.log(`[Ralph] Command: claude ${args.join(' ')}`);

  try {
    const claudeProcess = spawn('claude', args, {
      cwd: projectWorkspace,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Track the worker
    activeWorkers.set(workerId, {
      process: claudeProcess,
      config,
      progress,
    });

    // Update status
    progress.status = 'running';
    updateWorker(workerId, { status: 'running', started_at: Date.now() });

    // Watch progress.txt for changes
    let lastProgressContent = '';
    const checkProgress = () => {
      if (existsSync(progressPath)) {
        const content = readFileSync(progressPath, 'utf-8');
        if (content !== lastProgressContent) {
          lastProgressContent = content;
          const parsed = parseProgress(content);

          progress.completedTasks = parsed.completed === -1 ? config.prd.length : parsed.completed;
          progress.currentTask = parsed.current;
          progress.lastUpdate = Date.now();

          if (parsed.blocked) {
            progress.status = 'failed';
            progress.error = parsed.blocked;
          } else if (parsed.current === 'DONE') {
            progress.status = 'completed';
          }

          // Update database
          updateWorker(workerId, {
            progress: { completed: progress.completedTasks, total: progress.totalTasks },
          });

          // Callback
          if (onProgress) {
            onProgress({ ...progress });
          }
        }
      }
    };

    // Poll progress every 2 seconds
    const progressInterval = setInterval(checkProgress, 2000);

    // Handle process output
    claudeProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`[Ralph ${workerId}] stdout:`, data.toString().substring(0, 200));
    });

    claudeProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[Ralph ${workerId}] stderr:`, data.toString().substring(0, 200));
    });

    // Handle process completion
    claudeProcess.on('close', (code) => {
      clearInterval(progressInterval);

      console.log(`[Ralph ${workerId}] Process exited with code ${code}`);

      // Final progress check
      checkProgress();

      const finalStatus = progress.status === 'completed' ? 'completed' : (code === 0 ? 'completed' : 'failed');

      updateWorker(workerId, {
        status: finalStatus as import('../db/schema').WorkerStatus,
        progress: { completed: progress.completedTasks, total: progress.totalTasks },
      });

      // Update project status if worker completed
      if (finalStatus === 'completed') {
        updateProject(config.projectId, { status: 'completed' });
      }

      activeWorkers.delete(workerId);

      if (onProgress) {
        onProgress({
          ...progress,
          status: finalStatus as RalphProgress['status'],
        });
      }
    });

    claudeProcess.on('error', (err) => {
      clearInterval(progressInterval);
      console.error(`[Ralph ${workerId}] Process error:`, err);

      progress.status = 'failed';
      progress.error = err.message;

      updateWorker(workerId, { status: 'failed' });
      activeWorkers.delete(workerId);

      if (onProgress) {
        onProgress({ ...progress });
      }
    });

    // Update project status
    updateProject(config.projectId, { status: 'active' });

    return { workerId, started: true };
  } catch (error) {
    console.error('[Ralph] Failed to spawn process:', error);
    return {
      workerId,
      started: false,
      error: error instanceof Error ? error.message : 'Failed to start worker',
    };
  }
}

/**
 * Stop a running Ralph worker
 */
export function stopRalphWorker(workerId: string): boolean {
  const worker = activeWorkers.get(workerId);
  if (!worker) {
    return false;
  }

  worker.process.kill('SIGTERM');
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
