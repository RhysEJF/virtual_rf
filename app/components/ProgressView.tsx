'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Badge } from './ui/Badge';
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

function getStatusBadge(status: string) {
  switch (status) {
    case 'running':
      return <Badge variant="success">Running</Badge>;
    case 'completed':
      return <Badge variant="default">Completed</Badge>;
    case 'failed':
      return <Badge variant="error">Failed</Badge>;
    case 'pending':
      return <Badge variant="warning">Pending</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function WorkerProgressSection({ worker }: { worker: WorkerProgress }) {
  const [expanded, setExpanded] = useState(false);
  const recentEntries = worker.entries.slice(-5);
  const hasMore = worker.entries.length > 5;

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

  const displayEntries = expanded ? worker.entries : recentEntries;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 bg-bg-secondary cursor-pointer hover:bg-bg-tertiary transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-sm font-medium">{worker.workerName}</span>
          {getStatusBadge(worker.workerStatus)}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-text-tertiary text-xs">
            {worker.stats.total} entries
            {worker.stats.compacted > 0 && ` (${worker.stats.compacted} compacted)`}
          </span>
          <span className="text-text-tertiary text-xs">
            {expanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {/* Entries */}
      <div className="divide-y divide-border">
        {displayEntries.map((entry) => (
          <div key={entry.id} className="p-3 bg-bg-primary">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-text-secondary text-xs font-medium">
                    Iteration {entry.iteration}
                  </span>
                  {entry.compacted && (
                    <Badge variant="default" className="text-[10px]">Compacted</Badge>
                  )}
                </div>
                <p className="text-text-primary text-sm whitespace-pre-wrap break-words">
                  {entry.content.length > 200 && !expanded
                    ? `${entry.content.slice(0, 200)}...`
                    : entry.content}
                </p>
              </div>
              <span className="text-text-tertiary text-xs flex-shrink-0">
                {formatTime(entry.created_at)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Show more/less */}
      {hasMore && (
        <button
          className="w-full p-2 text-xs text-accent hover:text-accent-hover bg-bg-secondary hover:bg-bg-tertiary transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? 'Show less' : `Show all ${worker.entries.length} entries`}
        </button>
      )}
    </div>
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
      <Card padding="md">
        <CardContent>
          <p className="text-text-tertiary text-sm">Loading progress...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="md">
        <CardContent>
          <p className="text-status-error text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (progress.length === 0) {
    return (
      <Card padding="md">
        <CardContent>
          <p className="text-text-tertiary text-sm">
            No workers have been started yet. Start a worker to see progress here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Stats */}
      {overallStats && overallStats.totalEntries > 0 && (
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span>{overallStats.workerCount} worker{overallStats.workerCount !== 1 ? 's' : ''}</span>
          <span>{overallStats.totalEntries} total entries</span>
          {overallStats.totalCompacted > 0 && (
            <span>{overallStats.totalCompacted} compacted</span>
          )}
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
