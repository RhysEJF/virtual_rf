/**
 * Confirm Command
 *
 * Approve a semi-auto HOMЯ escalation proposal.
 * The escalation ID can be provided directly (e.g., esc_abc123) and the
 * command will look up the associated outcome.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, HomrAggregateEscalation } from '../api.js';

/**
 * Find an escalation by ID across all outcomes
 */
async function findEscalation(escalationId: string): Promise<HomrAggregateEscalation | null> {
  try {
    const aggregate = await api.homr.aggregate();
    return aggregate.escalations.find(esc => esc.id === escalationId) || null;
  } catch {
    return null;
  }
}

export const confirmCommand = new Command('confirm')
  .description('Approve a semi-auto HOMЯ escalation proposal')
  .argument('<escalation-id>', 'Escalation ID (e.g., esc_abc123)')
  .action(async (escalationId: string) => {
    try {
      const escalation = await findEscalation(escalationId);

      if (!escalation) {
        console.error(chalk.red('Error:'), `Escalation not found: ${escalationId}`);
        console.error(chalk.gray('Use `flow escalations` to see pending escalations'));
        process.exit(1);
      }

      const result = await api.homr.confirmEscalation(escalation.outcomeId, escalationId);

      console.log();
      console.log(chalk.green('✓'), `Approved resolution for ${chalk.cyan(escalationId)}`);
      if (result.workerSpawned) {
        console.log(chalk.gray('  Worker spawned to continue work.'));
      } else {
        console.log(chalk.gray('  Tasks resumed with this decision.'));
      }
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Flow API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 400) {
          console.error(chalk.red('Error:'), 'Escalation is not pending confirmation');
          console.error(chalk.gray('Only semi-auto proposals can be confirmed. Use `flow answer` for manual escalations.'));
        } else if (error.status === 404) {
          console.error(chalk.red('Error:'), `Escalation not found: ${escalationId}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default confirmCommand;
