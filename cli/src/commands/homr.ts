/**
 * HOMR Command
 *
 * Displays HOMЯ status for an outcome including:
 * - Discoveries (patterns, constraints, insights, blockers)
 * - Decisions made
 * - Pending escalations count
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, OutputOptions } from '../utils/flags.js';

/**
 * Formats a timestamp to relative time (e.g., "2h ago", "3d ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Formats discovery type with color
 */
function formatDiscoveryType(type: string): string {
  switch (type) {
    case 'pattern':
      return chalk.blue('[PATTERN]');
    case 'constraint':
      return chalk.yellow('[CONSTRAINT]');
    case 'insight':
      return chalk.cyan('[INSIGHT]');
    case 'blocker':
      return chalk.red('[BLOCKER]');
    default:
      return chalk.gray(`[${type.toUpperCase()}]`);
  }
}

interface HomrOptions extends OutputOptions {}

const command = new Command('homr')
  .description('Show HOMЯ status for an outcome')
  .argument('<outcome-id>', 'Outcome ID to show HOMЯ status for');

addOutputFlags(command);

export const homrCommand = command
  .action(async (outcomeId: string, options: HomrOptions) => {
    try {
      // Fetch HOMЯ context for the outcome
      const context = await api.homr.context(outcomeId);

      // Also fetch escalations to get pending count
      const escalationsData = await api.homr.escalations(outcomeId, { pending: true });

      // Handle JSON output
      if (options.json) {
        const data = {
          ...context,
          pendingEscalations: escalationsData.pendingCount,
        };
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Handle quiet output - summary only
      if (options.quiet) {
        const discoveryCount = context.discoveries.length;
        const decisionCount = context.decisions.length;
        const pendingCount = escalationsData.pendingCount;
        console.log(`${outcomeId}: ${discoveryCount} discoveries, ${decisionCount} decisions, ${pendingCount} pending escalations`);
        return;
      }

      // Normal output
      console.log();
      console.log(chalk.bold.white(`HOMЯ Status: ${outcomeId}`));
      console.log();

      // Discoveries section
      const discoveries = context.discoveries;
      console.log(chalk.bold.cyan(`Discoveries (${discoveries.length}):`));
      if (discoveries.length === 0) {
        console.log(chalk.gray('  No discoveries yet'));
      } else {
        for (const discovery of discoveries) {
          const typeLabel = formatDiscoveryType(discovery.type);
          console.log(`  ${chalk.gray('•')} ${typeLabel} ${chalk.white(discovery.content)}`);
        }
      }
      console.log();

      // Decisions section
      const decisions = context.decisions;
      console.log(chalk.bold.cyan(`Decisions (${decisions.length}):`));
      if (decisions.length === 0) {
        console.log(chalk.gray('  No decisions made yet'));
      } else {
        for (const decision of decisions) {
          const timeAgo = formatRelativeTime(decision.decidedAt);
          console.log(`  ${chalk.gray('•')} ${chalk.white(decision.answer)} ${chalk.gray(`(answered ${timeAgo})`)}`);
        }
      }
      console.log();

      // Pending escalations
      const pendingCount = escalationsData.pendingCount;
      console.log(chalk.bold.cyan(`Pending Escalations: ${pendingCount}`));
      if (pendingCount > 0) {
        console.log(chalk.gray(`  Run \`flow escalations --outcome=${outcomeId}\` to view`));
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

export default homrCommand;
