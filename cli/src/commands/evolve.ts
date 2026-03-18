/**
 * Evolve Command
 *
 * Manage evolve mode on tasks: setup from recipe, show config, edit recipe.
 *
 * Usage:
 *   flow evolve setup <task-id>    Set up evolve mode on a task
 *   flow evolve show <task-id>     Show evolve config and recipe
 *   flow evolve edit <task-id>     Open recipe in $EDITOR
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Task } from '../api.js';

interface EvolveSetupOptions {
  eval?: string;
  generate?: boolean;
  artifact?: string;
  direction?: string;
  budget?: string;
  mode?: string;
  command?: string;
  samples?: string;
  context?: string;
  json?: boolean;
}

interface EvolveShowOptions {
  json?: boolean;
}

interface EvolveActivateResponse {
  task: Task;
  eval_script: string;
  recipe: {
    name: string;
    mode: string;
    direction: string;
    budget: number;
    criteria_count: number;
    examples_count: number;
  };
}

interface EvolveGenerateResponse {
  recipe: string;
}

interface TaskResponse {
  task: Task;
}

const command = new Command('evolve')
  .description('Manage evolve mode (hill-climbing optimization)');

// Subcommand: flow evolve setup <task-id>
command
  .command('setup <task-id>')
  .description('Set up evolve mode on a task using an eval recipe')
  .option('-e, --eval <name>', 'Use existing eval by name')
  .option('-g, --generate', 'AI-generate a recipe from task context')
  .option('--artifact <file>', 'Artifact file to optimize')
  .option('--direction <dir>', 'Optimization direction (higher|lower)')
  .option('--budget <n>', 'Max iterations')
  .option('--mode <mode>', 'Eval mode (judge|command)')
  .option('--command <cmd>', 'Raw command (for mode=command)')
  .option('--samples <n>', 'Multi-sample count')
  .option('--context <text>', 'Context for judge')
  .option('--json', 'Output as JSON')
  .action(async (taskId: string, options: EvolveSetupOptions) => {
    try {
      // Option 1: Use existing eval
      if (options.eval) {
        const overrides: Record<string, unknown> = {};
        if (options.budget) overrides.budget = parseInt(options.budget, 10);
        if (options.samples) overrides.samples = parseInt(options.samples, 10);
        if (options.direction) overrides.direction = options.direction;

        const response = await api.post<EvolveActivateResponse>(`/tasks/${taskId}/evolve`, {
          recipe_name: options.eval,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        });

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log();
        console.log(chalk.green('✓'), `Evolve mode activated on task ${chalk.bold(taskId)}`);
        console.log(`  Recipe: ${chalk.cyan(response.recipe.name)}`);
        console.log(`  Mode: ${response.recipe.mode} | Direction: ${response.recipe.direction} | Budget: ${response.recipe.budget}`);
        console.log(`  Criteria: ${response.recipe.criteria_count} | Examples: ${response.recipe.examples_count}`);
        console.log(`  Eval script: ${chalk.gray(response.eval_script)}`);
        console.log();
        return;
      }

      // Option 2: AI-generate recipe
      if (options.generate) {
        console.log(chalk.gray('Generating eval recipe...'));
        const genResponse = await api.post<EvolveGenerateResponse>(`/tasks/${taskId}/evolve/generate`, {});

        if (options.json) {
          console.log(JSON.stringify(genResponse, null, 2));
          return;
        }

        console.log();
        console.log(chalk.green('✓'), 'Generated recipe:');
        console.log();
        console.log(genResponse.recipe);
        console.log();
        console.log(chalk.gray('To activate, run:'));
        console.log(chalk.gray(`  flow evolve setup ${taskId} --eval <save-name>`));
        console.log(chalk.gray('Or save this to a .md file in ~/flow-data/evals/'));
        console.log();
        return;
      }

      // Option 3: Build recipe from flags
      if (options.mode || options.command || options.artifact) {
        const lines = ['# Evolve Recipe: CLI-Generated'];
        lines.push('');
        lines.push('## Artifact');
        lines.push(`- file: ${options.artifact || 'output.txt'}`);
        lines.push('- description: Target artifact');
        lines.push('');
        lines.push('## Scoring');
        lines.push(`- mode: ${options.mode || (options.command ? 'command' : 'judge')}`);
        if (options.command) lines.push(`- command: ${options.command}`);
        lines.push(`- direction: ${options.direction || 'higher'}`);
        lines.push(`- budget: ${options.budget || '5'}`);
        lines.push(`- samples: ${options.samples || '1'}`);
        if (options.context) {
          lines.push('');
          lines.push('## Context');
          lines.push(options.context);
        }

        const recipeContent = lines.join('\n');
        const response = await api.post<EvolveActivateResponse>(`/tasks/${taskId}/evolve`, {
          recipe_content: recipeContent,
        });

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log();
        console.log(chalk.green('✓'), `Evolve mode activated on task ${chalk.bold(taskId)}`);
        console.log(`  Mode: ${response.recipe.mode} | Direction: ${response.recipe.direction} | Budget: ${response.recipe.budget}`);
        console.log();
        return;
      }

      // No flags: show help
      console.log();
      console.log('Set up evolve mode on a task. Options:');
      console.log();
      console.log(`  ${chalk.bold('--eval <name>')}      Use an existing eval recipe from your library`);
      console.log(`  ${chalk.bold('--generate')}         AI-generate a recipe from task context`);
      console.log(`  ${chalk.bold('--mode <judge|command>')}  Build a recipe from CLI flags`);
      console.log();
      console.log('Examples:');
      console.log(chalk.gray(`  flow evolve setup ${taskId} --eval headline-quality`));
      console.log(chalk.gray(`  flow evolve setup ${taskId} --generate`));
      console.log(chalk.gray(`  flow evolve setup ${taskId} --mode command --command "wc -c < output.txt" --direction lower`));
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

// Subcommand: flow evolve show <task-id>
command
  .command('show <task-id>')
  .description('Show evolve mode configuration for a task')
  .option('--json', 'Output as JSON')
  .action(async (taskId: string, options: EvolveShowOptions) => {
    try {
      const response = await api.get<TaskResponse>(`/tasks/${taskId}`);
      const task = response.task;

      if (options.json) {
        console.log(JSON.stringify({
          metric_command: task.metric_command,
          metric_baseline: task.metric_baseline,
          optimization_budget: task.optimization_budget,
          metric_direction: task.metric_direction,
          eval_recipe_name: task.eval_recipe_name,
        }, null, 2));
        return;
      }

      if (!task.metric_command) {
        console.log(chalk.gray('Evolve mode is not enabled on this task.'));
        console.log(chalk.gray(`Run: flow evolve setup ${taskId}`));
        return;
      }

      console.log();
      console.log(chalk.bold('Evolve Configuration'));
      console.log(`  Command:   ${chalk.cyan(task.metric_command)}`);
      console.log(`  Direction: ${task.metric_direction || 'lower'} is better`);
      console.log(`  Baseline:  ${task.metric_baseline ?? chalk.gray('(auto-detected)')}`);
      console.log(`  Budget:    ${task.optimization_budget || 5} iterations`);
      if (task.eval_recipe_name) {
        console.log(`  Recipe:    ${chalk.cyan(task.eval_recipe_name)}`);
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

export const evolveCommand = command;
