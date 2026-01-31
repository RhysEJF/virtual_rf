'use client';

/**
 * HOMЯ Status Card
 *
 * Shows HOMЯ Protocol status for an outcome:
 * - Enabled/disabled status
 * - Stats: tasks observed, discoveries, escalations
 * - Recent activity summary
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface HomrStatus {
  enabled: boolean;
  context: {
    discoveries: number;
    decisions: number;
    constraints: number;
  };
  stats: {
    tasksObserved: number;
    discoveriesExtracted: number;
    escalationsCreated: number;
    steeringActions: number;
  };
  pendingEscalations: number;
  recentActivity: Array<{
    id: string;
    type: string;
    summary: string;
    createdAt: number;
  }>;
}

interface Props {
  outcomeId: string;
  onEscalationClick?: () => void;
  onActivityClick?: () => void;
}

export function HomrStatusCard({ outcomeId, onEscalationClick, onActivityClick }: Props): JSX.Element {
  const [status, setStatus] = useState<HomrStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus(): Promise<void> {
      try {
        const res = await fetch(`/api/outcomes/${outcomeId}/homr`);
        if (!res.ok) {
          throw new Error('Failed to fetch HOMЯ status');
        }
        const data = await res.json();
        setStatus(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [outcomeId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>HOMЯ Protocol</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>HOMЯ Protocol</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-status-error text-sm">{error || 'Failed to load status'}</p>
        </CardContent>
      </Card>
    );
  }

  const latestActivity = status.recentActivity[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>HOMЯ Protocol</CardTitle>
          <Badge variant={status.enabled ? 'success' : 'default'}>
            {status.enabled ? 'Active' : 'Disabled'}
          </Badge>
        </div>
        {status.pendingEscalations > 0 && (
          <button
            onClick={onEscalationClick}
            className="text-xs text-status-warning hover:underline"
          >
            {status.pendingEscalations} pending
          </button>
        )}
      </CardHeader>

      <CardContent>
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatBox label="Observed" value={status.stats.tasksObserved} />
          <StatBox label="Discoveries" value={status.stats.discoveriesExtracted} />
          <StatBox label="Steered" value={status.stats.steeringActions} />
          <StatBox label="Escalated" value={status.stats.escalationsCreated} />
        </div>

        {/* Context Summary */}
        <div className="text-xs text-text-secondary mb-3">
          <span className="font-medium">{status.context.discoveries}</span> discoveries,{' '}
          <span className="font-medium">{status.context.decisions}</span> decisions,{' '}
          <span className="font-medium">{status.context.constraints}</span> constraints
        </div>

        {/* Latest Activity */}
        {latestActivity && (
          <div className="text-sm text-text-secondary border-t border-border pt-3">
            <span className="text-xs text-text-muted uppercase">Latest: </span>
            {latestActivity.summary}
            <span className="text-xs text-text-muted ml-1">
              ({formatRelativeTime(latestActivity.createdAt)})
            </span>
          </div>
        )}

        {/* View Activity Log Button */}
        {onActivityClick && (
          <button
            onClick={onActivityClick}
            className="text-xs text-accent-primary hover:underline mt-2"
          >
            View Activity Log
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="text-center">
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
