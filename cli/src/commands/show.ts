/**
 * Show Command
 *
 * Displays detailed information about a specific outcome including:
 * - Basic info (name, status, capability phase)
 * - Intent/brief
 * - Tasks breakdown by status
 * - Active workers
 * - Convergence status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Outcome, Task, Worker } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

// Extended types for the show command response
interface TaskStats {
  total: number;
  pending: number;
  claimed: number;
  running: number;
  completed: number;
  failed: number;
}

interface ConvergenceInfo {
  is_converging: boolean;
  consecutive_clean: number;
  threshold: number;
  total_cycles: number;
  last_cycle_at: number | null;
}

interface OutcomeDetailResponse {
  outcome: Outcome;
  convergence: ConvergenceInfo | null;
  taskStats: TaskStats;
  parent: { id: string; name: string } | null;
  children: Array<{ id: string; name: string }>;
  breadcrumbs: Array<{ id: string; name: string }>;
  aggregatedStats: unknown;
  isParent: boolean;
}

interface TasksResponse {
  tasks: Task[];
}

interface WorkersResponse {
  workers: Worker[];
}

/**
 * Formats a timestamp to relative time (e.g., "2h ago", "3d ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Formats the capability status
 */
function formatCapabilityStatus(status: number): string {
  switch (status) {
    case 0:
      return chalk.yellow('Needs Capability');
    case 1:
      return chalk.cyan('Building Capability');
    case 2:
      return chalk.green('Ready');
    default:
      return chalk.gray('Unknown');
  }
}

/**
 * Formats the outcome status with color
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return chalk.green('● Active');
    case 'dormant':
      return chalk.gray('○ Dormant');
    case 'achieved':
      return chalk.cyan('✓ Achieved');
    case 'archived':
      return chalk.gray('◌ Archived');
    default:
      return status;
  }
}

/**
 * Formats task status with color
 */
function formatTaskStatus(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.yellow(status);
    case 'claimed':
      return chalk.blue(status);
    case 'running':
      return chalk.cyan(status);
    case 'completed':
      return chalk.green(status);
    case 'failed':
      return chalk.red(status);
    default:
      return status;
  }
}

/**
 * Formats worker status with color
 */
function formatWorkerStatus(status: string): string {
  switch (status) {
    case 'idle':
      return chalk.gray('○ Idle');
    case 'running':
      return chalk.green('● Running');
    case 'paused':
      return chalk.yellow('◐ Paused');
    case 'completed':
      return chalk.cyan('✓ Completed');
    case 'failed':
      return chalk.red('✗ Failed');
    default:
      return status;
  }
}

/**
 * Truncates text to a max length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

interface ShowOptions extends OutputOptions {
  tasks?: boolean;
  workers?: boolean;
  intent?: boolean;
}

const command = new Command('show')
  .description('Show detailed outcome information')
  .argument('<id>', 'Outcome ID to display')
  .option('--tasks', 'Show full task list', false)
  .option('--workers', 'Show full worker list', false)
  .option('--intent', 'Show full intent text', false);

addOutputFlags(command);

export const showCommand = command
  .action(async (id: string, options: ShowOptions) => {
    try {
      // Fetch outcome details with relations
      const detailResponse = await api.get<OutcomeDetailResponse>(`/outcomes/${id}`);
      const { outcome, convergence, taskStats, parent, children, breadcrumbs } = detailResponse;

      // Fetch tasks and workers in parallel
      const [tasksResponse, workersResponse] = await Promise.all([
        api.outcomes.tasks(id) as Promise<TasksResponse>,
        api.get<WorkersResponse>(`/outcomes/${id}/workers`),
      ]);

      const { tasks } = tasksResponse;
      const { workers } = workersResponse;

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        const data = {
          ...detailResponse,
          tasks,
          workers,
        };
        if (handleOutput(data, options, outcome.id)) {
          return;
        }
      }

      // Header
      console.log();
      console.log(chalk.bold.white(outcome.name));

      // Breadcrumbs if exists
      if (breadcrumbs.length > 1) {
        const path = breadcrumbs.slice(0, -1).map(b => b.name).join(' → ');
        console.log(chalk.gray(`  └─ ${path}`));
      }

      console.log(chalk.gray('─'.repeat(60)));
      console.log();

      // Basic Info Section
      console.log(chalk.bold.cyan('Info'));
      console.log(`  ID:         ${chalk.gray(outcome.id)}`);
      console.log(`  Status:     ${formatStatus(outcome.status)}`);
      console.log(`  Capability: ${formatCapabilityStatus(outcome.capability_ready)}`);
      console.log(`  Created:    ${chalk.white(formatRelativeTime(outcome.created_at))}`);
      console.log(`  Updated:    ${chalk.white(formatRelativeTime(outcome.updated_at))}`);

      if (parent) {
        console.log(`  Parent:     ${chalk.white(parent.name)} ${chalk.gray(`(${parent.id})`)}`);
      }

      if (children.length > 0) {
        console.log(`  Children:   ${chalk.white(children.length.toString())} sub-outcomes`);
      }

      console.log();

      // Intent Section
      console.log(chalk.bold.cyan('Intent'));
      if (outcome.intent) {
        if (options.intent) {
          // Show full intent
          console.log(chalk.white(outcome.intent.split('\n').map(line => `  ${line}`).join('\n')));
        } else {
          // Show truncated intent
          const preview = outcome.intent.replace(/\n/g, ' ').trim();
          console.log(`  ${chalk.white(truncate(preview, 80))}`);
          if (outcome.intent.length > 80) {
            console.log(chalk.gray('  (use --intent to see full text)'));
          }
        }
      } else if (outcome.brief) {
        console.log(`  ${chalk.white(truncate(outcome.brief, 80))}`);
      } else {
        console.log(chalk.gray('  No intent defined'));
      }
      console.log();

      // Tasks Section
      console.log(chalk.bold.cyan('Tasks'));
      if (taskStats.total === 0) {
        console.log(chalk.gray('  No tasks'));
      } else {
        // Task summary bar
        const segments: string[] = [];
        if (taskStats.completed > 0) segments.push(chalk.green(`${taskStats.completed} completed`));
        if (taskStats.running > 0) segments.push(chalk.cyan(`${taskStats.running} running`));
        if (taskStats.claimed > 0) segments.push(chalk.blue(`${taskStats.claimed} claimed`));
        if (taskStats.pending > 0) segments.push(chalk.yellow(`${taskStats.pending} pending`));
        if (taskStats.failed > 0) segments.push(chalk.red(`${taskStats.failed} failed`));

        console.log(`  Total: ${chalk.white(taskStats.total.toString())} — ${segments.join(', ')}`);

        if (options.tasks) {
          // Show full task list
          console.log();
          for (const task of tasks) {
            const statusBadge = formatTaskStatus(task.status);
            const priority = task.priority > 0 ? chalk.gray(` [P${task.priority}]`) : '';
            console.log(`    ${chalk.gray('•')} ${truncate(task.title, 50)} ${statusBadge}${priority}`);
          }
        } else if (tasks.length > 0) {
          // Show first few tasks
          const recentTasks = tasks.slice(0, 3);
          console.log();
          for (const task of recentTasks) {
            const statusBadge = formatTaskStatus(task.status);
            console.log(`    ${chalk.gray('•')} ${truncate(task.title, 50)} ${statusBadge}`);
          }
          if (tasks.length > 3) {
            console.log(chalk.gray(`    ... and ${tasks.length - 3} more (use --tasks to see all)`));
          }
        }
      }
      console.log();

      // Workers Section
      console.log(chalk.bold.cyan('Workers'));
      const activeWorkers = workers.filter(w => w.status === 'running' || w.status === 'paused');
      const totalWorkers = workers.length;

      if (totalWorkers === 0) {
        console.log(chalk.gray('  No workers'));
      } else {
        console.log(`  Total: ${chalk.white(totalWorkers.toString())} — ${chalk.green(activeWorkers.length.toString())} active`);

        if (options.workers || activeWorkers.length > 0) {
          // Show workers
          const workersToShow = options.workers ? workers : activeWorkers;
          console.log();
          for (const worker of workersToShow) {
            const status = formatWorkerStatus(worker.status);
            const iteration = worker.iteration > 0 ? chalk.gray(` (iter ${worker.iteration})`) : '';
            const task = worker.current_task_id ? chalk.gray(` → ${worker.current_task_id}`) : '';
            console.log(`    ${chalk.gray('•')} ${chalk.white(worker.name)} ${status}${iteration}${task}`);
            if (worker.progress_summary) {
              console.log(`      ${chalk.gray(truncate(worker.progress_summary, 55))}`);
            }
          }
          if (!options.workers && totalWorkers > activeWorkers.length) {
            console.log(chalk.gray(`    ... and ${totalWorkers - activeWorkers.length} inactive (use --workers to see all)`));
          }
        }
      }
      console.log();

      // Convergence Section
      if (convergence && convergence.consecutive_clean !== undefined) {
        console.log(chalk.bold.cyan('Convergence'));
        if (convergence.is_converging) {
          console.log(`  ${chalk.green('✓')} Converging — ${chalk.white(convergence.consecutive_clean.toString())}/${convergence.threshold} clean reviews`);
        } else {
          console.log(`  ${chalk.gray('○')} Not converging — ${chalk.white(convergence.consecutive_clean.toString())}/${convergence.threshold} clean reviews`);
        }
        if (convergence.total_cycles > 0) {
          console.log(`  Review cycles: ${chalk.white(convergence.total_cycles.toString())}`);
          if (convergence.last_cycle_at) {
            console.log(`  Last review: ${chalk.white(formatRelativeTime(convergence.last_cycle_at))}`);
          }
        }
        console.log();
      }

      // Git Info (if configured)
      if (outcome.git_mode !== 'none' && outcome.working_directory) {
        console.log(chalk.bold.cyan('Git'));
        console.log(`  Mode:       ${chalk.white(outcome.git_mode)}`);
        console.log(`  Directory:  ${chalk.gray(outcome.working_directory)}`);
        if (outcome.work_branch) {
          console.log(`  Branch:     ${chalk.white(outcome.work_branch)}`);
        }
        if (outcome.auto_commit) {
          console.log(`  Auto-commit: ${chalk.green('enabled')}`);
        }
        console.log();
      }

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome not found: ${id}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default showCommand;
