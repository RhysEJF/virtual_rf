/**
 * Workers Command
 *
 * Lists all workers (Ralph instances) with optional outcome filtering.
 * Usage: flow workers [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, WorkerStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

/**
 * Pads a string to a specified length
 */
function padEnd(str: string, length: number): string {
  if (str.length >= length) {
    return str.substring(0, length - 1) + '…';
  }
  return str + ' '.repeat(length - str.length);
}

/**
 * Formats worker status with color
 */
function formatWorkerStatus(status: WorkerStatus): string {
  switch (status) {
    case 'idle':
      return chalk.gray(padEnd(status, 12));
    case 'running':
      return chalk.cyan(padEnd(status, 12));
    case 'paused':
      return chalk.yellow(padEnd(status, 12));
    case 'completed':
      return chalk.green(padEnd(status, 12));
    case 'failed':
      return chalk.red(padEnd(status, 12));
    default:
      return padEnd(status, 12);
  }
}

interface WorkersOptions extends OutputOptions {
  outcome?: string;
}

const command = new Command('workers')
  .description('List all workers (Ralph instances)')
  .option('--outcome <id>', 'Filter by outcome ID');

addOutputFlags(command);

export const workersCommand = command
  .action(async (options: WorkersOptions) => {
    try {
      // Fetch workers
      const response = await api.workers.list(
        options.outcome ? { outcome: options.outcome } : undefined
      );
      const workers = response.workers;

      // Handle JSON output
      if (options.json) {
        handleOutput(workers, options);
        return;
      }

      // Handle quiet output (IDs only)
      if (options.quiet) {
        for (const worker of workers) {
          console.log(worker.id);
        }
        return;
      }

      // No workers found
      if (workers.length === 0) {
        console.log();
        if (options.outcome) {
          console.log(chalk.gray(`No workers found for outcome ${options.outcome}`));
        } else {
          console.log(chalk.gray('No workers found'));
        }
        console.log();
        return;
      }

      // Table configuration
      const idWidth = 16;
      const outcomeWidth = 16;
      const statusWidth = 12;
      const taskWidth = 18;
      const iterationWidth = 10;

      // Print header
      console.log();
      console.log(chalk.bold(`Workers (${workers.length})`));
      console.log();
      console.log(
        chalk.bold.gray(padEnd('ID', idWidth)) +
        chalk.bold.gray(padEnd('OUTCOME', outcomeWidth)) +
        chalk.bold.gray(padEnd('STATUS', statusWidth)) +
        chalk.bold.gray(padEnd('TASK', taskWidth)) +
        chalk.bold.gray('ITERATION')
      );
      console.log(chalk.gray('─'.repeat(idWidth + outcomeWidth + statusWidth + taskWidth + iterationWidth)));

      // Print rows
      for (const worker of workers) {
        const id = padEnd(worker.id, idWidth);
        const outcomeId = padEnd(worker.outcome_id, outcomeWidth);
        const status = formatWorkerStatus(worker.status);
        const taskId = padEnd(worker.current_task_id || '-', taskWidth);
        const iteration = worker.iteration.toString();

        console.log(`${chalk.gray(id)}${chalk.gray(outcomeId)}${status}${chalk.gray(taskId)}${chalk.white(iteration)}`);
      }

      console.log();

      // Print summary
      const runningCount = workers.filter(w => w.status === 'running').length;
      const pausedCount = workers.filter(w => w.status === 'paused').length;
      const completedCount = workers.filter(w => w.status === 'completed').length;
      const failedCount = workers.filter(w => w.status === 'failed').length;
      const idleCount = workers.filter(w => w.status === 'idle').length;

      const summaryParts: string[] = [];
      if (runningCount > 0) summaryParts.push(chalk.cyan(`${runningCount} running`));
      if (pausedCount > 0) summaryParts.push(chalk.yellow(`${pausedCount} paused`));
      if (idleCount > 0) summaryParts.push(chalk.gray(`${idleCount} idle`));
      if (completedCount > 0) summaryParts.push(chalk.green(`${completedCount} completed`));
      if (failedCount > 0) summaryParts.push(chalk.red(`${failedCount} failed`));

      if (summaryParts.length > 0) {
        console.log(summaryParts.join(', '));
        console.log();
      }

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });

export default workersCommand;
