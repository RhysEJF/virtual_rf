/**
 * Update Command
 *
 * Modifies outcome properties via CLI.
 * Supports setting name, intent, approach with optional optimization via Claude.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Outcome } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

interface UpdateCommandOptions extends OutputOptions {
  name?: string;
  intent?: string;
  approach?: string;
  optimize?: boolean;
  optimizeIntent?: boolean;
  optimizeApproach?: boolean;
}

interface OutcomeResponse {
  outcome: Outcome;
}

interface OptimizeIntentResponse {
  success: boolean;
  intent: unknown;
}

interface OptimizeApproachResponse {
  success: boolean;
  approach: string;
  version: number;
  detectedCapabilities: unknown[];
}

const command = new Command('update')
  .description('Update outcome properties')
  .argument('<id>', 'Outcome ID to update')
  .option('--name <name>', 'Set outcome name')
  .option('--intent <text>', 'Set intent (raw text)')
  .option('--approach <text>', 'Set approach (raw text)')
  .option('--optimize', 'Optimize intent/approach via Claude (use with --intent or --approach)')
  .option('--optimize-intent', 'Re-optimize existing intent via Claude')
  .option('--optimize-approach', 'Re-optimize existing approach via Claude');

addOutputFlags(command);

export const updateCommand = command
  .action(async (id: string, options: UpdateCommandOptions) => {
    try {
      const hasBasicUpdate = options.name || (options.intent && !options.optimize) || (options.approach && !options.optimize);
      const hasOptimizeIntent = (options.intent && options.optimize) || options.optimizeIntent;
      const hasOptimizeApproach = (options.approach && options.optimize) || options.optimizeApproach;

      // Validate at least one option is provided
      if (!hasBasicUpdate && !hasOptimizeIntent && !hasOptimizeApproach) {
        console.error(chalk.red('Error:'), 'At least one option (--name, --intent, --approach, --optimize-intent, --optimize-approach) is required');
        process.exit(1);
      }

      // Track what we're doing
      let outcome: Outcome | null = null;
      const results: Record<string, unknown> = {};

      // Basic update (name, raw intent, raw approach)
      if (hasBasicUpdate) {
        if (!options.json && !options.quiet) {
          console.log(chalk.gray('Updating outcome...'));
        }

        const updatePayload: Record<string, string> = {};
        if (options.name) updatePayload.name = options.name;
        if (options.intent && !options.optimize) updatePayload.intent = options.intent;
        if (options.approach && !options.optimize) updatePayload.approach = options.approach;

        const response = await api.outcomes.update(id, updatePayload) as OutcomeResponse;
        outcome = response.outcome;
        results.updated = updatePayload;
      }

      // Optimize intent (new text or re-optimize existing)
      if (hasOptimizeIntent) {
        if (!options.json && !options.quiet) {
          console.log(chalk.gray('Optimizing intent via Claude...'));
        }

        let rambleText = options.intent;
        if (options.optimizeIntent && !rambleText) {
          // Re-optimize existing: fetch the current intent
          const current = await api.outcomes.get(id) as OutcomeResponse;
          outcome = current.outcome;
          rambleText = outcome.intent || '';
          if (!rambleText) {
            console.error(chalk.red('Error:'), 'No existing intent to re-optimize');
            process.exit(1);
          }
        }

        const optimizeResponse = await api.post<OptimizeIntentResponse>(
          `/outcomes/${id}/optimize-intent`,
          { ramble: rambleText }
        );

        if (!optimizeResponse.success) {
          console.error(chalk.red('Error:'), 'Failed to optimize intent');
          process.exit(1);
        }

        results.optimizedIntent = optimizeResponse.intent;
      }

      // Optimize approach (new text or re-optimize existing)
      if (hasOptimizeApproach) {
        if (!options.json && !options.quiet) {
          console.log(chalk.gray('Optimizing approach via Claude...'));
        }

        let rambleText = options.approach;
        if (options.optimizeApproach && !rambleText) {
          // Re-optimize existing: need to fetch current approach
          // The approach is stored in design_docs, but we can just pass empty and let Claude handle it
          // Actually, we need the existing approach text
          const current = await api.outcomes.get(id) as OutcomeResponse;
          outcome = current.outcome;
          // The approach is not directly on outcome - it's in design_docs
          // For re-optimize, we'll need to fetch the design doc
          // Let's fetch from a detail endpoint or use brief as fallback
          if (!outcome.brief) {
            console.error(chalk.red('Error:'), 'No existing approach/brief to re-optimize');
            process.exit(1);
          }
          rambleText = outcome.brief;
        }

        const optimizeResponse = await api.post<OptimizeApproachResponse>(
          `/outcomes/${id}/optimize-approach`,
          { ramble: rambleText }
        );

        if (!optimizeResponse.success) {
          console.error(chalk.red('Error:'), 'Failed to optimize approach');
          process.exit(1);
        }

        results.optimizedApproach = optimizeResponse.approach;
        results.approachVersion = optimizeResponse.version;
        if (optimizeResponse.detectedCapabilities && optimizeResponse.detectedCapabilities.length > 0) {
          results.detectedCapabilities = optimizeResponse.detectedCapabilities;
        }
      }

      // Fetch final outcome state if we don't have it yet
      if (!outcome) {
        const response = await api.outcomes.get(id) as OutcomeResponse;
        outcome = response.outcome;
      }

      // Handle output
      if (options.json || options.quiet) {
        const outputData = {
          outcome,
          ...results,
        };
        if (handleOutput(outputData, options, outcome.id)) {
          return;
        }
      }

      // Human-readable output
      console.log();
      console.log(chalk.green('✓') + ' Outcome updated successfully!');
      console.log();
      console.log(`  ${chalk.bold('ID:')} ${chalk.cyan(outcome.id)}`);
      console.log(`  ${chalk.bold('Name:')} ${outcome.name}`);

      if (results.updated) {
        console.log();
        console.log(chalk.bold.cyan('Updated fields:'));
        const updated = results.updated as Record<string, string>;
        for (const [key, value] of Object.entries(updated)) {
          const displayValue = typeof value === 'string' && value.length > 50
            ? value.substring(0, 50) + '...'
            : value;
          console.log(`  ${key}: ${chalk.white(displayValue)}`);
        }
      }

      if (results.optimizedIntent) {
        console.log();
        console.log(chalk.bold.cyan('Intent optimized to PRD'));
        const intent = results.optimizedIntent as { summary?: string; items?: unknown[] };
        if (intent.summary) {
          console.log(`  ${chalk.gray('Summary:')} ${intent.summary}`);
        }
        if (intent.items && Array.isArray(intent.items)) {
          console.log(`  ${chalk.gray('Items:')} ${intent.items.length} requirements`);
        }
      }

      if (results.optimizedApproach) {
        console.log();
        console.log(chalk.bold.cyan(`Approach optimized (v${results.approachVersion})`));
        const approach = results.optimizedApproach as string;
        const preview = approach.split('\n').slice(0, 3).join('\n');
        console.log(chalk.gray(preview.substring(0, 150) + (approach.length > 150 ? '...' : '')));
      }

      if (results.detectedCapabilities) {
        const caps = results.detectedCapabilities as unknown[];
        console.log();
        console.log(chalk.yellow('!') + ` Detected ${caps.length} new capability needs`);
        console.log(chalk.gray('  Run `flow show ' + id + '` to see details'));
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
          console.error(chalk.red('Error:'), `Outcome not found: ${id}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
          if (error.body && typeof error.body === 'object' && 'error' in error.body) {
            console.error(chalk.gray((error.body as { error: string }).error));
          }
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default updateCommand;
