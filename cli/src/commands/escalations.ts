/**
 * Escalations Command
 *
 * Lists pending HOMЯ escalations across outcomes.
 * Can filter by outcome with --outcome flag.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, HomrEscalation, OutcomeWithCounts } from '../api.js';
import { addOutputFlags, OutputOptions } from '../utils/flags.js';

interface EscalationsOptions extends OutputOptions {
  outcome?: string;
}

interface EscalationWithOutcome extends HomrEscalation {
  outcomeName: string;
}

/**
 * Fetch escalations for a single outcome
 */
async function fetchOutcomeEscalations(outcomeId: string, outcomeName: string): Promise<EscalationWithOutcome[]> {
  try {
    const response = await api.homr.escalations(outcomeId, { pending: true });
    return response.escalations.map(esc => ({
      ...esc,
      outcomeName,
    }));
  } catch (error) {
    // If outcome has no HOMЯ data yet, return empty array
    if (error instanceof ApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Fetch all pending escalations across all active outcomes
 */
async function fetchAllEscalations(): Promise<EscalationWithOutcome[]> {
  // Get all active outcomes
  const outcomesResponse = await api.outcomes.list({ counts: true, status: 'active' });
  const outcomes = outcomesResponse.outcomes as OutcomeWithCounts[];

  // Fetch escalations for each outcome in parallel
  const escalationPromises = outcomes.map(outcome =>
    fetchOutcomeEscalations(outcome.id, outcome.name)
  );

  const escalationArrays = await Promise.all(escalationPromises);

  // Flatten and return all escalations
  return escalationArrays.flat();
}

/**
 * Format escalation options as "A) label  B) label  C) label"
 */
function formatOptions(options: HomrEscalation['question']['options']): string {
  return options
    .map((opt, index) => {
      const letter = String.fromCharCode(65 + index); // A, B, C, ...
      return `${letter}) ${opt.label}`;
    })
    .join('  ');
}

const command = new Command('escalations')
  .description('List pending HOMЯ escalations')
  .option('--outcome <id>', 'Filter by outcome ID');

addOutputFlags(command);

export const escalationsCommand = command
  .action(async (options: EscalationsOptions) => {
    try {
      let escalations: EscalationWithOutcome[];

      if (options.outcome) {
        // Fetch escalations for specific outcome
        const outcomeResponse = await api.outcomes.get(options.outcome);
        escalations = await fetchOutcomeEscalations(
          options.outcome,
          outcomeResponse.outcome.name
        );
      } else {
        // Fetch all escalations across all outcomes
        escalations = await fetchAllEscalations();
      }

      // Filter to only pending escalations
      const pendingEscalations = escalations.filter(esc => esc.status === 'pending');

      // Handle JSON output
      if (options.json) {
        console.log(JSON.stringify(pendingEscalations, null, 2));
        return;
      }

      // Handle quiet output - IDs only
      if (options.quiet) {
        for (const esc of pendingEscalations) {
          console.log(esc.id);
        }
        return;
      }

      // Normal output
      console.log();
      console.log(chalk.bold.white(`Pending Escalations (${pendingEscalations.length})`));
      console.log();

      if (pendingEscalations.length === 0) {
        console.log(chalk.gray('No pending escalations'));
        console.log();
        return;
      }

      for (const esc of pendingEscalations) {
        console.log(`${chalk.cyan(`[${esc.id}]`)} Outcome: ${chalk.white(esc.outcomeName)}`);
        console.log(`  ${esc.question.text}`);
        if (esc.question.options.length > 0) {
          console.log(`  ${chalk.gray('Options:')} ${formatOptions(esc.question.options)}`);
        }
        console.log();
      }

      console.log(chalk.gray(`Use \`flow answer <id> "<choice>"\` to respond`));
      console.log();

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome not found: ${options.outcome}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default escalationsCommand;
