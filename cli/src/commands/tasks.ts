/**
 * Tasks Command
 *
 * Lists all tasks for a specific outcome with optional status filtering.
 * Usage: flow tasks <outcome-id> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, TaskStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';
import { taskStatusLabel } from '../utils/status.js';
import { drawTable } from '../utils/table.js';
import { createSpinner } from '../utils/spinner.js';
import { resolveOutcomeId } from '../utils/ids.js';

interface TasksOptions extends OutputOptions {
  status?: TaskStatus;
}

const command = new Command('tasks')
  .description('List tasks for an outcome')
  .argument('<outcome-id>', 'Outcome ID to list tasks for')
  .option('--status <status>', 'Filter by status (pending, claimed, running, completed, failed)');

addOutputFlags(command);

command.addHelpText('after', `
Examples:
  $ flow tasks out_abc123                List all tasks
  $ flow tasks abc123                    Also works (out_ prefix is optional)
  $ flow tasks out_abc123 --status pending   Only show pending tasks
`);

export const tasksCommand = command
  .action(async (rawOutcomeId: string, options: TasksOptions) => {
    const outcomeId = resolveOutcomeId(rawOutcomeId);
    try {
      const spinner = createSpinner('Loading tasks...');

      // Fetch tasks for the outcome
      const response = await api.outcomes.tasks(outcomeId);
      let tasks = response.tasks;

      spinner.stop();

      // Apply status filter if provided
      if (options.status) {
        const validStatuses: TaskStatus[] = ['pending', 'claimed', 'running', 'completed', 'failed'];
        if (!validStatuses.includes(options.status)) {
          console.error(chalk.red('Error:'), `Invalid status "${options.status}"`);
          console.error(chalk.gray(`Valid statuses: ${validStatuses.join(', ')}`));
          process.exit(1);
        }
        tasks = tasks.filter(t => t.status === options.status);
      }

      // Handle JSON output
      if (options.json) {
        handleOutput(tasks, options);
        return;
      }

      // Handle quiet output (IDs only)
      if (options.quiet) {
        for (const task of tasks) {
          console.log(task.id);
        }
        return;
      }

      // No tasks found
      if (tasks.length === 0) {
        console.log();
        if (options.status) {
          console.log(chalk.gray(`  No tasks with status "${options.status}" for outcome ${outcomeId}`));
        } else {
          console.log(chalk.white('  No tasks for this outcome.'));
          console.log(chalk.gray(`  Tasks are generated from the intent, or add one: flow task add ${outcomeId} "task title"`));
        }
        console.log();
        return;
      }

      // Build table data
      const headers = ['ID', 'TITLE', 'STATUS', 'PRIORITY'];

      /**
       * Truncates a string to fit within a width.
       */
      function truncate(str: string, length: number): string {
        if (str.length >= length) {
          return str.substring(0, length - 1) + '\u2026';
        }
        return str;
      }

      const rows: string[][] = tasks.map(task => {
        const id = chalk.gray(task.id);
        const title = chalk.white(truncate(task.title, 32));
        const status = taskStatusLabel(task.status);
        const priority = chalk.white(task.priority.toString());
        return [id, title, status, priority];
      });

      console.log();
      drawTable(headers, rows, { columnWidths: [22, 30, 16, 10] });
      console.log();

      // Print summary
      const pendingCount = tasks.filter(t => t.status === 'pending').length;
      const runningCount = tasks.filter(t => t.status === 'running' || t.status === 'claimed').length;
      const completedCount = tasks.filter(t => t.status === 'completed').length;
      const failedCount = tasks.filter(t => t.status === 'failed').length;

      const summaryParts: string[] = [];
      if (pendingCount > 0) summaryParts.push(chalk.yellow(`${pendingCount} pending`));
      if (runningCount > 0) summaryParts.push(chalk.cyan(`${runningCount} running`));
      if (completedCount > 0) summaryParts.push(chalk.green(`${completedCount} completed`));
      if (failedCount > 0) summaryParts.push(chalk.red(`${failedCount} failed`));

      console.log(chalk.gray(`  ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`));
      if (summaryParts.length > 0) {
        console.log(`  ${summaryParts.join(', ')}`);
      }
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Flow API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome not found: ${outcomeId}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default tasksCommand;
