/**
 * Analysis Job Runner
 *
 * Manages background execution of analysis jobs with progress tracking.
 * Uses an in-memory map to track active jobs, with database persistence
 * for durability and status queries.
 */

import {
  createAnalysisJob,
  startAnalysisJob,
  updateJobProgress,
  completeAnalysisJob,
  failAnalysisJob,
  getAnalysisJobById,
  getActiveJobs,
} from '@/lib/db/analysis-jobs';
import {
  analyzeForImprovements,
  type AnalysisResult,
} from '@/lib/agents/improvement-analyzer';
import {
  logAnalysisStarted,
  logAnalysisCompleted,
  logAnalysisFailed,
} from '@/lib/db/activity';
import { getOutcomeById } from '@/lib/db/outcomes';
import type { AnalysisJob } from '@/lib/db/schema';

// ============================================================================
// Types
// ============================================================================

export interface StartAnalysisOptions {
  outcomeId?: string;
  lookbackDays?: number;
  maxProposals?: number;
}

export interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progressMessage: string | null;
  result?: AnalysisResultSummary | null;
  error?: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AnalysisResultSummary {
  success: boolean;
  escalationsAnalyzed: number;
  clusters: ClusterSummary[];
  proposals: ProposalSummary[];
  analyzedAt: number;
  message: string;
}

interface ClusterSummary {
  id: string;
  rootCause: string;
  patternDescription: string;
  problemStatement: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  escalationCount: number;
  triggerTypes: string[];
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

// ============================================================================
// In-Memory Job Tracking
// ============================================================================

// Track active jobs in memory for quick status checks
// Key: job ID, Value: promise that resolves when job completes
const activeJobPromises = new Map<string, Promise<void>>();

// ============================================================================
// Job Management
// ============================================================================

/**
 * Start a new analysis job in the background
 *
 * Returns the job ID immediately. The analysis runs asynchronously.
 * Use getJobStatus() to check progress.
 */
export function startBackgroundAnalysis(options: StartAnalysisOptions = {}): string {
  const {
    outcomeId,
    lookbackDays = 30,
    maxProposals = 5,
  } = options;

  // Create the job record in database
  const job = createAnalysisJob({
    outcome_id: outcomeId || null,
    job_type: 'improvement_analysis',
    progress_message: 'Queued for analysis...',
  });

  // Start the async analysis
  const jobPromise = runAnalysisJob(job.id, {
    outcomeId,
    lookbackDays,
    maxProposals,
  });

  // Track the promise for potential cleanup
  activeJobPromises.set(job.id, jobPromise);

  // Clean up tracking when done
  jobPromise.finally(() => {
    activeJobPromises.delete(job.id);
  });

  return job.id;
}

/**
 * Get the current status of a job
 */
export function getJobStatus(jobId: string): JobStatus | null {
  const job = getAnalysisJobById(jobId);
  if (!job) return null;

  let result: AnalysisResultSummary | null = null;
  if (job.result) {
    try {
      result = JSON.parse(job.result) as AnalysisResultSummary;
    } catch {
      // Invalid JSON, ignore
    }
  }

  return {
    id: job.id,
    status: job.status,
    progressMessage: job.progress_message,
    result,
    error: job.error,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  };
}

/**
 * Get all currently active (running or pending) jobs
 */
export function getActiveAnalysisJobs(): JobStatus[] {
  const jobs = getActiveJobs();
  return jobs.map(job => ({
    id: job.id,
    status: job.status,
    progressMessage: job.progress_message,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  }));
}

/**
 * Check if there's already a running analysis for the given outcome
 */
export function hasActiveAnalysis(outcomeId?: string): boolean {
  const jobs = getActiveJobs();
  return jobs.some(job => job.outcome_id === (outcomeId || null));
}

// ============================================================================
// Internal Job Execution
// ============================================================================

async function runAnalysisJob(
  jobId: string,
  options: {
    outcomeId?: string;
    lookbackDays: number;
    maxProposals: number;
  }
): Promise<void> {
  const { outcomeId, lookbackDays, maxProposals } = options;

  try {
    // Mark job as running
    startAnalysisJob(jobId, 'Initializing analysis...');

    // Get outcome name for activity logging
    let outcomeName: string | null = null;
    if (outcomeId) {
      const outcome = getOutcomeById(outcomeId);
      outcomeName = outcome?.name || null;
    }

    // Log analysis started
    logAnalysisStarted(outcomeId || null, outcomeName, lookbackDays);

    // Update progress
    updateJobProgress(jobId, `Fetching escalations from the last ${lookbackDays} days...`);

    // Run the actual analysis
    updateJobProgress(jobId, 'Analyzing escalation patterns with AI...');

    const result: AnalysisResult = await analyzeForImprovements({
      lookbackDays,
      outcomeId,
      autoCreateOutcomes: false, // Never auto-create in background jobs
      maxProposals,
    });

    // Format the result for storage
    const formattedResult: AnalysisResultSummary = {
      success: true,
      escalationsAnalyzed: result.escalationsAnalyzed,
      clusters: result.clusters.map(cluster => ({
        id: cluster.id,
        rootCause: cluster.rootCause,
        patternDescription: cluster.patternDescription,
        problemStatement: cluster.problemStatement,
        severity: cluster.severity,
        escalationCount: cluster.escalations.length,
        triggerTypes: Array.from(new Set(cluster.escalations.map(e => e.trigger_type))),
      })),
      proposals: result.proposals.map(proposal => ({
        clusterId: proposal.cluster.id,
        rootCause: proposal.cluster.rootCause,
        escalationCount: proposal.cluster.escalations.length,
        problemSummary: proposal.cluster.problemStatement,
        outcomeName: proposal.outcomeName,
        proposedTasks: proposal.tasks,
        intent: {
          summary: proposal.intent.summary,
          itemCount: proposal.intent.items.length,
          successCriteria: proposal.intent.success_criteria,
        },
        approach: {
          summary: proposal.approach.summary,
          stepCount: proposal.approach.steps.length,
          risks: proposal.approach.risks,
        },
      })),
      analyzedAt: result.analyzedAt,
      message: generateMessage(result),
    };

    // Log analysis completed
    logAnalysisCompleted(
      outcomeId || null,
      outcomeName,
      result.clusters.length,
      result.proposals.length,
      result.escalationsAnalyzed
    );

    // Complete the job with results
    completeAnalysisJob(jobId, JSON.stringify(formattedResult));

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Log analysis failed
    logAnalysisFailed(outcomeId || null, null, errorMessage);

    // Mark job as failed
    failAnalysisJob(jobId, errorMessage);

    console.error(`[AnalysisRunner] Job ${jobId} failed:`, error);
  }
}

function generateMessage(result: AnalysisResult): string {
  if (result.escalationsAnalyzed === 0) {
    return 'No escalations found for analysis. System is running smoothly or HOMЯ is not enabled.';
  }

  if (result.clusters.length === 0) {
    return `Analyzed ${result.escalationsAnalyzed} escalation(s) but no recurring patterns were identified.`;
  }

  if (result.proposals.length === 0) {
    return `Identified ${result.clusters.length} cluster(s) from ${result.escalationsAnalyzed} escalation(s), but could not generate improvement proposals.`;
  }

  return `Analyzed ${result.escalationsAnalyzed} escalation(s), identified ${result.clusters.length} pattern cluster(s), and generated ${result.proposals.length} improvement proposal(s).`;
}
