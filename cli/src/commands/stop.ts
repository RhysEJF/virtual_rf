/**
 * Stop Command
 *
 * Stops a running worker via DELETE /api/outcomes/[id]/workers?workerId=xxx
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Worker } from '../api.js';

// Response type for stopping a worker
interface StopWorkerResponse {
  success: boolean;
  message: string;
}

export const stopCommand = new Command('stop')
  .description('Stop a running worker')
  .argument('<worker-id>', 'The worker ID to stop')
  .action(async (workerId: string) => {
    try {
      console.log();
      console.log(chalk.gray(`Stopping worker ${workerId}...`));

      // First fetch the worker to verify it exists and get its outcome_id
      const { worker } = await api.workers.get(workerId);

      // Check if the worker is in a state that can be stopped
      if (worker.status === 'paused') {
        console.log();
        console.log(chalk.yellow('⚠'), `Worker is already paused`);
        console.log();
        console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(worker.id)}`);
        console.log(`  ${chalk.gray('Name:')}      ${worker.name}`);
        console.log(`  ${chalk.gray('Status:')}    ${chalk.yellow(worker.status)}`);
        console.log();
        return;
      }

      if (worker.status === 'completed') {
        console.log();
        console.log(chalk.yellow('⚠'), `Worker has already completed`);
        console.log();
        console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(worker.id)}`);
        console.log(`  ${chalk.gray('Name:')}      ${worker.name}`);
        console.log(`  ${chalk.gray('Status:')}    ${chalk.green(worker.status)}`);
        console.log();
        return;
      }

      if (worker.status === 'failed') {
        console.log();
        console.log(chalk.yellow('⚠'), `Worker has already failed`);
        console.log();
        console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(worker.id)}`);
        console.log(`  ${chalk.gray('Name:')}      ${worker.name}`);
        console.log(`  ${chalk.gray('Status:')}    ${chalk.red(worker.status)}`);
        console.log();
        return;
      }

      // Stop the worker using DELETE endpoint
      await api.delete<StopWorkerResponse>(
        `/outcomes/${worker.outcome_id}/workers?workerId=${workerId}`
      );

      console.log();
      console.log(chalk.green('✓'), chalk.bold('Worker stopped successfully'));
      console.log();
      console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(worker.id)}`);
      console.log(`  ${chalk.gray('Name:')}      ${worker.name}`);
      console.log(`  ${chalk.gray('Status:')}    ${formatStatus('paused')}`);
      console.log(`  ${chalk.gray('Iteration:')} ${worker.iteration}`);

      if (worker.current_task_id) {
        console.log(`  ${chalk.gray('Task:')}      ${chalk.cyan(worker.current_task_id)}`);
      }

      console.log();
      console.log(chalk.gray(`Use 'rf start ${worker.outcome_id}' to start a new worker`));
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
          console.error(chalk.red('Error:'), `Worker '${workerId}' not found`);
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
function formatStatus(status: Worker['status']): string {
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

export default stopCommand;
