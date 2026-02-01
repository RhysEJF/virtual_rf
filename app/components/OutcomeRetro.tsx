'use client';

import { useState } from 'react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

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

type TimeRange = 'today' | 'last7' | 'last14' | 'last30' | 'alltime';

const TIME_RANGES: { value: TimeRange; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 1 },
  { value: 'last7', label: 'Last 7 days', days: 7 },
  { value: 'last14', label: 'Last 14 days', days: 14 },
  { value: 'last30', label: 'Last 30 days', days: 30 },
  { value: 'alltime', label: 'All Time', days: 365 }, // Use 365 as "all time"
];

interface OutcomeRetroProps {
  outcomeId: string;
  onOutcomeCreated?: (outcome: { id: string; name: string }) => void;
}

export function OutcomeRetro({ outcomeId, onOutcomeCreated }: OutcomeRetroProps): JSX.Element {
  const [timeRange, setTimeRange] = useState<TimeRange>('alltime');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingOutcome, setCreatingOutcome] = useState<string | null>(null);

  const selectedRange = TIME_RANGES.find(r => r.value === timeRange)!;

  async function runAnalysis(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const params = new URLSearchParams({
        outcomeId,
        lookbackDays: String(selectedRange.days),
        maxProposals: '3',
      });

      const res = await fetch(`/api/improvements/analyze?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
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
          {loading ? 'Analyzing...' : 'Analyze'}
        </Button>
      </div>

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
