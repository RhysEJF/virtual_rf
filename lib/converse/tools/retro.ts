/**
 * Retrospective Analysis Tools for Converse Agent
 *
 * Tools for triggering, monitoring, and acting on retrospective analyses.
 */

import { getAnalysisJobById, getRecentJobs } from '@/lib/db/analysis-jobs';
import { getOutcomeById } from '@/lib/db/outcomes';

// Types for API responses
interface AnalyzeResponse {
  success: boolean;
  jobId: string;
  status: 'pending';
  message: string;
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

// ============================================================================
// Tool: triggerRetroAnalysis
// ============================================================================

export interface TriggerRetroAnalysisArgs {
  outcome_id: string;
}

export interface TriggerRetroAnalysisResult {
  success: boolean;
  jobId?: string;
  outcomeName?: string;
  message: string;
}

export async function triggerRetroAnalysis(
  args: TriggerRetroAnalysisArgs
): Promise<TriggerRetroAnalysisResult> {
  const { outcome_id } = args;

  // Validate outcome exists
  const outcome = getOutcomeById(outcome_id);
  if (!outcome) {
    return {
      success: false,
      message: `Outcome not found: ${outcome_id}`,
    };
  }

  try {
    // Call the analyze API
    const response = await fetch('http://localhost:3000/api/improvements/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcomeId: outcome_id }),
    });

    if (!response.ok) {
      if (response.status === 409) {
        return {
          success: false,
          message: 'An analysis is already running for this outcome. Please wait for it to complete.',
        };
      }
      const error = await response.json();
      return {
        success: false,
        message: error.error || 'Failed to start analysis',
      };
    }

    const data = (await response.json()) as AnalyzeResponse;

    return {
      success: true,
      jobId: data.jobId,
      outcomeName: outcome.name,
      message: `Retrospective analysis started for "${outcome.name}". Use getRetroJobStatus to check progress.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to trigger analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// Tool: getRetroJobStatus
// ============================================================================

export interface GetRetroJobStatusArgs {
  job_id: string;
}

export interface GetRetroJobStatusResult {
  success: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  progressMessage?: string;
  completedAt?: number;
  message: string;
}

export async function getRetroJobStatus(
  args: GetRetroJobStatusArgs
): Promise<GetRetroJobStatusResult> {
  const { job_id } = args;

  const job = getAnalysisJobById(job_id);
  if (!job) {
    return {
      success: false,
      message: `Job not found: ${job_id}`,
    };
  }

  return {
    success: true,
    status: job.status as 'pending' | 'running' | 'completed' | 'failed',
    progressMessage: job.progress_message || undefined,
    completedAt: job.completed_at || undefined,
    message:
      job.status === 'completed'
        ? 'Analysis complete. Use getRetroJobDetails to see proposals.'
        : job.status === 'failed'
          ? `Analysis failed: ${job.error || 'Unknown error'}`
          : `Analysis ${job.status}: ${job.progress_message || 'Processing...'}`,
  };
}

// ============================================================================
// Tool: getRetroJobDetails
// ============================================================================

export interface GetRetroJobDetailsArgs {
  job_id: string;
}

export interface RetroProposal {
  number: number;
  outcomeName: string;
  rootCause: string;
  escalationCount: number;
  taskCount: number;
  problemSummary: string;
}

export interface GetRetroJobDetailsResult {
  success: boolean;
  status?: string;
  escalationsAnalyzed?: number;
  proposals?: RetroProposal[];
  message: string;
}

export async function getRetroJobDetails(
  args: GetRetroJobDetailsArgs
): Promise<GetRetroJobDetailsResult> {
  const { job_id } = args;

  const job = getAnalysisJobById(job_id);
  if (!job) {
    return {
      success: false,
      message: `Job not found: ${job_id}`,
    };
  }

  if (job.status !== 'completed') {
    return {
      success: false,
      status: job.status,
      message:
        job.status === 'failed'
          ? `Analysis failed: ${job.error || 'Unknown error'}`
          : `Analysis still ${job.status}. Wait for completion.`,
    };
  }

  if (!job.result) {
    return {
      success: false,
      status: 'completed',
      message: 'Analysis completed but no results found.',
    };
  }

  let result: AnalysisResultSummary;
  try {
    result = JSON.parse(job.result) as AnalysisResultSummary;
  } catch {
    return {
      success: false,
      message: 'Failed to parse analysis results.',
    };
  }

  const proposals: RetroProposal[] = (result.proposals || []).map((p, index) => ({
    number: index + 1,
    outcomeName: p.outcomeName,
    rootCause: p.rootCause,
    escalationCount: p.escalationCount,
    taskCount: p.proposedTasks?.length || 0,
    problemSummary: p.problemSummary,
  }));

  return {
    success: true,
    status: 'completed',
    escalationsAnalyzed: result.escalationsAnalyzed,
    proposals,
    message:
      proposals.length > 0
        ? `Found ${proposals.length} improvement proposal(s) from ${result.escalationsAnalyzed} escalations.`
        : result.message || 'No actionable improvement proposals found.',
  };
}

// ============================================================================
// Tool: listRecentRetroJobs
// ============================================================================

export interface ListRecentRetroJobsArgs {
  limit?: number;
}

export interface RecentRetroJob {
  id: string;
  outcomeId: string | null;
  status: string;
  proposalCount: number | null;
  escalationsAnalyzed: number | null;
  createdAt: number;
  completedAt: number | null;
}

export interface ListRecentRetroJobsResult {
  success: boolean;
  jobs: RecentRetroJob[];
  message: string;
}

export async function listRecentRetroJobs(
  args: ListRecentRetroJobsArgs
): Promise<ListRecentRetroJobsResult> {
  const limit = args.limit || 10;

  const jobs = getRecentJobs(limit);

  const formattedJobs: RecentRetroJob[] = jobs.map((job) => {
    let proposalCount: number | null = null;
    let escalationsAnalyzed: number | null = null;

    if (job.result) {
      try {
        const result = JSON.parse(job.result) as AnalysisResultSummary;
        proposalCount = result.proposals?.length || 0;
        escalationsAnalyzed = result.escalationsAnalyzed;
      } catch {
        // Ignore parse errors
      }
    }

    return {
      id: job.id,
      outcomeId: job.outcome_id,
      status: job.status,
      proposalCount,
      escalationsAnalyzed,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    };
  });

  return {
    success: true,
    jobs: formattedJobs,
    message:
      formattedJobs.length > 0
        ? `Found ${formattedJobs.length} recent analysis job(s).`
        : 'No recent analysis jobs found.',
  };
}

// ============================================================================
// Tool: createFromRetroProposal
// ============================================================================

export interface CreateFromRetroProposalArgs {
  job_id: string;
  proposal_number?: number;
  consolidated?: string;
  start_worker?: boolean;
}

export interface CreateFromRetroProposalResult {
  success: boolean;
  outcomes?: Array<{
    id: string;
    name: string;
    taskCount: number;
  }>;
  workerId?: string;
  message: string;
}

export async function createFromRetroProposal(
  args: CreateFromRetroProposalArgs
): Promise<CreateFromRetroProposalResult> {
  const { job_id, proposal_number, consolidated, start_worker } = args;

  // Get the job and parse results
  const job = getAnalysisJobById(job_id);
  if (!job) {
    return {
      success: false,
      message: `Job not found: ${job_id}`,
    };
  }

  if (job.status !== 'completed' || !job.result) {
    return {
      success: false,
      message: 'Job is not completed or has no results.',
    };
  }

  let result: AnalysisResultSummary;
  try {
    result = JSON.parse(job.result) as AnalysisResultSummary;
  } catch {
    return {
      success: false,
      message: 'Failed to parse analysis results.',
    };
  }

  if (!result.proposals || result.proposals.length === 0) {
    return {
      success: false,
      message: 'No proposals found in this job.',
    };
  }

  // Determine which proposals to use
  let selectedProposals: ProposalSummary[];
  let isConsolidated = false;

  if (consolidated) {
    isConsolidated = true;
    const numbers = consolidated.split(',').map((n) => parseInt(n.trim(), 10));
    const invalid = numbers.filter((n) => isNaN(n) || n < 1 || n > result.proposals.length);

    if (invalid.length > 0) {
      return {
        success: false,
        message: `Invalid proposal numbers: ${invalid.join(', ')}. Valid range: 1-${result.proposals.length}`,
      };
    }

    selectedProposals = numbers.map((n) => result.proposals[n - 1]);
  } else if (proposal_number !== undefined) {
    if (proposal_number < 1 || proposal_number > result.proposals.length) {
      return {
        success: false,
        message: `Invalid proposal number: ${proposal_number}. Valid range: 1-${result.proposals.length}`,
      };
    }
    selectedProposals = [result.proposals[proposal_number - 1]];
  } else {
    return {
      success: false,
      message: 'Please specify proposal_number or consolidated.',
    };
  }

  // Call the create API
  try {
    const response = await fetch('http://localhost:3000/api/improvements/create-from-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposals: selectedProposals,
        consolidated: isConsolidated,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        message: error.error || 'Failed to create outcomes',
      };
    }

    const createResult = (await response.json()) as CreateFromProposalsResponse;

    // Optionally start a worker
    let workerId: string | undefined;
    if (start_worker && createResult.outcomes.length > 0) {
      const outcomeId = createResult.outcomes[0].id;
      try {
        const workerResponse = await fetch(
          `http://localhost:3000/api/outcomes/${outcomeId}/workers`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }
        );

        if (workerResponse.ok) {
          const workerData = await workerResponse.json();
          workerId = workerData.worker?.id;
        }
      } catch {
        // Worker start failed, but outcome was created
      }
    }

    const outcomesSummary = createResult.outcomes.map((o) => ({
      id: o.id,
      name: o.name,
      taskCount: o.taskCount,
    }));

    let message = isConsolidated
      ? `Created consolidated outcome "${outcomesSummary[0]?.name}" with ${outcomesSummary[0]?.taskCount} tasks.`
      : `Created ${outcomesSummary.length} outcome(s).`;

    if (workerId) {
      message += ` Worker started (${workerId}).`;
    }

    return {
      success: true,
      outcomes: outcomesSummary,
      workerId,
      message,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create outcomes: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
