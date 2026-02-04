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
 * Formats task status with color
 */
function formatTaskStatus(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return chalk.yellow(padEnd(status, 12));
    case 'claimed':
      return chalk.blue(padEnd(status, 12));
    case 'running':
      return chalk.cyan(padEnd(status, 12));
    case 'completed':
      return chalk.green(padEnd(status, 12));
    case 'failed':
      return chalk.red(padEnd(status, 12));
    default:
      return padEnd(status, 12);
  }
}

interface TasksOptions extends OutputOptions {
  status?: TaskStatus;
}

const command = new Command('tasks')
  .description('List tasks for an outcome')
  .argument('<outcome-id>', 'Outcome ID to list tasks for')
  .option('--status <status>', 'Filter by status (pending, claimed, running, completed, failed)');

addOutputFlags(command);

export const tasksCommand = command
  .action(async (outcomeId: string, options: TasksOptions) => {
    try {
      // Fetch tasks for the outcome
      const response = await api.outcomes.tasks(outcomeId);
      let tasks = response.tasks;

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
          console.log(chalk.gray(`No tasks with status "${options.status}" for outcome ${outcomeId}`));
        } else {
          console.log(chalk.gray(`No tasks found for outcome ${outcomeId}`));
        }
        console.log();
        return;
      }

      // Table configuration
      const idWidth = 18;
      const titleWidth = 34;
      const statusWidth = 12;
      const priorityWidth = 10;

      // Print header
      console.log();
      console.log(
        chalk.bold.gray(padEnd('ID', idWidth)) +
        chalk.bold.gray(padEnd('TITLE', titleWidth)) +
        chalk.bold.gray(padEnd('STATUS', statusWidth)) +
        chalk.bold.gray('PRIORITY')
      );
      console.log(chalk.gray('─'.repeat(idWidth + titleWidth + statusWidth + priorityWidth)));

      // Print rows
      for (const task of tasks) {
        const id = padEnd(task.id, idWidth);
        const title = padEnd(task.title, titleWidth);
        const status = formatTaskStatus(task.status);
        const priority = task.priority.toString();

        console.log(`${chalk.gray(id)}${chalk.white(title)}${status}${chalk.white(priority)}`);
      }

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

      console.log(chalk.gray(`${tasks.length} task${tasks.length !== 1 ? 's' : ''}`));
      if (summaryParts.length > 0) {
        console.log(summaryParts.join(', '));
      }
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
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
