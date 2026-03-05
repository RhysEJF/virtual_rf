/**
 * Refine Command
 *
 * Creates a refinement task and deploys a worker to enrich pending tasks
 * via POST /api/outcomes/[id]/refine
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

interface RefineResponse {
  success: boolean;
  taskId: string;
  workerId: string | null;
  message?: string;
  warning?: string;
}

const command = new Command('refine')
  .description('Refine pending tasks for an outcome (enrich intent, approach, complexity, dependencies)')
  .argument('<outcome-id>', 'The outcome ID to refine tasks for');

addOutputFlags(command);

export const refineCommand = command
  .action(async (outcomeId: string, options: OutputOptions) => {
    try {
      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray(`Refining tasks for outcome ${outcomeId}...`));
      }

      const response = await api.post<RefineResponse>(
        `/outcomes/${outcomeId}/refine`,
        {}
      );

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        if (handleOutput(response, options, response.taskId)) {
          return;
        }
      }

      console.log();
      console.log(chalk.green('✓'), chalk.bold('Refinement task created'));
      console.log();
      console.log(`  ${chalk.gray('Task ID:')}   ${chalk.cyan(response.taskId)}`);

      if (response.workerId) {
        console.log(`  ${chalk.gray('Worker ID:')} ${chalk.cyan(response.workerId)}`);
      }

      if (response.message) {
        console.log(`  ${chalk.gray('Message:')}   ${response.message}`);
      }

      if (response.warning) {
        console.log();
        console.log(chalk.yellow('Warning:'), response.warning);
      }

      console.log();
      console.log(chalk.gray(`Use 'flow show ${outcomeId}' to monitor progress`));
      console.log();
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error();
        console.error(chalk.red('Error:'), 'Could not connect to Flow API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }

      if (error instanceof ApiError) {
        console.error();

        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome '${outcomeId}' not found`);
          process.exit(1);
        }

        if (error.status === 400) {
          const body = error.body as { error: string; taskId?: string };
          console.error(chalk.red('Error:'), body.error || error.message);
          if (body.taskId) {
            console.error(`  ${chalk.gray('Existing task:')} ${chalk.cyan(body.taskId)}`);
          }
          process.exit(1);
        }

        console.error(chalk.red('API Error:'), error.message);
        process.exit(1);
      }

      throw error;
    }
  });

export default refineCommand;
