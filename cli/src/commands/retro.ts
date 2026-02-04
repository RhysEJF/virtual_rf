/**
 * Retro Command
 *
 * Trigger self-improvement retrospective analysis on escalation patterns
 * and check analysis job status.
 *
 * Commands:
 * - flow retro <outcome-id>   Trigger retro analysis for an outcome
 * - flow retro status         Show pending/running analysis jobs
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, OutputOptions } from '../utils/flags.js';

/**
 * Formats a timestamp to relative time (e.g., "2 min ago", "1 hour ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min ago`;
  return 'just now';
}

/**
 * Format job status with color
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.yellow('pending');
    case 'running':
      return chalk.blue('running');
    case 'completed':
      return chalk.green('completed');
    case 'failed':
      return chalk.red('failed');
    default:
      return chalk.gray(status);
  }
}

// Response types for API calls
interface AnalyzeResponse {
  success: boolean;
  jobId: string;
  status: 'pending';
  message: string;
}

interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progressMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

interface ActiveJobsResponse {
  success: boolean;
  jobs: JobStatus[];
}

// ============================================================================
// Main Command
// ============================================================================

const command = new Command('retro')
  .description('Retrospective analysis on escalation patterns');

// ============================================================================
// Trigger Analysis: flow retro <outcome-id>
// ============================================================================

interface TriggerOptions extends OutputOptions {}

const triggerCommand = new Command('trigger')
  .description('Trigger retro analysis for an outcome')
  .argument('<outcome-id>', 'Outcome ID to analyze');

addOutputFlags(triggerCommand);

triggerCommand.action(async (outcomeId: string, options: TriggerOptions) => {
  try {
    // Get outcome details first to show the name
    const { outcome } = await api.outcomes.get(outcomeId);

    // Trigger the analysis
    const response = await api.post<AnalyzeResponse>('/improvements/analyze', {
      outcomeId,
    });

    // Handle JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Handle quiet output
    if (options.quiet) {
      console.log(response.jobId);
      return;
    }

    // Normal output
    console.log();
    console.log(chalk.green('✓'), `Retrospective analysis started for "${chalk.bold(outcome.name)}"`);
    console.log(`  Job ID: ${chalk.cyan(response.jobId)}`);
    console.log();
    console.log(`  Use ${chalk.cyan('flow retro status')} to check progress`);
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
      } else if (error.status === 409) {
        console.error(chalk.yellow('Warning:'), 'An analysis is already running for this outcome');
        console.error(chalk.gray('Please wait for the current analysis to complete'));
      } else {
        console.error(chalk.red('API Error:'), error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

// ============================================================================
// Status: flow retro status
// ============================================================================

interface StatusOptions extends OutputOptions {}

const statusCommand = new Command('status')
  .description('Show pending/running analysis jobs');

addOutputFlags(statusCommand);

statusCommand.action(async (options: StatusOptions) => {
  try {
    const response = await api.get<ActiveJobsResponse>('/improvements/jobs/active');
    const jobs = response.jobs;

    // Handle JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Handle quiet output
    if (options.quiet) {
      for (const job of jobs) {
        console.log(`${job.id}\t${job.status}`);
      }
      return;
    }

    // Normal output
    console.log();
    console.log(chalk.bold('Analysis Jobs'));
    console.log();

    if (jobs.length === 0) {
      console.log(chalk.gray('  No active analysis jobs'));
      console.log();
      return;
    }

    // Table header
    const idWidth = 14;
    const statusWidth = 12;
    const startedWidth = 12;

    console.log(
      chalk.gray(
        'ID'.padEnd(idWidth) +
        'STATUS'.padEnd(statusWidth) +
        'STARTED'.padEnd(startedWidth) +
        'PROGRESS'
      )
    );

    // Job rows
    for (const job of jobs) {
      const id = job.id.substring(0, 12).padEnd(idWidth);
      const status = formatStatus(job.status).padEnd(statusWidth + 10); // Extra for ANSI codes
      const started = job.startedAt
        ? formatRelativeTime(job.startedAt).padEnd(startedWidth)
        : chalk.gray('pending').padEnd(startedWidth + 10);
      const progress = job.progressMessage || '';

      console.log(`${id}${status}${started}${chalk.gray(progress)}`);
    }

    console.log();

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      console.error(chalk.red('API Error:'), error.message);
      process.exit(1);
    }
    throw error;
  }
});

// ============================================================================
// Add Subcommands
// ============================================================================

command.addCommand(triggerCommand);
command.addCommand(statusCommand);

// Also support: flow retro <outcome-id> as shorthand for flow retro trigger <outcome-id>
command
  .argument('[outcome-id]', 'Outcome ID to analyze (shorthand for flow retro trigger)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output')
  .action(async (outcomeId: string | undefined, options: OutputOptions) => {
    if (!outcomeId) {
      // No outcome ID provided, show help
      command.help();
      return;
    }

    // Execute trigger logic directly
    try {
      const { outcome } = await api.outcomes.get(outcomeId);

      const response = await api.post<AnalyzeResponse>('/improvements/analyze', {
        outcomeId,
      });

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      if (options.quiet) {
        console.log(response.jobId);
        return;
      }

      console.log();
      console.log(chalk.green('✓'), `Retrospective analysis started for "${chalk.bold(outcome.name)}"`);
      console.log(`  Job ID: ${chalk.cyan(response.jobId)}`);
      console.log();
      console.log(`  Use ${chalk.cyan('flow retro status')} to check progress`);
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
        } else if (error.status === 409) {
          console.error(chalk.yellow('Warning:'), 'An analysis is already running for this outcome');
          console.error(chalk.gray('Please wait for the current analysis to complete'));
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export const retroCommand = command;
export default retroCommand;
