/**
 * Flow Pause Command
 *
 * Pauses all workers for an outcome via DELETE /api/outcomes/[id]/workers?all=true
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Worker, WorkerStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

// Response type for pausing workers
interface PauseWorkersResponse {
  success: boolean;
  message: string;
  stoppedCount: number;
}

// Response type for listing workers
interface WorkersListResponse {
  workers: Worker[];
}

const command = new Command('pause')
  .description('Pause all workers for an outcome')
  .argument('<outcome-id>', 'The outcome ID to pause workers for');

addOutputFlags(command);

export const flowPauseCommand = command
  .action(async (outcomeId: string, options: OutputOptions) => {
    try {
      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray(`Pausing workers for outcome ${outcomeId}...`));
      }

      // First get the current workers to show what we're pausing
      const workersResponse = await api.get<WorkersListResponse>(
        `/outcomes/${outcomeId}/workers`
      );
      const runningWorkers = workersResponse.workers.filter(w => w.status === 'running');

      if (runningWorkers.length === 0) {
        // Handle JSON/quiet output for no workers case
        if (options.json || options.quiet) {
          const data = {
            success: true,
            message: 'No running workers to pause',
            stoppedCount: 0,
            outcomeId
          };
          if (handleOutput(data, options)) {
            return;
          }
        }

        console.log();
        console.log(chalk.yellow('⚠'), `No running workers found for outcome ${outcomeId}`);
        console.log();
        console.log(chalk.gray(`Use 'rf start ${outcomeId}' to start a worker`));
        console.log();
        return;
      }

      // Stop all workers for this outcome
      const response = await api.delete<PauseWorkersResponse>(
        `/outcomes/${outcomeId}/workers?all=true`
      );

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        const data = {
          ...response,
          outcomeId,
          pausedWorkers: runningWorkers.map(w => w.id)
        };
        if (handleOutput(data, options, outcomeId)) {
          return;
        }
      }

      console.log();
      console.log(chalk.green('✓'), chalk.bold(`Paused ${response.stoppedCount} worker${response.stoppedCount !== 1 ? 's' : ''}`));
      console.log();

      // Show details of paused workers
      for (const worker of runningWorkers) {
        console.log(`  ${chalk.gray('Worker:')}     ${chalk.cyan(worker.id)}`);
        console.log(`    ${chalk.gray('Name:')}     ${worker.name}`);
        console.log(`    ${chalk.gray('Status:')}   ${formatStatus('paused')}`);
        console.log(`    ${chalk.gray('Iteration:')} ${worker.iteration}`);
        if (worker.current_task_id) {
          console.log(`    ${chalk.gray('Task:')}     ${chalk.cyan(worker.current_task_id)}`);
        }
        console.log();
      }

      console.log(chalk.gray(`Use 'rf start ${outcomeId}' to start a new worker`));
      console.log();
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error();
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }

      if (error instanceof ApiError) {
        console.error();

        // Handle specific error cases
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome '${outcomeId}' not found`);
          process.exit(1);
        }

        console.error(chalk.red('API Error:'), error.message);
        if (error.body && typeof error.body === 'object' && 'error' in error.body) {
          console.error(chalk.gray((error.body as { error: string }).error));
        }
        process.exit(1);
      }

      throw error;
    }
  });

/**
 * Format worker status with appropriate color
 */
function formatStatus(status: WorkerStatus): string {
  switch (status) {
    case 'running':
      return chalk.green(status);
    case 'paused':
      return chalk.yellow(status);
    case 'completed':
      return chalk.green(status);
    case 'failed':
      return chalk.red(status);
    case 'idle':
      return chalk.gray(status);
    default:
      return status;
  }
}

export default flowPauseCommand;
