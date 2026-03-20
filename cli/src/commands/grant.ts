/**
 * Grant / Revoke Commands
 *
 * Manage which integrations a worker can use for a specific outcome.
 * Workers only get 'always' tier integrations by default.
 * 'grant' tier integrations must be explicitly granted per outcome.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { resolveOutcomeId } from '../utils/ids.js';

export const grantCommand = new Command('grant')
  .description('Grant integration access to an outcome\'s workers')
  .argument('<outcome-id>', 'Outcome ID')
  .argument('<integrations...>', 'Integration names to grant')
  .action(async (rawOutcomeId: string, integrations: string[]) => {
    const outcomeId = resolveOutcomeId(rawOutcomeId);
    try {
      // Get current grants
      const { outcome } = await api.outcomes.get(outcomeId);
      let current: string[] = [];
      try {
        current = JSON.parse(outcome.granted_integrations || '[]');
      } catch {
        current = [];
      }

      // Add new grants (deduplicate)
      const updated = Array.from(new Set([...current, ...integrations]));

      // Update outcome
      await api.outcomes.update(outcomeId, {
        granted_integrations: JSON.stringify(updated),
      });

      console.log();
      console.log(chalk.green('\u2713'), `Granted integrations to ${chalk.bold(outcome.name)}:`);
      for (const name of integrations) {
        const isNew = !current.includes(name);
        if (isNew) {
          console.log(`  ${chalk.green('+')} ${name}`);
        } else {
          console.log(`  ${chalk.gray('\u2713')} ${name} ${chalk.gray('(already granted)')}`);
        }
      }
      console.log();
      console.log(chalk.gray(`Total grants: ${updated.join(', ') || 'none'}`));
      console.log();
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Flow API');
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });

export const revokeCommand = new Command('revoke')
  .description('Revoke integration access from an outcome\'s workers')
  .argument('<outcome-id>', 'Outcome ID')
  .argument('<integrations...>', 'Integration names to revoke')
  .action(async (rawOutcomeId: string, integrations: string[]) => {
    const outcomeId = resolveOutcomeId(rawOutcomeId);
    try {
      const { outcome } = await api.outcomes.get(outcomeId);
      let current: string[] = [];
      try {
        current = JSON.parse(outcome.granted_integrations || '[]');
      } catch {
        current = [];
      }

      const updated = current.filter(name => !integrations.includes(name));

      await api.outcomes.update(outcomeId, {
        granted_integrations: JSON.stringify(updated),
      });

      console.log();
      console.log(chalk.yellow('\u2717'), `Revoked integrations from ${chalk.bold(outcome.name)}:`);
      for (const name of integrations) {
        const wasGranted = current.includes(name);
        if (wasGranted) {
          console.log(`  ${chalk.red('-')} ${name}`);
        } else {
          console.log(`  ${chalk.gray('-')} ${name} ${chalk.gray('(was not granted)')}`);
        }
      }
      console.log();
      console.log(chalk.gray(`Remaining grants: ${updated.join(', ') || 'none'}`));
      console.log();
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Flow API');
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });
