/**
 * Reject Command
 *
 * Reject a semi-auto HOMЯ escalation proposal, reverting it to pending
 * so the user can answer manually.
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

export const rejectCommand = new Command('reject')
  .description('Reject a semi-auto HOMЯ escalation proposal')
  .argument('<escalation-id>', 'Escalation ID (e.g., esc_abc123)')
  .action(async (escalationId: string) => {
    try {
      const escalation = await findEscalation(escalationId);

      if (!escalation) {
        console.error(chalk.red('Error:'), `Escalation not found: ${escalationId}`);
        console.error(chalk.gray('Use `flow escalations` to see pending escalations'));
        process.exit(1);
      }

      await api.homr.rejectEscalation(escalation.outcomeId, escalationId);

      console.log();
      console.log(chalk.yellow('✗'), `Rejected AI proposal for ${chalk.cyan(escalationId)}`);
      console.log(chalk.gray('  Escalation reverted to pending. Use `flow answer` to decide manually.'));
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 400) {
          console.error(chalk.red('Error:'), 'Escalation is not pending confirmation');
          console.error(chalk.gray('Only semi-auto proposals can be rejected.'));
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

export default rejectCommand;
