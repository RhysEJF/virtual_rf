/**
 * Chat Command
 *
 * Send iteration feedback or messages to an outcome.
 * Creates new tasks from the feedback.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

export const chatCommand = new Command('chat')
  .description('Send feedback or message to an outcome')
  .argument('<outcome-id>', 'Outcome ID (e.g., out_abc123)')
  .argument('<message>', 'The feedback message (use quotes for multi-word messages)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress output except errors')
  .option('--start', 'Automatically start a worker after creating tasks')
  .action(async (outcomeId: string, message: string, options: { json?: boolean; quiet?: boolean; start?: boolean }) => {
    try {
      // Get outcome info first for display purposes
      const { outcome } = await api.outcomes.get(outcomeId);

      // Submit feedback using the iterate API
      const result = await api.iterate.submit(outcomeId, message, {
        startWorker: options.start,
      });

      // Handle JSON output
      if (options.json) {
        console.log(JSON.stringify({
          success: result.success,
          outcome: {
            id: outcome.id,
            name: outcome.name,
          },
          tasksCreated: result.tasksCreated,
          taskIds: result.taskIds,
          workerId: result.workerId,
        }, null, 2));
        return;
      }

      // Handle quiet mode
      if (options.quiet) {
        return;
      }

      // Display success message
      console.log();
      console.log(chalk.green('✓'), `Sent message to ${chalk.cyan(outcome.name)}`);

      // List created tasks
      if (result.tasksCreated > 0) {
        console.log();
        console.log(chalk.white(`Created ${result.tasksCreated} task${result.tasksCreated !== 1 ? 's' : ''}:`));
        for (const taskId of result.taskIds) {
          console.log(chalk.gray(`  • ${taskId}`));
        }

        // Show hint about starting worker
        if (!options.start && !result.workerId) {
          console.log();
          console.log(chalk.gray(`Hint: Run \`flow start ${outcomeId}\` to begin work on these tasks`));
        }
      } else {
        console.log(chalk.gray('  No new tasks were created from this feedback.'));
      }

      // Show worker started info
      if (result.workerId) {
        console.log();
        console.log(chalk.green('✓'), `Worker started: ${chalk.cyan(result.workerId)}`);
      }

      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Could not connect to Digital Twin API' }));
        } else {
          console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
          console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        }
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message, status: error.status }));
        } else {
          if (error.status === 404) {
            console.error(chalk.red('Error:'), `Outcome not found: ${outcomeId}`);
          } else {
            console.error(chalk.red('API Error:'), error.message);
          }
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default chatCommand;
