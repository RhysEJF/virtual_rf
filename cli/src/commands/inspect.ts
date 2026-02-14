/**
 * Flow Inspect Command
 *
 * Deep dive into a specific worker iteration with full HOMЯ analysis
 * and Claude output.
 *
 * Usage:
 *   flow inspect <worker-id> <iteration>   # Specific iteration
 *   flow inspect <worker-id> --latest      # Most recent
 *   flow inspect <worker-id> 2 --output    # Only Claude output
 *   flow inspect <worker-id> 2 --analysis  # Only HOMЯ analysis
 *   flow inspect <worker-id> 2 --json      # Raw JSON
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, ProgressEntry, WorkerStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

interface InspectOptions extends OutputOptions {
  latest?: boolean;
  output?: boolean;
  analysis?: boolean;
}

// Response type for worker logs
interface WorkerLogsResponse {
  entries: ProgressEntry[];
  verbosity?: number;
}

// Response type for worker details
interface WorkerDetailsResponse {
  worker: {
    id: string;
    name: string;
    status: WorkerStatus;
    outcome_id: string;
    iteration: number;
    current_task_id: string | null;
  };
}

const command = new Command('inspect')
  .description('Deep dive into a specific worker iteration')
  .argument('<worker-id>', 'Worker ID')
  .argument('[iteration]', 'Iteration number (or use --latest)')
  .option('--latest', 'Inspect the most recent iteration')
  .option('--output', 'Show only Claude output')
  .option('--analysis', 'Show only HOMЯ analysis');

addOutputFlags(command);

export const inspectCommand = command.action(async (
  workerId: string,
  iterationArg: string | undefined,
  options: InspectOptions
) => {
  try {
    // Determine which iteration to fetch
    const iteration = options.latest ? 'latest' : iterationArg;

    if (!iteration) {
      console.error(chalk.red('Error:'), 'Specify iteration number or use --latest');
      process.exit(1);
    }

    // First verify worker exists
    const workerResponse = await api.get<WorkerDetailsResponse>(
      `/workers/${workerId}`
    );
    const worker = workerResponse.worker;

    // Fetch full data for specific iteration (verbosity=3 for everything)
    const response = await api.get<WorkerLogsResponse>(
      `/workers/${workerId}/logs?iteration=${iteration}&verbosity=3`
    );

    if (response.entries.length === 0) {
      console.error(chalk.red('Error:'), `No entry found for iteration ${iteration}`);
      process.exit(1);
    }

    const entry = response.entries[0];

    // Handle JSON output
    if (options.json) {
      handleOutput({
        workerId,
        workerName: worker.name,
        iteration: entry.iteration,
        entry,
      }, options);
      return;
    }

    // Display header
    console.log();
    console.log(chalk.bold('═'.repeat(65)));
    console.log(chalk.bold(` Iteration ${entry.iteration} • ${workerId}`));
    console.log(chalk.bold('═'.repeat(65)));
    console.log();

    // Task info
    const taskTitle = entry.taskTitle || entry.task_id || 'Unknown';
    const isCompleted = entry.content.includes('Completed');
    const isFailed = entry.content.includes('Failed') || entry.content.includes('ERROR');

    console.log(`Task:     ${chalk.white(taskTitle)}`);
    console.log(`Status:   ${isCompleted ? chalk.green('completed') : isFailed ? chalk.red('failed') : chalk.yellow('in progress')}`);
    console.log(`Time:     ${new Date(entry.created_at).toLocaleString()}`);
    console.log();

    // HOMЯ Analysis section (unless --output only)
    if (!options.output) {
      console.log(chalk.bold('─── HOMЯ Analysis ') + chalk.gray('─'.repeat(47)));
      console.log();

      if (entry.observation) {
        const obs = entry.observation;
        const qualityColor = obs.quality === 'good' ? chalk.green :
                             obs.quality === 'needs_work' ? chalk.yellow : chalk.red;

        console.log(`Quality:     ${qualityColor(obs.quality)} (${obs.alignmentScore}/100)`);
        console.log(`On Track:    ${obs.onTrack ? chalk.green('yes') : chalk.yellow('no')}`);
        console.log();

        if (obs.discoveries && obs.discoveries.length > 0) {
          console.log(chalk.cyan('Discoveries:'));
          for (const d of obs.discoveries) {
            console.log(`  • [${d.type}] ${d.content}`);
          }
          console.log();
        }

        if (obs.drift && obs.drift.length > 0) {
          console.log(chalk.yellow('Drift:'));
          for (const d of obs.drift) {
            console.log(`  • ${d.description}`);
          }
          console.log();
        } else {
          console.log(`Drift:       ${chalk.green('none')}`);
        }

        if (obs.issues && obs.issues.length > 0) {
          console.log(chalk.red('Issues:'));
          for (const i of obs.issues) {
            console.log(`  • ${i.description}`);
          }
          console.log();
        } else {
          console.log(`Issues:      ${chalk.green('none')}`);
        }

        if (obs.hasAmbiguity) {
          console.log(chalk.magenta('Ambiguity:   ') + (obs.ambiguityData?.type || 'detected'));
        } else {
          console.log(`Ambiguity:   ${chalk.green('none')}`);
        }
        console.log();
      } else {
        console.log(chalk.gray('No HOMЯ observation available for this iteration'));
        console.log(chalk.gray('(HOMЯ observations are created when tasks complete)'));
        console.log();
      }
    }

    // Claude Output section (unless --analysis only)
    if (!options.analysis) {
      if (entry.full_output) {
        const outputLen = entry.full_output.length;
        const headerLen = outputLen.toLocaleString().length;
        console.log(chalk.bold(`─── Claude Output (${outputLen.toLocaleString()} chars) `) +
                    chalk.gray('─'.repeat(Math.max(0, 40 - headerLen))));
        console.log();
        console.log(entry.full_output);
        console.log();
      } else {
        console.log(chalk.bold('─── Claude Output ') + chalk.gray('─'.repeat(47)));
        console.log();
        console.log(chalk.gray('No Claude output available for this iteration'));
        console.log();
      }
    }

    // Footer with helpful commands
    if (!options.quiet) {
      console.log(chalk.gray('─'.repeat(65)));
      console.log(chalk.gray(`View logs: flow logs ${workerId} -f -vv`));
      console.log();
    }

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error();
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }

    if (error instanceof ApiError) {
      console.error();

      if (error.status === 404) {
        console.error(chalk.red('Error:'), `Worker '${workerId}' not found`);
        process.exit(1);
      }

      console.error(chalk.red('API Error:'), error.message);
      if (error.body && typeof error.body === 'object' && 'error' in error.body) {
        console.error(chalk.gray((error.body as { error: string }).error));
      }
      process.exit(1);
    }

    throw error;
  }
});

export default inspectCommand;
