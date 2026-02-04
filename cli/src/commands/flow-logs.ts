/**
 * Flow Logs Command
 *
 * Streams/tails logs for a worker, fetching progress entries and displaying
 * them with live updates.
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
}

// Response type for worker logs
interface WorkerLogsResponse {
  entries: ProgressEntry[];
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
  .option('--since <time>', 'Show entries since timestamp (e.g., "5m", "1h", "2024-01-01")');

addOutputFlags(command);

export const flowLogsCommand = command
  .action(async (workerId: string, options: LogsOptions) => {
    try {
      // First get worker details to verify it exists and show context
      const workerResponse = await api.get<WorkerDetailsResponse>(
        `/workers/${workerId}`
      );
      const worker = workerResponse.worker;

      if (!options.json && !options.quiet) {
        console.log();
        console.log(chalk.gray(`Fetching logs for worker ${chalk.cyan(workerId)}...`));
        console.log(chalk.gray(`Worker: ${worker.name} | Status: ${formatStatus(worker.status)} | Iteration: ${worker.iteration}`));
        console.log();
      }

      // Fetch initial logs
      const logsResponse = await api.get<WorkerLogsResponse>(
        `/workers/${workerId}/logs`
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
          entries: entries.map(formatEntryForJson)
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
          displayEntry(entry);
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

            // Fetch new logs
            const newLogsResponse = await api.get<WorkerLogsResponse>(
              `/workers/${workerId}/logs`
            );

            // Filter to only new entries
            const newEntries = newLogsResponse.entries
              .filter(e => e.id > lastSeenId)
              .sort((a, b) => a.created_at - b.created_at);

            // Display new entries
            for (const entry of newEntries) {
              displayEntry(entry);
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
 * Display a single log entry with formatting
 */
function displayEntry(entry: ProgressEntry): void {
  const timestamp = new Date(entry.created_at).toLocaleTimeString();
  const iterationLabel = chalk.gray(`[iter ${entry.iteration}]`);
  const timeLabel = chalk.gray(timestamp);

  // Determine if this is a status update or full output
  if (entry.content.startsWith('STATUS:')) {
    const status = entry.content.replace('STATUS:', '').trim();
    console.log(`${timeLabel} ${iterationLabel} ${chalk.cyan('●')} ${chalk.white(status)}`);
  } else if (entry.content === 'DONE') {
    console.log(`${timeLabel} ${iterationLabel} ${chalk.green('✓')} ${chalk.bold.green('Task completed')}`);
  } else if (entry.content.startsWith('ERROR:')) {
    const errorMsg = entry.content.replace('ERROR:', '').trim();
    console.log(`${timeLabel} ${iterationLabel} ${chalk.red('✗')} ${chalk.red(errorMsg)}`);
  } else {
    // Regular content
    console.log(`${timeLabel} ${iterationLabel} ${chalk.gray('│')} ${entry.content}`);
  }

  // If there's full_output and it's different from content, show a truncated preview
  if (entry.full_output && entry.full_output !== entry.content) {
    const preview = entry.full_output.slice(0, 200);
    const truncated = entry.full_output.length > 200;
    console.log(chalk.gray(`    └─ ${preview}${truncated ? '...' : ''}`));
  }
}

/**
 * Format entry for JSON output
 */
function formatEntryForJson(entry: ProgressEntry): object {
  return {
    id: entry.id,
    iteration: entry.iteration,
    content: entry.content,
    hasFullOutput: !!entry.full_output,
    fullOutputLength: entry.full_output?.length ?? 0,
    compacted: entry.compacted,
    createdAt: entry.created_at,
    createdAtFormatted: new Date(entry.created_at).toISOString()
  };
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
