/**
 * List Command
 *
 * Lists outcomes with optional status filter, displayed as a formatted table.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, OutcomeStatus, OutcomeWithCounts } from '../api.js';

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
 * Formats status with color
 */
function formatStatus(status: OutcomeStatus): string {
  switch (status) {
    case 'active':
      return chalk.green(padEnd(status, 10));
    case 'dormant':
      return chalk.gray(padEnd(status, 10));
    case 'achieved':
      return chalk.cyan(padEnd(status, 10));
    case 'archived':
      return chalk.gray(padEnd(status, 10));
    default:
      return padEnd(status, 10);
  }
}

/**
 * Formats task counts as "completed/total (pending)"
 */
function formatTaskCounts(outcome: OutcomeWithCounts): string {
  const { completed_tasks, total_tasks, pending_tasks } = outcome;

  if (total_tasks === 0) {
    return chalk.gray('no tasks');
  }

  const completed = chalk.green(completed_tasks.toString());
  const total = chalk.white(total_tasks.toString());
  const pending = pending_tasks > 0 ? chalk.yellow(` (${pending_tasks} pending)`) : '';

  return `${completed}/${total}${pending}`;
}

export const listCommand = new Command('list')
  .description('List outcomes with optional status filter')
  .option('-s, --status <status>', 'Filter by status (active, dormant, achieved, archived)')
  .option('--all', 'Show all outcomes including archived', false)
  .action(async (options) => {
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

      // Fetch outcomes
      const response = await api.outcomes.list(params);
      const outcomes = response.outcomes as OutcomeWithCounts[];

      // Filter out archived by default unless --all or --status=archived
      const filteredOutcomes = options.all || options.status === 'archived'
        ? outcomes
        : outcomes.filter(o => o.status !== 'archived');

      if (filteredOutcomes.length === 0) {
        console.log();
        if (options.status) {
          console.log(chalk.gray(`No outcomes with status "${options.status}"`));
        } else {
          console.log(chalk.gray('No outcomes found'));
        }
        console.log();
        return;
      }

      // Table configuration
      const idWidth = 16;
      const nameWidth = 32;
      const statusWidth = 10;

      // Print header
      console.log();
      console.log(
        chalk.bold.gray(padEnd('ID', idWidth)) +
        chalk.bold.gray(padEnd('NAME', nameWidth)) +
        chalk.bold.gray(padEnd('STATUS', statusWidth)) +
        chalk.bold.gray('TASKS')
      );
      console.log(chalk.gray('─'.repeat(80)));

      // Print rows
      for (const outcome of filteredOutcomes) {
        const id = padEnd(outcome.id, idWidth);
        const name = padEnd(outcome.name, nameWidth);
        const status = formatStatus(outcome.status);
        const tasks = formatTaskCounts(outcome);

        // Add worker indicator if workers are active
        const workerIndicator = outcome.active_workers > 0
          ? chalk.green(` ⚙ ${outcome.active_workers}`)
          : '';

        console.log(`${chalk.gray(id)}${chalk.white(name)}${status}${tasks}${workerIndicator}`);
      }

      console.log();

      // Print summary
      const activeCount = filteredOutcomes.filter(o => o.status === 'active').length;
      const totalWorkers = filteredOutcomes.reduce((sum, o) => sum + o.active_workers, 0);

      console.log(chalk.gray(`${filteredOutcomes.length} outcome${filteredOutcomes.length !== 1 ? 's' : ''}`));
      if (activeCount > 0) {
        console.log(chalk.gray(`${activeCount} active, ${totalWorkers} worker${totalWorkers !== 1 ? 's' : ''} running`));
      }
      console.log();

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

export default listCommand;
