/**
 * Health Command
 *
 * Displays system health metrics including database, workers, tasks,
 * recent failures, and event statistics.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

/**
 * Formats byte size to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const command = new Command('health')
  .description('Show system health metrics');

addOutputFlags(command);

export const healthCommand = command
  .action(async (options: OutputOptions) => {
    try {
      const health = await api.health.status();

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        if (handleOutput(health, options)) {
          return;
        }
      }

      // Header
      console.log();
      console.log(chalk.bold('System Health'));
      console.log(chalk.gray('─'.repeat(50)));

      // System section (DB)
      console.log();
      console.log(chalk.bold.cyan('System'));
      console.log(`  DB Size: ${chalk.white(formatBytes(health.database.size_bytes))}`);
      console.log(`  DB Path: ${chalk.gray(health.database.path)}`);

      // Workers section
      console.log();
      console.log(chalk.bold.cyan('Workers'));
      const ws = health.workers.by_status;
      console.log(`  Running:   ${chalk.cyan(String(ws.running ?? 0))}`);
      console.log(`  Paused:    ${chalk.yellow(String(ws.paused ?? 0))}`);
      console.log(`  Completed: ${chalk.green(String(ws.completed ?? 0))}`);
      console.log(`  Failed:    ${chalk.red(String(ws.failed ?? 0))}`);

      // Tasks section
      console.log();
      console.log(chalk.bold.cyan('Tasks'));
      const ts = health.tasks.by_status;
      console.log(`  Pending:   ${chalk.yellow(String(ts.pending ?? 0))}`);
      console.log(`  Running:   ${chalk.cyan(String(ts.running ?? 0))}`);
      console.log(`  Completed: ${chalk.green(String(ts.completed ?? 0))}`);
      console.log(`  Failed:    ${chalk.red(String(ts.failed ?? 0))}`);

      // Recent Failures section
      console.log();
      console.log(chalk.bold.cyan('Recent Failures'));
      if (health.recent_failures.count === 0) {
        console.log(`  ${chalk.green('✓')} No failures in the last 24h`);
      } else {
        console.log(`  Count (24h): ${chalk.red(health.recent_failures.count.toString())}`);
        const failures = health.recent_failures.last_24h.slice(0, 3);
        if (failures.length > 0) {
          console.log(`  Last failures:`);
          for (const failure of failures) {
            console.log(`    ${chalk.gray(failure.task_id)} ${chalk.red(failure.failure_reason)}`);
          }
        }
      }

      // Events section
      console.log();
      console.log(chalk.bold.cyan('Events'));
      console.log(`  Last hour: ${chalk.white(health.events.last_hour.toString())}`);

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

export default healthCommand;
