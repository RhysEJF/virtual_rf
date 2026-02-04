/**
 * Archive Command
 *
 * Archives a completed outcome via POST /api/outcomes/[id]/archive
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, OutcomeResponse } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

const command = new Command('archive')
  .description('Archive a completed outcome')
  .argument('<outcome-id>', 'The outcome ID to archive');

addOutputFlags(command);

export const archiveCommand = command
  .action(async (outcomeId: string, options: OutputOptions) => {
    try {
      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray(`Archiving outcome ${outcomeId}...`));
      }

      // Archive the outcome via POST
      const response = await api.post<OutcomeResponse>(`/outcomes/${outcomeId}/archive`);

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        if (handleOutput(response, options, response.outcome.id)) {
          return;
        }
      }

      console.log();
      console.log(chalk.green('✓'), chalk.bold('Outcome archived successfully'));
      console.log();
      console.log(`  ${chalk.gray('ID:')}     ${chalk.cyan(response.outcome.id)}`);
      console.log(`  ${chalk.gray('Name:')}   ${response.outcome.name}`);
      console.log(`  ${chalk.gray('Status:')} ${chalk.gray('archived')}`);
      console.log();
      console.log(chalk.gray(`Use 'flow list --all' to see archived outcomes`));
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

export default archiveCommand;
