/**
 * Worker Command
 *
 * Shows details for a specific worker.
 * Usage: flow worker <worker-id> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, WorkerStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

/**
 * Formats worker status with color
 */
function formatWorkerStatus(status: WorkerStatus): string {
  switch (status) {
    case 'idle':
      return chalk.gray('idle');
    case 'running':
      return chalk.cyan('running');
    case 'paused':
      return chalk.yellow('paused');
    case 'completed':
      return chalk.green('completed');
    case 'failed':
      return chalk.red('failed');
    default:
      return status;
  }
}

/**
 * Formats a timestamp to relative time
 */
function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '-';

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
 * Formats cost as currency
 */
function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

// Create the main worker command
const workerCommand = new Command('worker')
  .description('Show worker details');

// Show worker details: flow worker show <id>
const showSubcommand = new Command('show')
  .description('Show worker details')
  .argument('<worker-id>', 'Worker ID to display');

addOutputFlags(showSubcommand);

showSubcommand.action(async (workerId: string, options: OutputOptions) => {
  try {
    const response = await api.workers.get(workerId);
    const { worker, currentTask, completedTasks, totalTasks } = response as {
      worker: typeof response.worker;
      currentTask?: { id: string; title: string; status: string };
      completedTasks?: Array<{ id: string; title: string }>;
      totalTasks?: number;
    };

    // Handle JSON output
    if (options.json) {
      handleOutput(response, options);
      return;
    }

    // Handle quiet output (status only)
    if (options.quiet) {
      console.log(worker.status);
      return;
    }

    // Display worker details
    console.log();
    console.log(chalk.bold.white(`Worker: ${worker.id}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Name:        ${chalk.white(worker.name)}`);
    console.log(`Status:      ${formatWorkerStatus(worker.status)}`);
    console.log(`Outcome:     ${chalk.gray(worker.outcome_id)}`);
    console.log(`Iteration:   ${chalk.white(worker.iteration.toString())}`);
    console.log(`Cost:        ${chalk.white(formatCost(worker.cost))}`);

    if (worker.started_at) {
      console.log(`Started:     ${chalk.white(formatRelativeTime(worker.started_at))}`);
    }

    if (worker.last_heartbeat) {
      console.log(`Heartbeat:   ${chalk.white(formatRelativeTime(worker.last_heartbeat))}`);
    }

    if (worker.pid) {
      console.log(`PID:         ${chalk.gray(worker.pid.toString())}`);
    }

    if (worker.branch_name) {
      console.log(`Branch:      ${chalk.gray(worker.branch_name)}`);
    }

    if (worker.worktree_path) {
      console.log(`Worktree:    ${chalk.gray(worker.worktree_path)}`);
    }

    // Current task
    if (currentTask) {
      console.log();
      console.log(chalk.bold.cyan('Current Task:'));
      console.log(`  ID:     ${chalk.gray(currentTask.id)}`);
      console.log(`  Title:  ${chalk.white(currentTask.title)}`);
      console.log(`  Status: ${chalk.cyan(currentTask.status)}`);
    } else if (worker.current_task_id) {
      console.log();
      console.log(chalk.bold.cyan('Current Task:'));
      console.log(`  ID:     ${chalk.gray(worker.current_task_id)}`);
    }

    // Progress summary
    if (worker.progress_summary) {
      console.log();
      console.log(chalk.bold.cyan('Progress:'));
      console.log(`  ${chalk.white(worker.progress_summary)}`);
    }

    // Task stats
    if (totalTasks !== undefined) {
      console.log();
      console.log(chalk.bold.cyan('Task Stats:'));
      console.log(`  Total:     ${chalk.white(totalTasks.toString())}`);
      if (completedTasks) {
        console.log(`  Completed: ${chalk.green(completedTasks.length.toString())}`);
      }
    }

    console.log();

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      if (error.status === 404) {
        console.error(chalk.red('Error:'), `Worker not found: ${workerId}`);
      } else {
        console.error(chalk.red('API Error:'), error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

// Register subcommand
workerCommand.addCommand(showSubcommand);

// Also support direct worker ID as argument: flow worker <id>
// This is the default action when no subcommand is provided
workerCommand
  .argument('[worker-id]', 'Worker ID to display (shorthand for "flow worker show <id>")')
  .action(async (workerId: string | undefined, _options: OutputOptions) => {
    if (!workerId) {
      // No worker ID provided and no subcommand, show help
      workerCommand.help();
      return;
    }

    // Delegate to show subcommand
    await showSubcommand.parseAsync(['show', workerId, ...process.argv.slice(4)], { from: 'user' });
  });

export { workerCommand };
export default workerCommand;
