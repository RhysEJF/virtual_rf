/**
 * Workers Command
 *
 * Lists all workers (Ralph instances) with optional outcome filtering.
 * Usage: flow workers [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';
import { workerStatusLabel } from '../utils/status.js';
import { drawTable } from '../utils/table.js';
import { createSpinner } from '../utils/spinner.js';

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
      const spinner = createSpinner('Loading workers...');

      // Fetch workers
      const response = await api.workers.list(
        options.outcome ? { outcome: options.outcome } : undefined
      );
      const workers = response.workers;

      spinner.stop();

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
          console.log(chalk.gray(`  No workers found for outcome ${options.outcome}`));
        } else {
          console.log(chalk.white('  No workers running.'));
          console.log(chalk.gray('  Start one with: flow start <outcome-id>'));
        }
        console.log();
        return;
      }

      // Build table data
      const headers = ['ID', 'OUTCOME', 'STATUS', 'TASK', 'ITERATION'];
      const rows: string[][] = workers.map(worker => {
        const id = chalk.gray(worker.id);
        const outcomeId = chalk.gray(worker.outcome_id);
        const status = workerStatusLabel(worker.status);
        const taskId = worker.current_task_id ? chalk.gray(worker.current_task_id) : chalk.gray('-');
        const iteration = chalk.white(worker.iteration.toString());
        return [id, outcomeId, status, taskId, iteration];
      });

      console.log();
      console.log(chalk.bold(`  Workers (${workers.length})`));
      console.log();
      drawTable(headers, rows, { columnWidths: [16, 16, 16, 18, 12] });
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
        console.log(`  ${summaryParts.join(', ')}`);
        console.log();
      }

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Flow API');
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
