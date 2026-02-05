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

interface ProposalSummary {
  clusterId: string;
  rootCause: string;
  escalationCount: number;
  problemSummary: string;
  outcomeName: string;
  proposedTasks: Array<{
    title: string;
    description: string;
    priority: number;
  }>;
  intent: {
    summary: string;
    itemCount: number;
    successCriteria: string[];
  };
  approach: {
    summary: string;
    stepCount: number;
    risks: string[];
  };
}

interface AnalysisResultSummary {
  success: boolean;
  escalationsAnalyzed: number;
  clusters: Array<{
    id: string;
    rootCause: string;
    patternDescription: string;
    problemStatement: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    escalationCount: number;
    triggerTypes: string[];
  }>;
  proposals: ProposalSummary[];
  analyzedAt: number;
  message: string;
}

interface JobDetailStatus extends JobStatus {
  result?: AnalysisResultSummary | null;
  error?: string | null;
}

interface JobDetailResponse {
  success: boolean;
  job: JobDetailStatus;
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
// History: flow retro history
// ============================================================================

interface RecentJob {
  id: string;
  outcomeId: string | null;
  jobType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progressMessage: string | null;
  result: AnalysisResultSummary | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

interface RecentJobsResponse {
  success: boolean;
  jobs: RecentJob[];
}

interface HistoryOptions extends OutputOptions {
  limit?: string;
}

const historyCommand = new Command('history')
  .description('Show recent analysis jobs (including completed/failed)')
  .option('-l, --limit <number>', 'Number of jobs to show', '10');

addOutputFlags(historyCommand);

historyCommand.action(async (options: HistoryOptions) => {
  try {
    const limit = options.limit || '10';
    const response = await api.get<RecentJobsResponse>(`/improvements/jobs/recent?limit=${limit}`);
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
    console.log(chalk.bold('Recent Analysis Jobs'));
    console.log();

    if (jobs.length === 0) {
      console.log(chalk.gray('  No analysis jobs found'));
      console.log();
      return;
    }

    // Table header
    const idWidth = 14;
    const statusWidth = 12;
    const timeWidth = 12;
    const proposalsWidth = 10;

    console.log(
      chalk.gray(
        'ID'.padEnd(idWidth) +
        'STATUS'.padEnd(statusWidth) +
        'TIME'.padEnd(timeWidth) +
        'PROPOSALS'.padEnd(proposalsWidth) +
        'ESCALATIONS'
      )
    );

    // Job rows
    for (const job of jobs) {
      const id = job.id.substring(0, 12).padEnd(idWidth);
      const status = formatStatus(job.status).padEnd(statusWidth + 10); // Extra for ANSI codes
      const time = job.completedAt
        ? formatRelativeTime(job.completedAt).padEnd(timeWidth)
        : job.startedAt
          ? formatRelativeTime(job.startedAt).padEnd(timeWidth)
          : formatRelativeTime(job.createdAt).padEnd(timeWidth);

      const proposals = job.result?.proposals?.length?.toString() || '-';
      const escalations = job.result?.escalationsAnalyzed?.toString() || '-';

      console.log(`${id}${status}${time}${proposals.padEnd(proposalsWidth)}${escalations}`);
    }

    console.log();
    console.log(chalk.gray(`  Use ${chalk.cyan('flow retro show <job-id>')} to see job details`));
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
// Show Job: flow retro show <job-id>
// ============================================================================

interface ShowOptions extends OutputOptions {}

const showCommand = new Command('show')
  .description('Show details and results of a specific analysis job')
  .argument('<job-id>', 'Job ID to inspect');

addOutputFlags(showCommand);

showCommand.action(async (jobId: string, options: ShowOptions) => {
  try {
    const response = await api.get<JobDetailResponse>(`/improvements/jobs/${jobId}`);
    const job = response.job;

    // Handle JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Handle quiet output
    if (options.quiet) {
      console.log(`${job.id}\t${job.status}`);
      return;
    }

    // Normal output
    console.log();
    console.log(chalk.bold('Analysis Job Details'));
    console.log();

    // Basic info
    console.log(`  ${chalk.gray('ID:')}      ${job.id}`);
    console.log(`  ${chalk.gray('Status:')}  ${formatStatus(job.status)}`);

    if (job.createdAt) {
      console.log(`  ${chalk.gray('Created:')} ${formatRelativeTime(job.createdAt)}`);
    }
    if (job.startedAt) {
      console.log(`  ${chalk.gray('Started:')} ${formatRelativeTime(job.startedAt)}`);
    }
    if (job.completedAt) {
      console.log(`  ${chalk.gray('Finished:')} ${formatRelativeTime(job.completedAt)}`);
    }

    // Progress or error
    if (job.status === 'running' && job.progressMessage) {
      console.log();
      console.log(`  ${chalk.gray('Progress:')} ${job.progressMessage}`);
    }

    if (job.status === 'failed' && job.error) {
      console.log();
      console.log(`  ${chalk.red('Error:')} ${job.error}`);
    }

    // Results
    if (job.status === 'completed' && job.result) {
      console.log();
      console.log(chalk.bold('Results'));
      console.log();
      console.log(`  ${chalk.gray('Escalations analyzed:')} ${job.result.escalationsAnalyzed}`);
      console.log(`  ${chalk.gray('Proposals generated:')}  ${job.result.proposals?.length || 0}`);

      if (job.result.message) {
        console.log();
        console.log(`  ${chalk.gray('Message:')} ${job.result.message}`);
      }

      if (job.result.proposals && job.result.proposals.length > 0) {
        console.log();
        console.log(chalk.bold('Improvement Proposals'));
        console.log();

        job.result.proposals.forEach((proposal, index) => {
          const num = chalk.cyan(`[${index + 1}]`);
          console.log(`  ${num} ${chalk.bold.white(proposal.outcomeName)}`);
          console.log(`      ${chalk.gray('Root cause:')} ${proposal.rootCause}`);
          console.log(`      ${chalk.gray(`${proposal.escalationCount} escalation${proposal.escalationCount !== 1 ? 's' : ''} addressed`)}`);
          console.log(`      ${chalk.gray(`${proposal.proposedTasks?.length || 0} tasks proposed`)}`);
          console.log();
        });

        console.log(chalk.gray(`  Create outcomes with: ${chalk.cyan(`flow retro create ${jobId} <number>`)}`));
        console.log(chalk.gray(`  Or consolidated:      ${chalk.cyan(`flow retro create ${jobId} --consolidated`)}`));
      } else {
        console.log();
        console.log(chalk.gray('  No improvement proposals generated.'));
        console.log(chalk.gray('  This may mean no actionable patterns were found.'));
      }
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
        console.error(chalk.red('Error:'), `Job not found: ${jobId}`);
        console.error(chalk.gray('Job IDs can be found with: flow retro status'));
      } else {
        console.error(chalk.red('API Error:'), error.message);
      }
      process.exit(1);
    }
    throw error;
  }
});

// ============================================================================
// Create: flow retro create <job-id> [number] [--consolidated] [--start] [--open]
// ============================================================================

interface CreateOptions extends OutputOptions {
  consolidated?: string | boolean;
  start?: boolean;
  open?: boolean;
}

interface CreatedOutcomeInfo {
  id: string;
  name: string;
  taskCount: number;
  rootCause: string;
}

interface CreateFromProposalsResponse {
  success: boolean;
  parentOutcomeId: string;
  outcomes: CreatedOutcomeInfo[];
  message: string;
}

interface StartWorkerResponse {
  success: boolean;
  worker: {
    id: string;
    outcome_id: string;
  };
}

const createCommand = new Command('create')
  .description('Create outcome(s) from analysis proposals')
  .argument('<job-id>', 'Job ID containing the proposals')
  .argument('[number]', 'Proposal number to create (1, 2, etc.)')
  .option('--consolidated [numbers]', 'Create one consolidated outcome (optionally specify numbers like 1,3)')
  .option('--start', 'Start a worker immediately after creation')
  .option('--open', 'Open the outcome in browser after creation');

addOutputFlags(createCommand);

createCommand.action(async (jobId: string, proposalNumber: string | undefined, options: CreateOptions) => {
  try {
    // Fetch the job details
    const jobResponse = await api.get<JobDetailResponse>(`/improvements/jobs/${jobId}`);
    const job = jobResponse.job;

    if (job.status !== 'completed') {
      console.error(chalk.red('Error:'), `Job is not completed (status: ${job.status})`);
      process.exit(1);
    }

    if (!job.result?.proposals || job.result.proposals.length === 0) {
      console.error(chalk.red('Error:'), 'No proposals found in this job');
      process.exit(1);
    }

    const allProposals = job.result.proposals;

    // Determine which proposals to use
    let selectedProposals: ProposalSummary[];
    let isConsolidated = false;

    if (options.consolidated !== undefined) {
      isConsolidated = true;

      if (typeof options.consolidated === 'string' && options.consolidated.length > 0) {
        // Parse specific numbers like "1,3"
        const numbers = options.consolidated.split(',').map(n => parseInt(n.trim(), 10));
        const invalid = numbers.filter(n => isNaN(n) || n < 1 || n > allProposals.length);

        if (invalid.length > 0) {
          console.error(chalk.red('Error:'), `Invalid proposal numbers: ${invalid.join(', ')}`);
          console.error(chalk.gray(`Valid range: 1-${allProposals.length}`));
          process.exit(1);
        }

        selectedProposals = numbers.map(n => allProposals[n - 1]);
      } else {
        // Use all proposals
        selectedProposals = allProposals;
      }
    } else if (proposalNumber) {
      // Single proposal by number
      const num = parseInt(proposalNumber, 10);

      if (isNaN(num) || num < 1 || num > allProposals.length) {
        console.error(chalk.red('Error:'), `Invalid proposal number: ${proposalNumber}`);
        console.error(chalk.gray(`Valid range: 1-${allProposals.length}`));
        process.exit(1);
      }

      selectedProposals = [allProposals[num - 1]];
    } else {
      console.error(chalk.red('Error:'), 'Please specify a proposal number or use --consolidated');
      console.error();
      console.error(chalk.gray('Examples:'));
      console.error(chalk.gray(`  flow retro create ${jobId} 1`));
      console.error(chalk.gray(`  flow retro create ${jobId} --consolidated`));
      console.error(chalk.gray(`  flow retro create ${jobId} --consolidated 1,3`));
      process.exit(1);
    }

    // Create the outcomes
    const createResponse = await api.post<CreateFromProposalsResponse>('/improvements/create-from-proposals', {
      proposals: selectedProposals,
      consolidated: isConsolidated,
    });

    // Handle JSON output
    if (options.json) {
      console.log(JSON.stringify(createResponse, null, 2));
      return;
    }

    // Handle quiet output
    if (options.quiet) {
      for (const outcome of createResponse.outcomes) {
        console.log(outcome.id);
      }
      return;
    }

    // Normal output
    console.log();

    for (const outcome of createResponse.outcomes) {
      console.log(chalk.green('✓'), `Created outcome "${chalk.bold(outcome.name)}"`);
      console.log(`  ID: ${chalk.cyan(outcome.id)}`);
      console.log(`  Tasks: ${outcome.taskCount}`);
      console.log();
    }

    // Start worker if requested
    if (options.start && createResponse.outcomes.length > 0) {
      const outcomeId = createResponse.outcomes[0].id;

      try {
        const workerResponse = await api.post<StartWorkerResponse>(`/outcomes/${outcomeId}/workers`, {});
        console.log(chalk.green('✓'), 'Worker started');
        console.log(`  Worker ID: ${chalk.cyan(workerResponse.worker.id)}`);
        console.log();
      } catch (err) {
        if (err instanceof ApiError) {
          console.error(chalk.yellow('Warning:'), `Could not start worker: ${err.message}`);
        }
      }
    }

    // Open in browser if requested
    if (options.open && createResponse.outcomes.length > 0) {
      const outcomeId = createResponse.outcomes[0].id;
      const url = `http://localhost:3000/outcome/${outcomeId}`;

      // Use 'open' command on macOS, 'xdg-open' on Linux
      const { exec } = await import('child_process');
      const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';

      exec(`${openCmd} "${url}"`, (err) => {
        if (err) {
          console.log(chalk.gray(`  Open in browser: ${chalk.cyan(url)}`));
        }
      });
    }

    // Show next steps
    if (!options.start && createResponse.outcomes.length > 0) {
      const outcomeId = createResponse.outcomes[0].id;
      console.log(chalk.gray(`Use '${chalk.cyan(`flow show ${outcomeId}`)}' to see details`));
      console.log(chalk.gray(`Use '${chalk.cyan(`flow start ${outcomeId}`)}' to begin work`));
      console.log();
    }

  } catch (error) {
    if (error instanceof NetworkError) {
      console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
      console.error(chalk.gray('Make sure the server is running (npm run dev)'));
      process.exit(1);
    }
    if (error instanceof ApiError) {
      if (error.status === 404) {
        console.error(chalk.red('Error:'), `Job not found: ${jobId}`);
      } else {
        console.error(chalk.red('API Error:'), error.message);
      }
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
command.addCommand(historyCommand);
command.addCommand(showCommand);
command.addCommand(createCommand);

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
