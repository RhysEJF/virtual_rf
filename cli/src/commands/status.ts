/**
 * Status Command
 *
 * Shows system overview including supervisor status, alerts, and outcome statistics.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, OutcomeWithCounts } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';
import { progressBar } from '../utils/progress.js';
import { createSpinner } from '../utils/spinner.js';

/**
 * Renders the branded Flow header using box-drawing characters.
 */
function printBrandedHeader(): void {
  const dim = (s: string): string => chalk.dim(s);
  console.log();
  console.log(`  ${dim('\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e')}`);
  console.log(`  ${dim('\u2502')}   ${chalk.bold.white('\u2726  F L O W')}            ${dim('\u2502')}`);
  console.log(`  ${dim('\u2502')}   ${chalk.dim('AI Workforce Manager')}  ${dim('\u2502')}`);
  console.log(`  ${dim('\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f')}`);
}

const command = new Command('status')
  .description('Show system status overview');

addOutputFlags(command);

export const statusCommand = command
  .action(async (options: OutputOptions) => {
    try {
      const spinner = createSpinner('Loading system status...');

      // Fetch supervisor status and outcomes in parallel
      const [supervisorStatus, outcomesResponse] = await Promise.all([
        api.supervisor.status(),
        api.outcomes.list({ counts: true }),
      ]);

      spinner.stop();

      const outcomes = outcomesResponse.outcomes as OutcomeWithCounts[];

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        const data = {
          supervisor: supervisorStatus,
          outcomes,
          summary: {
            totalOutcomes: outcomes.length,
            activeOutcomes: outcomes.filter(o => o.status === 'active').length,
            totalTasks: outcomes.reduce((sum, o) => sum + o.total_tasks, 0),
            completedTasks: outcomes.reduce((sum, o) => sum + o.completed_tasks, 0),
            pendingTasks: outcomes.reduce((sum, o) => sum + o.pending_tasks, 0),
            activeWorkers: outcomes.reduce((sum, o) => sum + o.active_workers, 0),
          },
        };
        if (handleOutput(data, options)) {
          return;
        }
      }

      // Branded Header
      printBrandedHeader();
      console.log();

      // Supervisor Section
      console.log(chalk.bold.cyan('Supervisor'));
      const supervisorIndicator = supervisorStatus.running
        ? chalk.green('\u25cf Running')
        : chalk.gray('\u25cb Stopped');
      console.log(`  Status: ${supervisorIndicator}`);
      console.log(`  Check Interval: ${chalk.white(supervisorStatus.checkIntervalMs / 1000 + 's')}`);
      console.log();

      // Alerts Section
      console.log(chalk.bold.cyan('Alerts'));
      const { alerts } = supervisorStatus;
      if (alerts.active === 0) {
        console.log(`  ${chalk.green('\u2713')} No active alerts`);
      } else {
        console.log(`  Active: ${chalk.yellow(alerts.active.toString())}`);

        // Show by severity
        if (alerts.bySeverity) {
          const severities = Object.entries(alerts.bySeverity);
          for (const [severity, count] of severities) {
            if (count > 0) {
              const severityColor = severity === 'critical' ? chalk.red
                : severity === 'high' ? chalk.red
                : severity === 'medium' ? chalk.yellow
                : chalk.gray;
              console.log(`    ${severityColor(severity)}: ${count}`);
            }
          }
        }

        // Show by type
        if (alerts.byType) {
          const types = Object.entries(alerts.byType);
          for (const [type, count] of types) {
            if (count > 0) {
              console.log(`    ${chalk.gray(type)}: ${count}`);
            }
          }
        }
      }
      console.log();

      // Outcomes Section
      console.log(chalk.bold.cyan('Outcomes'));

      if (outcomes.length === 0) {
        console.log(`  ${chalk.gray('No outcomes')}`);
      } else {
        // Calculate totals
        const totalOutcomes = outcomes.length;
        const activeOutcomes = outcomes.filter(o => o.status === 'active').length;
        const totalTasks = outcomes.reduce((sum, o) => sum + o.total_tasks, 0);
        const completedTasks = outcomes.reduce((sum, o) => sum + o.completed_tasks, 0);
        const pendingTasks = outcomes.reduce((sum, o) => sum + o.pending_tasks, 0);
        const activeWorkers = outcomes.reduce((sum, o) => sum + o.active_workers, 0);
        const convergingOutcomes = outcomes.filter(o => o.is_converging).length;

        console.log(`  Total: ${chalk.white(totalOutcomes.toString())} (${chalk.green(activeOutcomes.toString())} active)`);
        console.log(`  Tasks: ${progressBar(completedTasks, totalTasks)}`);
        console.log(`         ${chalk.yellow(pendingTasks.toString())} pending`);
        console.log(`  Workers: ${chalk.white(activeWorkers.toString())} active`);

        if (convergingOutcomes > 0) {
          console.log(`  Converging: ${chalk.green(convergingOutcomes.toString())}`);
        }

        // List active outcomes
        const activeList = outcomes.filter(o => o.status === 'active');
        if (activeList.length > 0) {
          console.log();
          console.log(chalk.bold.cyan('Active Outcomes'));
          for (const outcome of activeList) {
            const workerIndicator = outcome.active_workers > 0
              ? chalk.green(`\u2699 ${outcome.active_workers}`)
              : chalk.gray('\u25cb');
            const converging = outcome.is_converging ? chalk.green(' \u27f3') : '';
            const taskBar = outcome.total_tasks > 0
              ? progressBar(outcome.completed_tasks, outcome.total_tasks)
              : chalk.gray('no tasks');

            console.log(`  ${workerIndicator} ${chalk.white(outcome.name)}${converging}`);
            console.log(`    ${taskBar}`);
          }
        }
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

export default statusCommand;
