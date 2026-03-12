/**
 * List Command
 *
 * Lists outcomes with optional status filter, displayed as a formatted table.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, OutcomeStatus, OutcomeWithCounts } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';
import { outcomeStatusLabel } from '../utils/status.js';
import { progressBar } from '../utils/progress.js';
import { drawTable } from '../utils/table.js';
import { createSpinner } from '../utils/spinner.js';

/**
 * Truncates a string to fit within a width.
 */
function truncate(str: string, length: number): string {
  if (str.length >= length) {
    return str.substring(0, length - 1) + '\u2026';
  }
  return str;
}

interface ListOptions extends OutputOptions {
  status?: OutcomeStatus;
  all?: boolean;
}

const command = new Command('list')
  .description('List outcomes with optional status filter')
  .option('-s, --status <status>', 'Filter by status (active, dormant, achieved, archived)')
  .option('--all', 'Show all outcomes including archived', false);

addOutputFlags(command);

export const listCommand = command
  .action(async (options: ListOptions) => {
    try {
      // Build API params
      const params: {
        counts: boolean;
        status?: OutcomeStatus;
      } = {
        counts: true,
      };

      // Apply status filter if provided
      if (options.status) {
        const validStatuses: OutcomeStatus[] = ['active', 'dormant', 'achieved', 'archived'];
        if (!validStatuses.includes(options.status)) {
          console.error(chalk.red('Error:'), `Invalid status "${options.status}"`);
          console.error(chalk.gray(`Valid statuses: ${validStatuses.join(', ')}`));
          process.exit(1);
        }
        params.status = options.status as OutcomeStatus;
      }

      const spinner = createSpinner('Loading outcomes...');

      // Fetch outcomes
      const response = await api.outcomes.list(params);
      const outcomes = response.outcomes as OutcomeWithCounts[];

      spinner.stop();

      // Filter out archived by default unless --all or --status=archived
      const filteredOutcomes = options.all || options.status === 'archived'
        ? outcomes
        : outcomes.filter(o => o.status !== 'archived');

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        if (options.quiet) {
          // Output just IDs, one per line
          for (const outcome of filteredOutcomes) {
            console.log(outcome.id);
          }
        } else {
          handleOutput(filteredOutcomes, options);
        }
        return;
      }

      if (filteredOutcomes.length === 0) {
        console.log();
        if (options.status) {
          console.log(chalk.gray(`  No outcomes with status "${options.status}"`));
        } else {
          console.log(chalk.white('  No outcomes yet.'));
          console.log(chalk.gray('  Create one with: flow new "your goal here"'));
        }
        console.log();
        return;
      }

      // Build table data
      const headers = ['NAME', 'STATUS', 'TASKS', 'WORKERS'];
      const rows: string[][] = filteredOutcomes.map(outcome => {
        const name = truncate(outcome.name, 28);
        const status = outcomeStatusLabel(outcome.status);
        const tasks = outcome.total_tasks > 0
          ? progressBar(outcome.completed_tasks, outcome.total_tasks)
          : chalk.gray('no tasks');
        const workers = outcome.active_workers > 0
          ? chalk.green(`\u2699 ${outcome.active_workers}`)
          : chalk.gray('-');
        return [name, status, tasks, workers];
      });

      console.log();
      drawTable(headers, rows, { columnWidths: [30, 16, 30, 10] });
      console.log();

      // Print summary
      const activeCount = filteredOutcomes.filter(o => o.status === 'active').length;
      const totalWorkers = filteredOutcomes.reduce((sum, o) => sum + o.active_workers, 0);

      console.log(chalk.gray(`  ${filteredOutcomes.length} outcome${filteredOutcomes.length !== 1 ? 's' : ''}`));
      if (activeCount > 0) {
        console.log(chalk.gray(`  ${activeCount} active, ${totalWorkers} worker${totalWorkers !== 1 ? 's' : ''} running`));
      }
      console.log();

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

export default listCommand;
