'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';

// ============================================================================
// Types
// ============================================================================

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

// Action types for each pattern
type PatternAction = 'standalone' | 'skip' | string; // string for group IDs like 'group-a'

interface GroupInfo {
  id: string;
  label: string;
}

type TimeRange = 'today' | 'last7' | 'last14' | 'last30' | 'alltime';

const TIME_RANGES: { value: TimeRange; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 1 },
  { value: 'last7', label: 'Last 7 days', days: 7 },
  { value: 'last14', label: 'Last 14 days', days: 14 },
  { value: 'last30', label: 'Last 30 days', days: 30 },
  { value: 'alltime', label: 'All Time', days: 365 },
];

const POLL_INTERVAL = 2000;

const SEVERITY_CONFIG: Record<string, { icon: string; color: string; badge: 'default' | 'info' | 'warning' | 'error' }> = {
  low: { icon: '○', color: 'text-text-tertiary', badge: 'default' },
  medium: { icon: '◐', color: 'text-status-info', badge: 'info' },
  high: { icon: '◉', color: 'text-status-warning', badge: 'warning' },
  critical: { icon: '●', color: 'text-status-error', badge: 'error' },
};

// ============================================================================
// Component
// ============================================================================

interface OutcomeRetroProps {
  outcomeId: string;
  onOutcomeCreated?: (outcome: { id: string; name: string }) => void;
}

export function OutcomeRetro({ outcomeId, onOutcomeCreated }: OutcomeRetroProps): JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  // Analysis state
  const [timeRange, setTimeRange] = useState<TimeRange>('alltime');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Background job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Grouping state
  const [patternActions, setPatternActions] = useState<Record<string, PatternAction>>({});
  const [groups, setGroups] = useState<GroupInfo[]>([
    { id: 'group-a', label: 'Group A' },
  ]);
  const [creating, setCreating] = useState(false);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);

  const selectedRange = TIME_RANGES.find(r => r.value === timeRange)!;

  // Initialize pattern actions when result changes
  useEffect(() => {
    if (result?.proposals) {
      const initialActions: Record<string, PatternAction> = {};
      result.proposals.forEach(p => {
        // Default: high/critical severity = standalone, others = skip
        const cluster = result.clusters.find(c => c.id === p.clusterId);
        if (cluster?.severity === 'high' || cluster?.severity === 'critical') {
          initialActions[p.clusterId] = 'standalone';
        } else {
          initialActions[p.clusterId] = 'standalone'; // Default to standalone for all
        }
      });
      setPatternActions(initialActions);
    }
  }, [result]);

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
        setResult(job.result);
        setLoading(false);
        setJobId(null);
        setProgressMessage(null);

        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        toast({
          type: 'success',
          message: `Analysis complete: ${job.result.clusters.length} pattern(s) found`,
        });
      } else if (job.status === 'failed') {
        setError(job.error || 'Analysis failed');
        setLoading(false);
        setJobId(null);
        setProgressMessage(null);

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

  // Start analysis
  async function runAnalysis(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);
    setPatternActions({});
    setProgressMessage('Starting analysis...');

    try {
      const response = await fetch('/api/improvements/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcomeId,
          lookbackDays: selectedRange.days,
          maxProposals: 5,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to start analysis');
      }

      setJobId(data.jobId);
      setProgressMessage('Queued for analysis...');

      pollIntervalRef.current = setInterval(() => {
        pollJobStatus(data.jobId);
      }, POLL_INTERVAL);

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

  // Update pattern action
  const setPatternAction = (clusterId: string, action: PatternAction) => {
    setPatternActions(prev => ({ ...prev, [clusterId]: action }));
  };

  // Add new group
  const addNewGroup = () => {
    const nextLetter = String.fromCharCode(65 + groups.length); // A, B, C...
    const newGroup: GroupInfo = {
      id: `group-${nextLetter.toLowerCase()}`,
      label: `Group ${nextLetter}`,
    };
    setGroups(prev => [...prev, newGroup]);
    return newGroup.id;
  };

  // Compute summary of what will be created
  const creationSummary = useMemo(() => {
    if (!result?.proposals) return { standalone: [], grouped: {}, skipped: [], totalOutcomes: 0 };

    const standalone: ProposalSummary[] = [];
    const grouped: Record<string, ProposalSummary[]> = {};
    const skipped: ProposalSummary[] = [];

    result.proposals.forEach(proposal => {
      const action = patternActions[proposal.clusterId] || 'standalone';

      if (action === 'standalone') {
        standalone.push(proposal);
      } else if (action === 'skip') {
        skipped.push(proposal);
      } else {
        // It's a group
        if (!grouped[action]) {
          grouped[action] = [];
        }
        grouped[action].push(proposal);
      }
    });

    const totalOutcomes = standalone.length + Object.keys(grouped).filter(g => grouped[g].length > 0).length;

    return { standalone, grouped, skipped, totalOutcomes };
  }, [result?.proposals, patternActions]);

  // Create outcomes based on configuration
  async function createOutcomes(): Promise<void> {
    if (creationSummary.totalOutcomes === 0) {
      toast({ type: 'warning', message: 'No patterns selected for creation' });
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const createdOutcomes: Array<{ id: string; name: string }> = [];

      // Create standalone outcomes
      for (const proposal of creationSummary.standalone) {
        const res = await fetch('/api/improvements/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cluster: {
              id: proposal.clusterId,
              rootCause: proposal.rootCause,
              patternDescription: proposal.problemSummary,
              problemStatement: proposal.problemSummary,
              severity: result?.clusters.find(c => c.id === proposal.clusterId)?.severity || 'medium',
              triggerTypes: result?.clusters.find(c => c.id === proposal.clusterId)?.triggerTypes || [],
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
          throw new Error(data.error || `Failed to create outcome: ${proposal.outcomeName}`);
        }
        if (data.outcome) {
          createdOutcomes.push(data.outcome);
        }
      }

      // Create grouped outcomes
      for (const [groupId, proposals] of Object.entries(creationSummary.grouped)) {
        if (proposals.length === 0) continue;

        const groupLabel = groups.find(g => g.id === groupId)?.label || groupId;

        // Get clusters and trigger types for all proposals in this group
        const groupClusters = proposals.map(p => {
          const cluster = result?.clusters.find(c => c.id === p.clusterId);
          return {
            id: p.clusterId,
            rootCause: p.rootCause,
            patternDescription: p.problemSummary,
            problemStatement: p.problemSummary,
            severity: cluster?.severity || 'medium',
            triggerTypes: cluster?.triggerTypes || [],
          };
        });

        const groupTriggerTypes = Array.from(
          new Set(groupClusters.flatMap(c => c.triggerTypes))
        );

        const res = await fetch('/api/improvements/create-consolidated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusters: groupClusters,
            proposals: proposals.map(p => ({
              clusterId: p.clusterId,
              rootCause: p.rootCause,
              escalationCount: p.escalationCount,
              problemSummary: p.problemSummary,
              outcomeName: p.outcomeName,
              proposedTasks: p.proposedTasks,
              intent: p.intent,
              approach: p.approach,
            })),
            trigger_types: groupTriggerTypes,
            group_name: proposals.length > 1
              ? `Combined Improvements (${groupLabel})`
              : proposals[0].outcomeName,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Failed to create grouped outcome for ${groupLabel}`);
        }
        if (data.outcome_id) {
          createdOutcomes.push({ id: data.outcome_id, name: data.outcome_name || groupLabel });
        }
      }

      // Update result to show created outcomes
      if (result) {
        setResult({
          ...result,
          outcomesCreated: [...(result.outcomesCreated || []), ...createdOutcomes],
        });
      }

      toast({
        type: 'success',
        message: `Created ${createdOutcomes.length} improvement outcome(s)`,
      });

      // Notify parent and navigate to first created outcome
      if (createdOutcomes.length > 0) {
        if (onOutcomeCreated) {
          onOutcomeCreated(createdOutcomes[0]);
        }
        router.push(`/outcome/${createdOutcomes[0].id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create outcomes');
      toast({ type: 'error', message: 'Failed to create some outcomes' });
    } finally {
      setCreating(false);
    }
  }

  // Check if all patterns have been created
  const allCreated = result?.proposals?.every(p =>
    result.outcomesCreated?.some(o => o.name === p.outcomeName)
  );

  return (
    <div className="border-t border-border p-4">
      {/* Header */}
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
        <Button onClick={runAnalysis} disabled={loading} size="sm">
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

      {/* Results with Flexible Grouping */}
      {result && (
        <div className="space-y-4">
          {/* Summary header */}
          <div className="p-3 bg-bg-secondary rounded-md">
            <p className="text-sm text-text-secondary">{result.message}</p>
            <p className="text-xs text-text-tertiary mt-1">
              {result.escalationsAnalyzed} escalation(s) analyzed
            </p>
          </div>

          {/* Patterns with action dropdowns */}
          {result.proposals.length > 0 && !allCreated && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-text-primary">
                  Improvement Proposals
                </h4>
                <span className="text-xs text-text-tertiary">
                  Choose how to organize each pattern
                </span>
              </div>

              {result.proposals.map((proposal) => {
                const cluster = result.clusters.find(c => c.id === proposal.clusterId);
                const severity = SEVERITY_CONFIG[cluster?.severity || 'medium'];
                const action = patternActions[proposal.clusterId] || 'standalone';
                const isExpanded = expandedPatternId === proposal.clusterId;
                const wasCreated = result.outcomesCreated?.some(o => o.name === proposal.outcomeName);

                if (wasCreated) {
                  return (
                    <div
                      key={proposal.clusterId}
                      className="p-3 border border-status-success/30 rounded-md bg-status-success/5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">{proposal.outcomeName}</span>
                        <Badge variant="success">Created</Badge>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={proposal.clusterId}
                    className={`border rounded-md transition-colors ${
                      action === 'skip'
                        ? 'border-border/50 bg-bg-secondary/50 opacity-60'
                        : 'border-border bg-bg-primary'
                    }`}
                  >
                    {/* Pattern header */}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={severity.color}>{severity.icon}</span>
                            <h5 className="font-medium text-text-primary text-sm truncate">
                              {proposal.outcomeName}
                            </h5>
                          </div>
                          <p className="text-xs text-text-tertiary">
                            {proposal.escalationCount} escalation(s) • {proposal.proposedTasks.length} task(s)
                          </p>
                        </div>

                        {/* Action dropdown */}
                        <select
                          value={action}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === 'new-group') {
                              const newGroupId = addNewGroup();
                              setPatternAction(proposal.clusterId, newGroupId);
                            } else {
                              setPatternAction(proposal.clusterId, value as PatternAction);
                            }
                          }}
                          className="px-2 py-1 text-xs border border-border rounded bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-accent min-w-[100px]"
                        >
                          <option value="standalone">Standalone</option>
                          {groups.map(group => (
                            <option key={group.id} value={group.id}>{group.label}</option>
                          ))}
                          <option value="new-group">+ New Group</option>
                          <option value="skip">Skip</option>
                        </select>
                      </div>

                      <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                        {proposal.intent.summary}
                      </p>

                      {/* Expand/collapse */}
                      <button
                        onClick={() => setExpandedPatternId(isExpanded ? null : proposal.clusterId)}
                        className="text-xs text-accent hover:text-accent-hover flex items-center gap-1"
                      >
                        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {isExpanded ? 'Hide details' : 'Show details'}
                      </button>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-border p-3 bg-bg-secondary/50 space-y-3">
                        <div>
                          <h6 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
                            Problem
                          </h6>
                          <p className="text-sm text-text-secondary">{proposal.problemSummary}</p>
                        </div>
                        <div>
                          <h6 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
                            Proposed Tasks
                          </h6>
                          <div className="space-y-1">
                            {proposal.proposedTasks.map((task, i) => (
                              <p key={i} className="text-xs text-text-tertiary">
                                {i + 1}. {task.title}
                              </p>
                            ))}
                          </div>
                        </div>
                        {proposal.approach.risks.length > 0 && (
                          <div>
                            <h6 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
                              Risks
                            </h6>
                            <p className="text-xs text-status-warning">
                              {proposal.approach.risks.slice(0, 2).join(', ')}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Creation Summary */}
          {result.proposals.length > 0 && !allCreated && creationSummary.totalOutcomes > 0 && (
            <div className="p-3 bg-bg-tertiary rounded-md border border-border">
              <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Will Create
              </h4>
              <div className="space-y-2 text-sm">
                {/* Standalone outcomes */}
                {creationSummary.standalone.map((p, i) => (
                  <div key={p.clusterId} className="flex items-center gap-2 text-text-secondary">
                    <span className="text-accent">•</span>
                    <span className="truncate">{p.outcomeName}</span>
                    <Badge variant="default" size="sm">{p.proposedTasks.length} tasks</Badge>
                  </div>
                ))}

                {/* Grouped outcomes */}
                {Object.entries(creationSummary.grouped).map(([groupId, proposals]) => {
                  if (proposals.length === 0) return null;
                  const groupLabel = groups.find(g => g.id === groupId)?.label || groupId;
                  const totalTasks = proposals.reduce((sum, p) => sum + p.proposedTasks.length, 0);

                  return (
                    <div key={groupId} className="flex items-center gap-2 text-text-secondary">
                      <span className="text-accent">•</span>
                      <span className="truncate">
                        {proposals.length === 1
                          ? proposals[0].outcomeName
                          : `Combined: ${proposals.map(p => p.outcomeName.split(' ')[0]).join(' + ')}`
                        }
                      </span>
                      <Badge variant="info" size="sm">{groupLabel}</Badge>
                      <Badge variant="default" size="sm">{totalTasks} tasks</Badge>
                    </div>
                  );
                })}
              </div>

              {creationSummary.skipped.length > 0 && (
                <p className="text-xs text-text-tertiary mt-2">
                  Skipping {creationSummary.skipped.length} pattern(s)
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          {result.proposals.length > 0 && !allCreated && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-text-tertiary">
                {creationSummary.totalOutcomes} outcome(s) will be created
              </span>
              <Button
                onClick={createOutcomes}
                disabled={creating || creationSummary.totalOutcomes === 0}
                size="sm"
              >
                {creating ? 'Creating...' : `Create ${creationSummary.totalOutcomes} Outcome(s)`}
              </Button>
            </div>
          )}

          {/* All created message */}
          {allCreated && result.proposals.length > 0 && (
            <div className="text-center py-4 bg-status-success/5 rounded-md border border-status-success/20">
              <p className="text-sm text-status-success font-medium">All improvements created!</p>
              <p className="text-xs text-text-tertiary mt-1">
                Check your outcomes list to see the new improvement outcomes.
              </p>
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
