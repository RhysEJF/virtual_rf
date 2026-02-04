/**
 * Answer Command
 *
 * Answer a HOMЯ escalation with a choice.
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

export const answerCommand = new Command('answer')
  .description('Answer a HOMЯ escalation')
  .argument('<escalation-id>', 'Escalation ID (e.g., esc_abc123)')
  .argument('<choice>', 'The answer/choice to provide')
  .option('--context <text>', 'Additional context for the answer')
  .action(async (escalationId: string, choice: string, options: { context?: string }) => {
    try {
      // Find the escalation to get its outcome ID
      const escalation = await findEscalation(escalationId);

      if (!escalation) {
        console.error(chalk.red('Error:'), `Escalation not found: ${escalationId}`);
        console.error(chalk.gray('Use `flow escalations` to see pending escalations'));
        process.exit(1);
      }

      // Answer the escalation
      await api.homr.answerEscalation(escalation.outcomeId, escalationId, {
        selectedOption: choice,
        additionalContext: options.context,
      });

      console.log();
      console.log(chalk.green('✓'), `Answered escalation ${chalk.cyan(escalationId)}: "${choice}"`);
      console.log(chalk.gray('  Work will continue with this decision.'));
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Escalation not found: ${escalationId}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default answerCommand;
