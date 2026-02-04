/**
 * Flow Resume Command
 *
 * Resumes/starts workers for an outcome via POST /api/outcomes/[id]/workers
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Worker, WorkerStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

// Response type for listing workers
interface WorkersListResponse {
  workers: Worker[];
}

// Response type for starting a worker
interface StartWorkerResponse {
  success: boolean;
  workerId: string;
  message: string;
  parallel: boolean;
  usingWorktree: boolean;
}

// Error response when worker is already running
interface WorkerConflictError {
  error: string;
  workerId?: string;
  runningCount?: number;
}

const command = new Command('resume')
  .description('Resume workers for an outcome')
  .argument('<outcome-id>', 'The outcome ID to resume workers for');

addOutputFlags(command);

export const flowResumeCommand = command
  .action(async (outcomeId: string, options: OutputOptions) => {
    try {
      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray(`Resuming workers for outcome ${outcomeId}...`));
      }

      // First check current worker status
      const workersResponse = await api.get<WorkersListResponse>(
        `/outcomes/${outcomeId}/workers`
      );
      const runningWorkers = workersResponse.workers.filter(w => w.status === 'running');
      const pausedWorkers = workersResponse.workers.filter(w => w.status === 'paused');

      // If workers are already running
      if (runningWorkers.length > 0) {
        if (options.json || options.quiet) {
          const data = {
            success: true,
            message: 'Workers already running',
            runningCount: runningWorkers.length,
            outcomeId,
            workers: runningWorkers.map(w => w.id)
          };
          if (handleOutput(data, options)) {
            return;
          }
        }

        console.log();
        console.log(chalk.yellow('⚠'), `${runningWorkers.length} worker${runningWorkers.length !== 1 ? 's' : ''} already running for outcome ${outcomeId}`);
        console.log();

        for (const worker of runningWorkers) {
          console.log(`  ${chalk.gray('Worker:')}     ${chalk.cyan(worker.id)}`);
          console.log(`    ${chalk.gray('Name:')}     ${worker.name}`);
          console.log(`    ${chalk.gray('Status:')}   ${formatStatus(worker.status)}`);
          console.log(`    ${chalk.gray('Iteration:')} ${worker.iteration}`);
          if (worker.current_task_id) {
            console.log(`    ${chalk.gray('Task:')}     ${chalk.cyan(worker.current_task_id)}`);
          }
          console.log();
        }

        console.log(chalk.gray(`Use 'rf flow pause ${outcomeId}' to stop the workers`));
        console.log();
        return;
      }

      // Start a new worker for this outcome
      const response = await api.post<StartWorkerResponse>(
        `/outcomes/${outcomeId}/workers`,
        {}
      );

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        const data = {
          success: true,
          message: 'Worker started',
          workerId: response.workerId,
          outcomeId,
          previouslyPaused: pausedWorkers.length
        };
        if (handleOutput(data, options, response.workerId)) {
          return;
        }
      }

      console.log();
      console.log(chalk.green('✓'), chalk.bold('Worker resumed successfully'));
      console.log();
      console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(response.workerId)}`);
      console.log(`  ${chalk.gray('Message:')}   ${response.message}`);

      if (pausedWorkers.length > 0) {
        console.log(`  ${chalk.gray('Note:')}      ${pausedWorkers.length} previously paused worker${pausedWorkers.length !== 1 ? 's' : ''} in history`);
      }

      if (response.usingWorktree) {
        console.log(`  ${chalk.gray('Isolation:')} ${chalk.blue('Git Worktree')}`);
      }

      console.log();
      console.log(chalk.gray(`Use 'rf show ${outcomeId}' to monitor progress`));
      console.log(chalk.gray(`Use 'rf flow pause ${outcomeId}' to pause the worker`));
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

        if (error.status === 400) {
          const body = error.body as WorkerConflictError;

          // Worker already running (shouldn't happen due to our check above, but handle it)
          if (body.workerId) {
            console.error(chalk.yellow('Note:'), 'A worker is already running for this outcome');
            console.error();
            console.error(`  ${chalk.gray('Running worker:')} ${chalk.cyan(body.workerId)}`);
            if (body.runningCount && body.runningCount > 1) {
              console.error(`  ${chalk.gray('Total running:')} ${body.runningCount}`);
            }
            console.error();
            process.exit(0); // Not really an error - worker is already running
          }

          // No pending tasks or other issues
          console.error(chalk.red('Error:'), body.error || error.message);
          console.error();
          console.error(chalk.gray('There may be no pending tasks for this outcome'));
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

export default flowResumeCommand;
