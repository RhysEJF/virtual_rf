/**
 * Start Command
 *
 * Starts a worker for an outcome via POST /api/outcomes/[id]/workers
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

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

export const startCommand = new Command('start')
  .description('Start a worker for an outcome')
  .argument('<outcome-id>', 'The outcome ID to start a worker for')
  .option('-p, --parallel', 'Allow starting even if another worker is running', false)
  .option('-w, --worktree', 'Use git worktree for worker isolation', false)
  .action(async (outcomeId: string, options: { parallel: boolean; worktree: boolean }) => {
    try {
      console.log();
      console.log(chalk.gray(`Starting worker for outcome ${outcomeId}...`));

      const response = await api.post<StartWorkerResponse>(
        `/outcomes/${outcomeId}/workers`,
        {
          parallel: options.parallel,
          useWorktree: options.worktree,
        }
      );

      console.log();
      console.log(chalk.green('✓'), chalk.bold('Worker started successfully'));
      console.log();
      console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(response.workerId)}`);
      console.log(`  ${chalk.gray('Message:')}   ${response.message}`);

      if (response.parallel) {
        console.log(`  ${chalk.gray('Mode:')}      ${chalk.yellow('Parallel')}`);
      }

      if (response.usingWorktree) {
        console.log(`  ${chalk.gray('Isolation:')} ${chalk.blue('Git Worktree')}`);
      }

      console.log();
      console.log(chalk.gray(`Use 'rf show ${outcomeId}' to monitor progress`));
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

          // Worker already running
          if (body.workerId) {
            console.error(chalk.yellow('Warning:'), 'A worker is already running for this outcome');
            console.error();
            console.error(`  ${chalk.gray('Running worker:')} ${chalk.cyan(body.workerId)}`);
            if (body.runningCount && body.runningCount > 1) {
              console.error(`  ${chalk.gray('Total running:')} ${body.runningCount}`);
            }
            console.error();
            console.error(chalk.gray(`Use --parallel flag to start another worker`));
            process.exit(1);
          }

          // No pending tasks or parent outcome
          console.error(chalk.red('Error:'), body.error || error.message);
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

export default startCommand;
