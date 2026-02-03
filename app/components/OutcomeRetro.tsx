'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';

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

interface AnalyzeResponse {
  success: boolean;
  escalationsAnalyzed: number;
  clusters: ClusterSummary[];
  proposals: ProposalSummary[];
  outcomesCreated?: Array<{ id: string; name: string }>;
  analyzedAt: number;
  message: string;
}

interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progressMessage: string | null;
  result?: AnalyzeResponse | null;
  error?: string | null;
}

type TimeRange = 'today' | 'last7' | 'last14' | 'last30' | 'alltime';

const TIME_RANGES: { value: TimeRange; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 1 },
  { value: 'last7', label: 'Last 7 days', days: 7 },
  { value: 'last14', label: 'Last 14 days', days: 14 },
  { value: 'last30', label: 'Last 30 days', days: 30 },
  { value: 'alltime', label: 'All Time', days: 365 }, // Use 365 as "all time"
];

const POLL_INTERVAL = 2000; // 2 seconds

interface OutcomeRetroProps {
  outcomeId: string;
  onOutcomeCreated?: (outcome: { id: string; name: string }) => void;
}

export function OutcomeRetro({ outcomeId, onOutcomeCreated }: OutcomeRetroProps): JSX.Element {
  const { toast } = useToast();
  const [timeRange, setTimeRange] = useState<TimeRange>('alltime');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingOutcome, setCreatingOutcome] = useState<string | null>(null);

  // Background job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const selectedRange = TIME_RANGES.find(r => r.value === timeRange)!;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Poll for job status
  const pollJobStatus = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/improvements/jobs/${id}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to get job status');
      }

      const job = data.job as JobStatus;
      setProgressMessage(job.progressMessage);

      if (job.status === 'completed' && job.result) {
        // Job finished successfully
        setResult(job.result);
        setLoading(false);
        setJobId(null);
        setProgressMessage(null);

        // Stop polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        toast({
          type: 'success',
          message: `Analysis complete: ${job.result.clusters.length} pattern(s) found`,
        });
      } else if (job.status === 'failed') {
        // Job failed
        setError(job.error || 'Analysis failed');
        setLoading(false);
        setJobId(null);
        setProgressMessage(null);

        // Stop polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        toast({
          type: 'error',
          message: 'Analysis failed. Please try again.',
        });
      }
    } catch (err) {
      console.error('Error polling job status:', err);
    }
  }, [toast]);

  async function runAnalysis(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgressMessage('Starting analysis...');

    try {
      // Use POST endpoint to start background job
      const response = await fetch('/api/improvements/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcomeId,
          lookbackDays: selectedRange.days,
          maxProposals: 3,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to start analysis');
      }

      setJobId(data.jobId);
      setProgressMessage('Queued for analysis...');

      // Start polling
      pollIntervalRef.current = setInterval(() => {
        pollJobStatus(data.jobId);
      }, POLL_INTERVAL);

      // Initial poll after short delay
      setTimeout(() => pollJobStatus(data.jobId), 500);

      toast({
        type: 'info',
        message: 'Analysis started. You can navigate away - results will appear when ready.',
        duration: 5000,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setLoading(false);
      setProgressMessage(null);
    }
  }

  async function createOutcomeFromProposal(proposal: ProposalSummary): Promise<void> {
    setCreatingOutcome(proposal.clusterId);

    try {
      const res = await fetch('/api/improvements/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cluster: {
            id: proposal.clusterId,
            rootCause: proposal.rootCause,
            patternDescription: proposal.problemSummary,
            problemStatement: proposal.problemSummary,
            severity: 'medium',
            triggerTypes: [],
          },
          proposal: {
            outcomeName: proposal.outcomeName,
            intent: proposal.intent,
            approach: proposal.approach,
            tasks: proposal.proposedTasks,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create outcome');
      }

      if (onOutcomeCreated && data.outcome) {
        onOutcomeCreated(data.outcome);
      }

      // Update the result to show the outcome was created
      if (result) {
        setResult({
          ...result,
          outcomesCreated: [...(result.outcomesCreated || []), data.outcome],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create outcome');
    } finally {
      setCreatingOutcome(null);
    }
  }

  const severityColors: Record<string, string> = {
    critical: 'text-status-error',
    high: 'text-status-warning',
    medium: 'text-status-info',
    low: 'text-text-tertiary',
  };

  return (
    <div className="border-t border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-text-primary text-sm">Run Retro</h3>
        <Badge variant="default">Beta</Badge>
      </div>

      <p className="text-xs text-text-tertiary mb-3">
        Analyze escalations from this outcome to identify patterns and generate improvement proposals.
      </p>

      {/* Controls */}
      <div className="flex gap-2 mb-4">
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          disabled={loading}
        >
          {TIME_RANGES.map((range) => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
        <Button
          onClick={runAnalysis}
          disabled={loading}
          size="sm"
        >
          {loading ? 'Running...' : 'Analyze'}
        </Button>
      </div>

      {/* Progress indicator */}
      {loading && progressMessage && (
        <div className="mb-4 p-3 bg-bg-secondary rounded-md border border-border">
          <div className="flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4 text-accent"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm text-text-secondary">{progressMessage}</span>
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            You can navigate away. Results will appear when ready.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 mb-4 bg-status-error/10 border border-status-error/20 rounded-md">
          <p className="text-sm text-status-error">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="p-3 bg-bg-secondary rounded-md">
            <p className="text-sm text-text-secondary">{result.message}</p>
            <p className="text-xs text-text-tertiary mt-1">
              {result.escalationsAnalyzed} escalation(s) analyzed
            </p>
          </div>

          {/* Proposals */}
          {result.proposals.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-text-primary">Improvement Proposals</h4>
              {result.proposals.map((proposal) => {
                const cluster = result.clusters.find(c => c.id === proposal.clusterId);
                const wasCreated = result.outcomesCreated?.some(
                  o => o.name === proposal.outcomeName
                );

                return (
                  <div
                    key={proposal.clusterId}
                    className="p-3 border border-border rounded-md bg-bg-primary"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h5 className="font-medium text-text-primary text-sm">
                          {proposal.outcomeName}
                        </h5>
                        <p className="text-xs text-text-tertiary">
                          {proposal.escalationCount} escalation(s) &bull;{' '}
                          <span className={cluster ? severityColors[cluster.severity] : ''}>
                            {cluster?.severity || 'medium'} severity
                          </span>
                        </p>
                      </div>
                      {wasCreated ? (
                        <Badge variant="success">Created</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => createOutcomeFromProposal(proposal)}
                          disabled={creatingOutcome === proposal.clusterId}
                        >
                          {creatingOutcome === proposal.clusterId ? 'Creating...' : 'Create'}
                        </Button>
                      )}
                    </div>

                    <p className="text-sm text-text-secondary mb-2">
                      {proposal.intent.summary}
                    </p>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-text-tertiary hover:text-text-secondary">
                        {proposal.proposedTasks.length} task(s), {proposal.approach.stepCount} step(s)
                      </summary>
                      <div className="mt-2 pl-3 border-l-2 border-border space-y-1">
                        {proposal.proposedTasks.map((task, i) => (
                          <p key={i} className="text-text-tertiary">
                            {i + 1}. {task.title}
                          </p>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          )}

          {/* No proposals message */}
          {result.proposals.length === 0 && result.escalationsAnalyzed > 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-text-secondary">No recurring patterns found</p>
              <p className="text-xs text-text-tertiary">
                Escalations may be unique issues rather than systematic problems
              </p>
            </div>
          )}

          {/* No escalations message */}
          {result.escalationsAnalyzed === 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-text-secondary">No escalations found</p>
              <p className="text-xs text-text-tertiary">
                This outcome hasn&apos;t had any HOMЯ escalations in the selected time range
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
