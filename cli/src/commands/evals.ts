/**
 * Evals Command
 *
 * Browse and manage eval recipes.
 *
 * Usage:
 *   flow evals                       List all global evals
 *   flow evals --outcome <id>       Outcome-specific evals
 *   flow eval <name>                View eval content
 *   flow eval new <name>            Create eval template
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

interface EvalsListOptions {
  outcome?: string;
  json?: boolean;
  quiet?: boolean;
}

interface EvalShowOptions {
  json?: boolean;
}

interface EvalMetadata {
  id: string;
  name: string;
  source: string;
  outcomeId?: string;
  path: string;
  description: string;
  mode: string;
  direction: string;
  content?: string;
}

// flow evals — list evals
const evalsCmd = new Command('evals')
  .description('List eval recipes')
  .option('-o, --outcome <id>', 'List evals for a specific outcome')
  .option('--json', 'Output as JSON')
  .option('-q, --quiet', 'Minimal output')
  .action(async (options: EvalsListOptions) => {
    try {
      let evals: EvalMetadata[];

      if (options.outcome) {
        const response = await api.get<{ evals: EvalMetadata[] }>(`/evals/outcome?outcomeId=${options.outcome}`);
        evals = response.evals;
      } else {
        const response = await api.get<{ evals: EvalMetadata[] }>('/evals');
        evals = response.evals;
      }

      if (options.json) {
        console.log(JSON.stringify(evals, null, 2));
        return;
      }

      if (evals.length === 0) {
        if (!options.quiet) {
          console.log(chalk.gray('No evals found.'));
          console.log(chalk.gray('Create one with: flow eval new <name>'));
        }
        return;
      }

      if (options.quiet) {
        for (const e of evals) {
          console.log(e.id);
        }
        return;
      }

      console.log();
      console.log(chalk.bold(`Evals (${evals.length})`));
      console.log();

      for (const e of evals) {
        const sourceTag = e.source === 'app' ? chalk.blue('[app]') :
                          e.source === 'user' ? chalk.green('[user]') :
                          chalk.yellow(`[${e.outcomeId || 'outcome'}]`);
        const modeTag = e.mode === 'judge' ? chalk.magenta('judge') : chalk.cyan('cmd');
        const dirTag = e.direction === 'higher' ? chalk.green('↑') : chalk.red('↓');

        console.log(`  ${sourceTag} ${chalk.bold(e.name)} ${modeTag} ${dirTag}`);
        if (e.description) {
          console.log(`    ${chalk.gray(e.description)}`);
        }
      }
      console.log();
    } catch (err) {
      if (err instanceof ApiError) {
        console.error(chalk.red('Error:'), (err.body as { error?: string })?.error || err.statusText);
      } else if (err instanceof NetworkError) {
        console.error(chalk.red('Network error:'), err.message);
        console.error(chalk.gray('Is the Flow server running? (npm run dev)'));
      } else {
        throw err;
      }
      process.exit(1);
    }
  });

// flow eval <name> — view eval content
const evalCmd = new Command('eval')
  .description('View or create eval recipes');

evalCmd
  .argument('[name]', 'Eval name to view')
  .option('--json', 'Output as JSON')
  .action(async (name: string | undefined, options: EvalShowOptions) => {
    if (!name) {
      // No name = list evals (same as flow evals)
      evalsCmd.parse(['node', 'flow', ...process.argv.slice(3)]);
      return;
    }

    try {
      const response = await api.get<{ evals: EvalMetadata[] }>(`/evals?search=${encodeURIComponent(name)}`);
      const match = response.evals.find(
        e => e.id === name || e.name.toLowerCase() === name.toLowerCase()
      );

      if (!match) {
        console.error(chalk.red(`Eval not found: ${name}`));
        process.exit(1);
      }

      // Fetch content — for user/app evals we need to read the file server-side
      // Just show metadata for now
      if (options.json) {
        console.log(JSON.stringify(match, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold(match.name));
      console.log(`  Source:    ${match.source}`);
      console.log(`  Mode:      ${match.mode}`);
      console.log(`  Direction: ${match.direction} is better`);
      console.log(`  Path:      ${chalk.gray(match.path)}`);
      if (match.description) {
        console.log(`  ${chalk.gray(match.description)}`);
      }
      console.log();
    } catch (err) {
      if (err instanceof ApiError) {
        console.error(chalk.red('Error:'), (err.body as { error?: string })?.error || err.statusText);
      } else if (err instanceof NetworkError) {
        console.error(chalk.red('Network error:'), err.message);
      } else {
        throw err;
      }
      process.exit(1);
    }
  });

// flow eval new <name>
evalCmd
  .command('new <name>')
  .description('Create a new eval recipe template')
  .option('--json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const template = `# Evolve Recipe: ${name}

## Artifact
- file: output.txt
- description: The file to optimize

## Scoring
- mode: judge
- direction: higher
- budget: 5
- samples: 1

## Criteria
- Quality (0.4): Overall quality of the output
- Clarity (0.3): Clear and easy to understand
- Completeness (0.3): Covers all necessary aspects

## Examples
### "Poor quality" → 20
Lacks structure, unclear language, missing key elements.

### "Excellent quality" → 90
Well-structured, clear and concise, covers all requirements thoroughly.

## Context
Add any additional context the judge needs to evaluate this artifact.
`;

      if (options.json) {
        console.log(JSON.stringify({ name, template }, null, 2));
        return;
      }

      console.log();
      console.log(chalk.green('✓'), `Eval recipe template for: ${chalk.bold(name)}`);
      console.log();
      console.log(template);
      console.log(chalk.gray('Save this to ~/flow-data/evals/' + name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() + '.md'));
      console.log();
    } catch (err) {
      if (err instanceof ApiError) {
        console.error(chalk.red('Error:'), (err.body as { error?: string })?.error || err.statusText);
      } else {
        throw err;
      }
      process.exit(1);
    }
  });

export const evalsCommand = evalsCmd;
export const evalCommand = evalCmd;
