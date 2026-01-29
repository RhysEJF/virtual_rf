'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { ProgressEntry } from '@/lib/db/schema';

interface WorkerProgress {
  workerId: string;
  workerName: string;
  workerStatus: string;
  entries: ProgressEntry[];
  stats: {
    total: number;
    compacted: number;
    uncompacted: number;
  };
}

interface ProgressViewProps {
  outcomeId: string;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'running':
      return <Badge variant="success">Running</Badge>;
    case 'completed':
      return <Badge variant="default">Completed</Badge>;
    case 'failed':
      return <Badge variant="error">Failed</Badge>;
    case 'paused':
      return <Badge variant="warning">Paused</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

// Parse iteration content to extract structured info
function parseIterationContent(content: string): {
  status: 'completed' | 'failed' | 'in_progress' | 'unknown';
  summary: string;
  details: string;
} {
  const lowerContent = content.toLowerCase();

  let status: 'completed' | 'failed' | 'in_progress' | 'unknown' = 'unknown';
  if (lowerContent.startsWith('completed:') || lowerContent.includes('successfully')) {
    status = 'completed';
  } else if (lowerContent.startsWith('failed:') || lowerContent.includes('error') || lowerContent.includes('failed')) {
    status = 'failed';
  } else if (lowerContent.startsWith('working on') || lowerContent.startsWith('starting')) {
    status = 'in_progress';
  }

  // First line is summary, rest is details
  const lines = content.split('\n');
  const summary = lines[0].replace(/^(Completed:|Failed:|Working on:)\s*/i, '').trim();
  const details = lines.slice(1).join('\n').trim();

  return { status, summary, details };
}

interface IterationDetailModalProps {
  entry: ProgressEntry;
  workerName: string;
  onClose: () => void;
}

function IterationDetailModal({ entry, workerName, onClose }: IterationDetailModalProps): JSX.Element {
  const parsed = parseIterationContent(entry.content);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-lg border border-border max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border bg-bg-secondary">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-text-primary font-medium">
                Iteration {entry.iteration}
              </h3>
              <p className="text-text-tertiary text-sm">{workerName}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-tertiary text-xs">{formatDate(entry.created_at)}</span>
              <Badge variant={
                parsed.status === 'completed' ? 'success' :
                parsed.status === 'failed' ? 'error' :
                parsed.status === 'in_progress' ? 'info' : 'default'
              }>
                {parsed.status === 'completed' ? 'Completed' :
                 parsed.status === 'failed' ? 'Failed' :
                 parsed.status === 'in_progress' ? 'In Progress' : 'Unknown'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          <div className="space-y-4">
            {/* Summary */}
            <div>
              <h4 className="text-xs text-text-tertiary uppercase tracking-wide mb-2">Summary</h4>
              <p className="text-text-primary">{parsed.summary}</p>
            </div>

            {/* Claude Full Output - if available */}
            {entry.full_output ? (
              <div>
                <h4 className="text-xs text-text-tertiary uppercase tracking-wide mb-2">
                  Claude Output
                  <span className="ml-2 text-text-tertiary font-normal">
                    ({Math.round(entry.full_output.length / 1024)}KB)
                  </span>
                </h4>
                <pre className="text-text-secondary text-xs whitespace-pre-wrap bg-bg-secondary p-3 rounded-lg overflow-x-auto max-h-96 overflow-y-auto font-mono">
                  {entry.full_output}
                </pre>
              </div>
            ) : (
              <div>
                <h4 className="text-xs text-text-tertiary uppercase tracking-wide mb-2">Log Entry</h4>
                <pre className="text-text-secondary text-sm whitespace-pre-wrap bg-bg-secondary p-3 rounded-lg overflow-x-auto">
                  {entry.content}
                </pre>
                <p className="text-text-tertiary text-xs mt-2 italic">
                  Full Claude output not available for this entry.
                  New iterations will capture complete output.
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="pt-4 border-t border-border">
              <h4 className="text-xs text-text-tertiary uppercase tracking-wide mb-2">Details</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-text-tertiary">Entry ID:</span>{' '}
                  <span className="text-text-secondary">{entry.id}</span>
                </div>
                <div>
                  <span className="text-text-tertiary">Iteration:</span>{' '}
                  <span className="text-text-secondary">{entry.iteration}</span>
                </div>
                <div>
                  <span className="text-text-tertiary">Compacted:</span>{' '}
                  <span className="text-text-secondary">{entry.compacted ? 'Yes' : 'No'}</span>
                </div>
                <div>
                  <span className="text-text-tertiary">Created:</span>{' '}
                  <span className="text-text-secondary">{formatDate(entry.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-bg-secondary">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function WorkerProgressSection({ worker }: { worker: WorkerProgress }) {
  const [collapsed, setCollapsed] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ProgressEntry | null>(null);

  const recentEntries = worker.entries.slice(-3);
  const hasMore = worker.entries.length > 3;
  const displayEntries = collapsed ? [] : (showAll ? worker.entries : recentEntries);

  if (worker.entries.length === 0) {
    return (
      <div className="border border-border rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-text-primary text-sm font-medium">{worker.workerName}</span>
            {getStatusBadge(worker.workerStatus)}
          </div>
          <span className="text-text-tertiary text-xs">No progress entries yet</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Header - click to expand/collapse */}
        <div
          className="flex items-center justify-between p-3 bg-bg-secondary cursor-pointer hover:bg-bg-tertiary transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <span className="text-text-primary text-sm font-medium">{worker.workerName}</span>
            {getStatusBadge(worker.workerStatus)}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-text-tertiary text-xs">
              {worker.stats.total} {worker.stats.total === 1 ? 'entry' : 'entries'}
            </span>
            <span className={`text-text-tertiary transition-transform ${collapsed ? '' : 'rotate-180'}`}>
              ▼
            </span>
          </div>
        </div>

        {/* Entries - only show when not collapsed */}
        {!collapsed && (
          <>
            <div className="divide-y divide-border">
              {displayEntries.map((entry) => {
                const parsed = parseIterationContent(entry.content);
                return (
                  <div
                    key={entry.id}
                    className="p-3 bg-bg-primary hover:bg-bg-secondary cursor-pointer transition-colors"
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-text-secondary text-xs font-medium">
                            Iteration {entry.iteration}
                          </span>
                          <span className={`w-2 h-2 rounded-full ${
                            parsed.status === 'completed' ? 'bg-status-success' :
                            parsed.status === 'failed' ? 'bg-status-error' :
                            parsed.status === 'in_progress' ? 'bg-status-info' : 'bg-text-tertiary'
                          }`} />
                          {entry.compacted && (
                            <Badge variant="default" className="text-[10px]">Compacted</Badge>
                          )}
                        </div>
                        <p className="text-text-primary text-sm line-clamp-2">
                          {parsed.summary}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-text-tertiary text-xs">
                          {formatTime(entry.created_at)}
                        </span>
                        <span className="text-text-tertiary text-xs">→</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Show more/less */}
            {hasMore && (
              <button
                className="w-full p-2 text-xs text-accent hover:text-accent-hover bg-bg-secondary hover:bg-bg-tertiary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll(!showAll);
                }}
              >
                {showAll ? 'Show recent only' : `Show all ${worker.entries.length} entries`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selectedEntry && (
        <IterationDetailModal
          entry={selectedEntry}
          workerName={worker.workerName}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </>
  );
}

export function ProgressView({ outcomeId }: ProgressViewProps): JSX.Element {
  const [progress, setProgress] = useState<WorkerProgress[]>([]);
  const [overallStats, setOverallStats] = useState<{
    totalEntries: number;
    totalCompacted: number;
    totalUncompacted: number;
    workerCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/progress`);
      if (!response.ok) {
        throw new Error('Failed to fetch progress');
      }
      const data = await response.json();
      setProgress(data.workerProgress || []);
      setOverallStats(data.overallStats || null);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch progress:', err);
      setError('Failed to load progress');
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchProgress();
    // Poll for updates every 10 seconds
    const interval = setInterval(fetchProgress, 10000);
    return () => clearInterval(interval);
  }, [fetchProgress]);

  if (loading) {
    return (
      <div className="p-4 text-text-tertiary text-sm">Loading progress...</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-status-error text-sm">{error}</div>
    );
  }

  if (progress.length === 0) {
    return (
      <div className="p-4 text-text-tertiary text-sm">
        No workers have been started yet. Start a worker to see progress here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Stats */}
      {overallStats && overallStats.totalEntries > 0 && (
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span>{overallStats.workerCount} worker{overallStats.workerCount !== 1 ? 's' : ''}</span>
          <span>{overallStats.totalEntries} total entries</span>
        </div>
      )}

      {/* Worker Progress Sections */}
      <div className="space-y-3">
        {progress.map((worker) => (
          <WorkerProgressSection key={worker.workerId} worker={worker} />
        ))}
      </div>
    </div>
  );
}
