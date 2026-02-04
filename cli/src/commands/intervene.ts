/**
 * Intervene Command
 *
 * Send instructions to a running worker.
 * Usage: flow intervene <worker-id> "<message>"
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

export const interveneCommand = new Command('intervene')
  .description('Send instructions to a running worker')
  .argument('<worker-id>', 'Worker ID to send intervention to')
  .argument('<message>', 'Message/instruction to send to the worker');

addOutputFlags(interveneCommand);

interveneCommand.action(async (workerId: string, message: string, options: OutputOptions) => {
  try {
    // Send the intervention
    await api.workers.intervene(workerId, message);

    // Handle JSON output
    if (options.json) {
      handleOutput({
        success: true,
        workerId,
        message,
      }, options);
      return;
    }

    // Handle quiet output
    if (options.quiet) {
      console.log('ok');
      return;
    }

    // Standard output
    console.log();
    console.log(chalk.green('✓'), `Intervention sent to worker ${chalk.cyan(workerId)}`);
    console.log(`  Message: ${chalk.white(`"${message}"`)}`);
    console.log();
    console.log(chalk.gray('  The worker will see this in its next iteration.'));
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
        console.error(chalk.gray('Use `flow workers` to see active workers'));
      } else {
        console.error(chalk.red('API Error:'), error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

export default interveneCommand;
