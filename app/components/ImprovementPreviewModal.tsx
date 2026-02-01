'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';

// ============================================================================
// Types
// ============================================================================

interface ProposedTask {
  title: string;
  description: string;
  priority: number;
}

interface ClusterSummary {
  id: string;
  rootCause: string;
  patternDescription: string;
  problemStatement: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  escalationCount: number;
  /** Unique trigger_types from escalations in this cluster */
  triggerTypes: string[];
}

interface ProposalSummary {
  clusterId: string;
  rootCause: string;
  escalationCount: number;
  problemSummary: string;
  outcomeName: string;
  proposedTasks: ProposedTask[];
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

interface CreateResponse {
  success: boolean;
  parent_outcome_id: string;
  created_outcomes: Array<{
    id: string;
    name: string;
    trigger_type: string;
    task_count: number;
  }>;
  message: string;
}

interface ImprovementPreviewModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  lookbackDays?: number;
  outcomeId?: string;
}

// ============================================================================
// Severity Configuration
// ============================================================================

const severityConfig: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  low: { label: 'Low', variant: 'default' },
  medium: { label: 'Medium', variant: 'info' },
  high: { label: 'High', variant: 'warning' },
  critical: { label: 'Critical', variant: 'error' },
};

// ============================================================================
// Component
// ============================================================================

export function ImprovementPreviewModal({
  onClose,
  onSuccess,
  lookbackDays = 30,
  outcomeId,
}: ImprovementPreviewModalProps): JSX.Element {
  const router = useRouter();
  const { toast } = useToast();

  // State
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalyzeResponse | null>(null);
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(new Set());
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  // Fetch analysis data on mount
  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        lookbackDays: lookbackDays.toString(),
        maxProposals: '5',
      });

      if (outcomeId) {
        params.set('outcomeId', outcomeId);
      }

      const response = await fetch(`/api/improvements/analyze?${params}`);
      const data = await response.json() as AnalyzeResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to analyze improvements');
      }

      setAnalysisData(data);

      // Auto-select high and critical severity clusters
      const autoSelected = new Set<string>();
      for (const cluster of data.clusters) {
        if (cluster.severity === 'high' || cluster.severity === 'critical') {
          autoSelected.add(cluster.id);
        }
      }
      setSelectedClusterIds(autoSelected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze escalation patterns');
    } finally {
      setLoading(false);
    }
  }, [lookbackDays, outcomeId]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  // Toggle cluster selection
  const toggleClusterSelection = (clusterId: string) => {
    setSelectedClusterIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(clusterId)) {
        newSet.delete(clusterId);
      } else {
        newSet.add(clusterId);
      }
      return newSet;
    });
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (analysisData) {
      if (selectedClusterIds.size === analysisData.clusters.length) {
        setSelectedClusterIds(new Set());
      } else {
        setSelectedClusterIds(new Set(analysisData.clusters.map(c => c.id)));
      }
    }
  };

  // Toggle expanded state for a cluster
  const toggleExpanded = (clusterId: string) => {
    setExpandedClusterId(prev => (prev === clusterId ? null : clusterId));
  };

  // Get proposal for a cluster
  const getProposalForCluster = (clusterId: string): ProposalSummary | undefined => {
    return analysisData?.proposals.find(p => p.clusterId === clusterId);
  };

  // Get all trigger types from selected clusters
  const getSelectedTriggerTypes = (): string[] => {
    const triggerTypes: string[] = [];
    for (const clusterId of Array.from(selectedClusterIds)) {
      const cluster = analysisData?.clusters.find(c => c.id === clusterId);
      if (cluster?.triggerTypes) {
        triggerTypes.push(...cluster.triggerTypes);
      }
    }
    // Return unique trigger types
    return Array.from(new Set(triggerTypes));
  };

  // Create individual outcomes for each selected cluster
  const handleCreateIndividualOutcomes = async () => {
    if (selectedClusterIds.size === 0) {
      toast({ type: 'warning', message: 'Please select at least one pattern' });
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const triggerTypes = getSelectedTriggerTypes();

      if (triggerTypes.length === 0) {
        throw new Error('No trigger types found for selected clusters');
      }

      const response = await fetch('/api/improvements/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_ids: triggerTypes }),
      });

      const data = await response.json() as CreateResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to create improvement outcomes');
      }

      toast({
        type: 'success',
        message: `Created ${data.created_outcomes.length} improvement outcome(s)`,
      });

      onSuccess?.();

      // Navigate to the parent outcome
      if (data.parent_outcome_id) {
        router.push(`/outcome/${data.parent_outcome_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create outcomes');
      toast({ type: 'error', message: 'Failed to create improvement outcomes' });
    } finally {
      setCreating(false);
    }
  };

  // Create one consolidated outcome combining all selected clusters
  const handleCreateConsolidatedOutcome = async () => {
    if (selectedClusterIds.size === 0) {
      toast({ type: 'warning', message: 'Please select at least one pattern' });
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // Gather all selected clusters and their proposals
      const selectedClusters = Array.from(selectedClusterIds)
        .map(id => analysisData?.clusters.find(c => c.id === id))
        .filter((c): c is ClusterSummary => c !== undefined);

      const selectedProposals = selectedClusters
        .map(c => analysisData?.proposals.find(p => p.clusterId === c.id))
        .filter((p): p is ProposalSummary => p !== undefined);

      const triggerTypes = getSelectedTriggerTypes();

      const response = await fetch('/api/improvements/create-consolidated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusters: selectedClusters,
          proposals: selectedProposals,
          trigger_types: triggerTypes,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to create consolidated outcome');
      }

      toast({
        type: 'success',
        message: 'Created consolidated improvement outcome',
      });

      onSuccess?.();

      // Navigate to the created outcome
      if (data.outcome_id) {
        router.push(`/outcome/${data.outcome_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create consolidated outcome');
      toast({ type: 'error', message: 'Failed to create consolidated outcome' });
    } finally {
      setCreating(false);
    }
  };

  // Render loading state
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <Card padding="lg" className="w-full max-w-3xl mx-4 shadow-xl">
          <CardHeader>
            <CardTitle>Analyzing Escalation Patterns...</CardTitle>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
            >
              ×
            </button>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-4">
                <svg
                  className="animate-spin h-8 w-8 text-accent"
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
                <p className="text-text-secondary text-sm">
                  Analyzing {lookbackDays} days of escalation data...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render error state
  if (error && !analysisData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <Card padding="lg" className="w-full max-w-3xl mx-4 shadow-xl">
          <CardHeader>
            <CardTitle>Analysis Error</CardTitle>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
            >
              ×
            </button>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-status-error">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <p className="text-text-primary text-center">{error}</p>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={onClose}>Close</Button>
                <Button variant="primary" onClick={fetchAnalysis}>Retry</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render empty state
  if (!analysisData || analysisData.clusters.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <Card padding="lg" className="w-full max-w-3xl mx-4 shadow-xl">
          <CardHeader>
            <CardTitle>Improvement Analysis</CardTitle>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
            >
              ×
            </button>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-text-tertiary">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12h8M12 8v8" />
                </svg>
              </div>
              <p className="text-text-secondary text-center">
                {analysisData?.message || 'No recurring patterns found in escalation data.'}
              </p>
              <p className="text-text-tertiary text-sm text-center">
                Analyzed {analysisData?.escalationsAnalyzed || 0} escalation(s) from the last {lookbackDays} days.
              </p>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render main modal with clusters
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card padding="lg" className="w-full max-w-3xl mx-4 shadow-xl max-h-[85vh] flex flex-col">
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>Improvement Proposals</CardTitle>
            <Badge variant="info" className="text-[10px]">
              {analysisData.clusters.length} pattern(s)
            </Badge>
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
          >
            ×
          </button>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden flex flex-col">
          {/* Summary */}
          <p className="text-text-secondary text-sm mb-4">
            {analysisData.message}
          </p>

          {/* Select all toggle */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={toggleSelectAll}
              className="text-sm text-text-secondary hover:text-text-primary flex items-center gap-2"
            >
              <span className={`w-4 h-4 border rounded flex items-center justify-center ${
                selectedClusterIds.size === analysisData.clusters.length
                  ? 'bg-accent border-accent'
                  : 'border-border'
              }`}>
                {selectedClusterIds.size === analysisData.clusters.length && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
                    <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {selectedClusterIds.size === analysisData.clusters.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-text-tertiary text-sm">
              {selectedClusterIds.size} of {analysisData.clusters.length} selected
            </span>
          </div>

          {/* Cluster List */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {analysisData.clusters.map(cluster => {
              const proposal = getProposalForCluster(cluster.id);
              const isSelected = selectedClusterIds.has(cluster.id);
              const isExpanded = expandedClusterId === cluster.id;
              const severity = severityConfig[cluster.severity] || severityConfig.low;

              return (
                <div
                  key={cluster.id}
                  className={`border rounded-lg overflow-hidden transition-colors ${
                    isSelected ? 'border-accent bg-accent/5' : 'border-border bg-bg-secondary'
                  }`}
                >
                  {/* Cluster Header */}
                  <div className="flex items-start gap-3 p-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleClusterSelection(cluster.id)}
                      className={`mt-0.5 w-5 h-5 border rounded flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? 'bg-accent border-accent' : 'border-border hover:border-text-tertiary'
                      }`}
                    >
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 12 12" fill="white">
                          <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    {/* Cluster Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-text-primary">
                          {proposal?.outcomeName || formatRootCause(cluster.rootCause)}
                        </span>
                        <Badge variant={severity.variant} className="text-[10px]">
                          {severity.label}
                        </Badge>
                        <span className="text-text-tertiary text-xs">
                          {cluster.escalationCount} escalation(s)
                        </span>
                      </div>
                      <p className="text-text-secondary text-sm line-clamp-2">
                        {cluster.problemStatement}
                      </p>

                      {/* Expand/Collapse button */}
                      <button
                        onClick={() => toggleExpanded(cluster.id)}
                        className="mt-2 text-xs text-accent hover:text-accent-hover flex items-center gap-1"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                          className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        >
                          <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                        </svg>
                        {isExpanded ? 'Hide details' : 'Show details'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && proposal && (
                    <div className="border-t border-border p-4 space-y-4 bg-bg-tertiary/50">
                      {/* Pattern Description */}
                      <div>
                        <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
                          Pattern
                        </h4>
                        <p className="text-text-secondary text-sm">
                          {cluster.patternDescription}
                        </p>
                      </div>

                      {/* Intent Summary */}
                      <div>
                        <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
                          What we&apos;ll build
                        </h4>
                        <p className="text-text-secondary text-sm">
                          {proposal.intent.summary}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {proposal.intent.successCriteria.slice(0, 3).map((criteria, i) => (
                            <span key={i} className="text-xs text-text-tertiary bg-bg-secondary px-2 py-0.5 rounded">
                              {criteria}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Approach Summary */}
                      <div>
                        <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
                          Approach
                        </h4>
                        <p className="text-text-secondary text-sm">
                          {proposal.approach.summary}
                        </p>
                        {proposal.approach.risks.length > 0 && (
                          <div className="mt-2">
                            <span className="text-xs text-status-warning">
                              Risks: {proposal.approach.risks.slice(0, 2).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Proposed Tasks */}
                      <div>
                        <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                          Proposed Tasks ({proposal.proposedTasks.length})
                        </h4>
                        <div className="space-y-2">
                          {proposal.proposedTasks.map((task, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-text-tertiary shrink-0">{i + 1}.</span>
                              <div>
                                <span className="text-text-primary">{task.title}</span>
                                <p className="text-text-tertiary text-xs mt-0.5 line-clamp-2">
                                  {task.description}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Escalation Evidence */}
                      <div>
                        <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                          Escalation Evidence
                        </h4>
                        <div className="text-xs text-text-tertiary space-y-1">
                          <p>Root cause: <span className="text-text-secondary">{cluster.rootCause}</span></p>
                          <p>Total occurrences: <span className="text-text-secondary">{cluster.escalationCount}</span></p>
                          <p>
                            Severity: <Badge variant={severity.variant} className="text-[10px] ml-1">{severity.label}</Badge>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error message */}
          {error && (
            <p className="text-status-error text-sm mt-3">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
            <span className="text-text-tertiary text-sm">
              {selectedClusterIds.size > 0
                ? `${selectedClusterIds.size} pattern(s) selected`
                : 'Select patterns to create improvement outcomes'}
            </span>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onClose} disabled={creating}>
                Cancel
              </Button>
              {selectedClusterIds.size > 1 && (
                <Button
                  variant="secondary"
                  onClick={handleCreateConsolidatedOutcome}
                  disabled={creating || selectedClusterIds.size === 0}
                  title="Merge all selected patterns into one outcome"
                >
                  {creating ? 'Creating...' : 'Create 1 Consolidated'}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleCreateIndividualOutcomes}
                disabled={creating || selectedClusterIds.size === 0}
                title="Create separate outcomes for each pattern"
              >
                {creating ? 'Creating...' : `Create ${selectedClusterIds.size} Individual`}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format root cause string for display (e.g., 'unclear_requirement' -> 'Unclear Requirement')
 */
function formatRootCause(rootCause: string): string {
  return rootCause
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
