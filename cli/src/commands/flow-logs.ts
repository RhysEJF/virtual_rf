/**
 * Flow Logs Command
 *
 * Streams/tails logs for a worker, fetching progress entries and displaying
 * them with live updates.
 *
 * Verbosity levels:
 *   -v    : Show HOMЯ quality scores
 *   -vv   : Show discoveries, drift, issues
 *   -vvv  : Show Claude output preview
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, ProgressEntry, WorkerStatus } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

// Extended options for logs command
interface LogsOptions extends OutputOptions {
  follow?: boolean;
  tail?: number;
  since?: string;
  verbose?: number;  // 0, 1, 2, or 3
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

const command = new Command('logs')
  .description('Stream logs for a worker')
  .argument('<worker-id>', 'The worker ID to fetch logs for')
  .option('-f, --follow', 'Follow log output (live updates)')
  .option('-n, --tail <lines>', 'Number of entries to show from end', '10')
  .option('--since <time>', 'Show entries since timestamp (e.g., "5m", "1h", "2024-01-01")')
  .option('-v, --verbose', 'Increase verbosity (-v, -vv, -vvv)', increaseVerbosity, 0);

addOutputFlags(command);

/**
 * Accumulator function for -v flag repetition
 */
function increaseVerbosity(_dummyValue: string, previous: number): number {
  return previous + 1;
}

export const flowLogsCommand = command
  .action(async (workerId: string, options: LogsOptions) => {
    try {
      const verbosity = Math.min(options.verbose || 0, 3);

      // First get worker details to verify it exists and show context
      const workerResponse = await api.get<WorkerDetailsResponse>(
        `/workers/${workerId}`
      );
      const worker = workerResponse.worker;

      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray(`Fetching logs for worker ${chalk.cyan(workerId)}...`));
        console.log(chalk.gray(`Worker: ${worker.name} | Status: ${formatStatus(worker.status)} | Iteration: ${worker.iteration}`));
        if (verbosity > 0) {
          console.log(chalk.gray(`Verbosity: ${verbosity} (${verbosityDescription(verbosity)})`));
        }
        console.log();
      }

      // Fetch initial logs with verbosity
      const logsResponse = await api.get<WorkerLogsResponse>(
        `/workers/${workerId}/logs?verbosity=${verbosity}`
      );

      let entries = logsResponse.entries;

      // Filter by --since if provided
      if (options.since) {
        const sinceTimestamp = parseSince(options.since);
        if (sinceTimestamp) {
          entries = entries.filter(e => e.created_at >= sinceTimestamp);
        }
      }

      // Sort entries by created_at ascending (oldest first)
      entries.sort((a, b) => a.created_at - b.created_at);

      // Apply --tail limit
      const tailLimit = parseInt(String(options.tail || '10'), 10);
      if (!options.follow && tailLimit > 0 && entries.length > tailLimit) {
        entries = entries.slice(-tailLimit);
      }

      // Handle JSON output
      if (options.json) {
        const data = {
          workerId,
          workerName: worker.name,
          status: worker.status,
          verbosity,
          entries: entries.map(e => formatEntryForJson(e, verbosity))
        };
        handleOutput(data, options);
        return;
      }

      // Handle quiet mode
      if (options.quiet) {
        for (const entry of entries) {
          console.log(entry.content);
        }
        return;
      }

      // Display initial entries
      if (entries.length === 0) {
        console.log(chalk.yellow('No log entries found'));
      } else {
        for (const entry of entries) {
          displayEntry(entry, verbosity);
        }
      }

      // If follow mode, poll for new entries
      if (options.follow) {
        console.log();
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.gray('Following logs... (Ctrl+C to stop)'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log();

        let lastSeenId = entries.length > 0 ? Math.max(...entries.map(e => e.id)) : 0;
        let lastSeenIteration = worker.iteration;

        // Poll interval in ms
        const pollInterval = 2000;

        const poll = async (): Promise<void> => {
          try {
            // Check worker status
            const workerCheck = await api.get<WorkerDetailsResponse>(
              `/workers/${workerId}`
            );

            // Fetch new logs with verbosity
            const newLogsResponse = await api.get<WorkerLogsResponse>(
              `/workers/${workerId}/logs?verbosity=${verbosity}`
            );

            // Filter to only new entries
            const newEntries = newLogsResponse.entries
              .filter(e => e.id > lastSeenId)
              .sort((a, b) => a.created_at - b.created_at);

            // Display new entries
            for (const entry of newEntries) {
              displayEntry(entry, verbosity);
              lastSeenId = Math.max(lastSeenId, entry.id);
            }

            // Check if iteration changed
            if (workerCheck.worker.iteration !== lastSeenIteration) {
              console.log();
              console.log(chalk.blue('→'), chalk.gray(`Iteration ${workerCheck.worker.iteration}`));
              lastSeenIteration = workerCheck.worker.iteration;
            }

            // Check if worker finished
            if (workerCheck.worker.status === 'completed') {
              console.log();
              console.log(chalk.green('✓'), chalk.bold('Worker completed'));
              console.log();
              return;
            }

            if (workerCheck.worker.status === 'failed') {
              console.log();
              console.log(chalk.red('✗'), chalk.bold('Worker failed'));
              console.log();
              return;
            }

            if (workerCheck.worker.status === 'paused') {
              console.log();
              console.log(chalk.yellow('⏸'), chalk.bold('Worker paused'));
              console.log(chalk.gray(`Use 'flow resume ${workerCheck.worker.outcome_id}' to resume`));
              console.log();
              return;
            }

            // Continue polling
            setTimeout(() => {
              poll().catch(handlePollError);
            }, pollInterval);
          } catch (error) {
            handlePollError(error);
          }
        };

        const handlePollError = (error: unknown): void => {
          if (error instanceof NetworkError) {
            console.log();
            console.log(chalk.yellow('⚠'), 'Connection lost, retrying...');
            setTimeout(() => {
              poll().catch(handlePollError);
            }, pollInterval * 2);
            return;
          }
          throw error;
        };

        // Start polling
        await poll();
      } else {
        console.log();
        console.log(chalk.gray(`Use 'flow logs ${workerId} -f' to follow live updates`));
        if (verbosity === 0) {
          console.log(chalk.gray(`Use -v, -vv, or -vvv for more detail`));
        }
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

/**
 * Format worker status with appropriate color
 */
function formatStatus(status: WorkerStatus): string {
  switch (status) {
    case 'running':
      return chalk.green(status);
    case 'paused':
      return chalk.yellow(status);
    case 'completed':
      return chalk.green(status);
    case 'failed':
      return chalk.red(status);
    case 'idle':
      return chalk.gray(status);
    default:
      return status;
  }
}

/**
 * Get description of verbosity level
 */
function verbosityDescription(level: number): string {
  switch (level) {
    case 1: return 'quality scores';
    case 2: return 'discoveries, drift, issues';
    case 3: return 'full output';
    default: return 'default';
  }
}

/**
 * Display a single log entry with formatting
 */
function displayEntry(entry: ProgressEntry, verbosity: number): void {
  const timestamp = new Date(entry.created_at).toLocaleTimeString();
  const iterationLabel = chalk.gray(`[iter ${entry.iteration}]`);
  const timeLabel = chalk.gray(timestamp);

  // Base content (always shown)
  if (entry.content.startsWith('STATUS:')) {
    const status = entry.content.replace('STATUS:', '').trim();
    console.log(`${timeLabel} ${iterationLabel} ${chalk.cyan('●')} ${chalk.white(status)}`);
  } else if (entry.content === 'DONE') {
    console.log(`${timeLabel} ${iterationLabel} ${chalk.green('✓')} ${chalk.bold.green('Task completed')}`);
  } else if (entry.content.startsWith('ERROR:')) {
    const errorMsg = entry.content.replace('ERROR:', '').trim();
    console.log(`${timeLabel} ${iterationLabel} ${chalk.red('✗')} ${chalk.red(errorMsg)}`);
  } else if (entry.content.includes('Completed:')) {
    console.log(`${timeLabel} ${iterationLabel} ${chalk.green('✓')} ${chalk.white(entry.content)}`);
  } else if (entry.content.includes('Failed:')) {
    console.log(`${timeLabel} ${iterationLabel} ${chalk.red('✗')} ${chalk.red(entry.content)}`);
  } else {
    // Regular content
    console.log(`${timeLabel} ${iterationLabel} ${chalk.gray('│')} ${entry.content}`);
  }

  // Verbosity level 1: HOMЯ quality summary
  if (verbosity >= 1 && entry.observation) {
    const obs = entry.observation;
    const qualityColor = obs.quality === 'good' ? chalk.green :
                         obs.quality === 'needs_work' ? chalk.yellow : chalk.red;
    const trackStatus = obs.onTrack ? chalk.green('on track') : chalk.yellow('drifting');
    console.log(chalk.gray(`           │ `) +
      `Quality: ${qualityColor(obs.quality)} (${obs.alignmentScore}/100) • ${trackStatus}`);
  }

  // Verbosity level 2: Discoveries, drift, issues
  if (verbosity >= 2 && entry.observation) {
    const obs = entry.observation;

    if (obs.discoveries && obs.discoveries.length > 0) {
      console.log(chalk.gray(`           │ `) + chalk.cyan('Discoveries:'));
      for (const d of obs.discoveries) {
        console.log(chalk.gray(`           │   `) + `• [${d.type}] ${d.content}`);
      }
    }

    if (obs.drift && obs.drift.length > 0) {
      console.log(chalk.gray(`           │ `) + chalk.yellow('Drift:'));
      for (const d of obs.drift) {
        console.log(chalk.gray(`           │   `) + `• ${d.description}`);
      }
    }

    if (obs.issues && obs.issues.length > 0) {
      console.log(chalk.gray(`           │ `) + chalk.red('Issues:'));
      for (const i of obs.issues) {
        console.log(chalk.gray(`           │   `) + `• ${i.description}`);
      }
    }

    if (obs.hasAmbiguity && obs.ambiguityData) {
      console.log(chalk.gray(`           │ `) + chalk.magenta('Ambiguity: ') + obs.ambiguityData.type);
    }
  }

  // Verbosity level 3: Full Claude output preview
  if (verbosity >= 3 && entry.full_output) {
    const preview = entry.full_output.slice(0, 1000);
    const truncated = entry.full_output.length > 1000;
    console.log(chalk.gray(`           └─── Claude Output ───`));
    console.log(chalk.gray(preview));
    if (truncated) {
      console.log(chalk.gray(`           ... (${entry.full_output.length - 1000} more chars)`));
    }
  }
}

/**
 * Format entry for JSON output
 */
function formatEntryForJson(entry: ProgressEntry, verbosity: number): object {
  const result: Record<string, unknown> = {
    id: entry.id,
    iteration: entry.iteration,
    content: entry.content,
    taskId: entry.task_id,
    taskTitle: entry.taskTitle,
    hasFullOutput: !!entry.full_output,
    fullOutputLength: entry.full_output?.length ?? 0,
    compacted: entry.compacted,
    createdAt: entry.created_at,
    createdAtFormatted: new Date(entry.created_at).toISOString()
  };

  if (verbosity >= 1 && entry.observation) {
    result.observation = entry.observation;
  }

  if (verbosity >= 3 && entry.full_output) {
    result.fullOutput = entry.full_output;
  }

  return result;
}

/**
 * Parse --since option into a timestamp
 * Supports: "5m" (5 minutes), "1h" (1 hour), "2d" (2 days), ISO date string
 */
function parseSince(since: string): number | null {
  // Try relative time formats
  const relativeMatch = since.match(/^(\d+)([mhd])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();

    switch (unit) {
      case 'm':
        return now - (value * 60 * 1000);
      case 'h':
        return now - (value * 60 * 60 * 1000);
      case 'd':
        return now - (value * 24 * 60 * 60 * 1000);
    }
  }

  // Try ISO date string
  const date = new Date(since);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return null;
}

export default flowLogsCommand;
