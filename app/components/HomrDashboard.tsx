'use client';

import { useState, useEffect } from 'react';
import { Badge } from './ui/Badge';
import { EscalationAlert } from './homr/EscalationAlert';

interface HomrStats {
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

interface Escalation {
  id: string;
  outcomeId: string;
  createdAt: number;
  status: 'pending' | 'answered' | 'dismissed';
  trigger: {
    type: string;
    taskId: string;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: Array<{
      id: string;
      label: string;
      description: string;
      implications: string;
    }>;
  };
  affectedTasks: string[];
}

interface WorkerSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  totalCost: number;
  totalIterations: number;
}

interface HomrDashboardProps {
  outcomeId: string;
  pendingEscalations: Escalation[];
  workerSummary: WorkerSummary;
  onAnswer: (escalationId: string, selectedOption: string, additionalContext?: string) => Promise<void>;
  onDismiss: (escalationId: string) => Promise<void>;
  onActivityClick?: () => void;
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

export function HomrDashboard({
  outcomeId,
  pendingEscalations,
  workerSummary,
  onAnswer,
  onDismiss,
  onActivityClick,
}: HomrDashboardProps): JSX.Element {
  const [stats, setStats] = useState<HomrStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats(): Promise<void> {
      try {
        const res = await fetch(`/api/outcomes/${outcomeId}/homr`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error('Failed to fetch HOMЯ stats:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, [outcomeId]);

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-text-tertiary text-sm">Loading HOMЯ...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compact Health Dashboard */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-primary">Outcome Health</h3>
          <Badge variant={stats?.enabled ? 'success' : 'default'}>
            {stats?.enabled ? 'HOMЯ Active' : 'HOMЯ Off'}
          </Badge>
        </div>

        {/* Compact Metrics Row */}
        <div className="flex gap-4 mb-2">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-text-primary">{workerSummary.running}</span>
            <span className="text-xs text-text-tertiary">/{workerSummary.total} workers</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-text-primary">${workerSummary.totalCost.toFixed(2)}</span>
            <span className="text-xs text-text-tertiary">cost</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-bold ${pendingEscalations.length > 0 ? 'text-status-warning' : 'text-text-primary'}`}>
              {pendingEscalations.length}
            </span>
            <span className="text-xs text-text-tertiary">pending</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-bold ${workerSummary.failed > 0 ? 'text-status-error' : 'text-text-primary'}`}>
              {workerSummary.failed}
            </span>
            <span className="text-xs text-text-tertiary">failed</span>
          </div>
        </div>

        {/* HOMЯ Stats Row */}
        {stats && (
          <div className="flex gap-3 text-xs text-text-tertiary">
            <span>{stats.stats.tasksObserved} observed</span>
            <span>{stats.stats.discoveriesExtracted} discoveries</span>
            <span>{stats.stats.steeringActions} steered</span>
          </div>
        )}
      </div>

      {/* Escalations Feed */}
      <div className="flex-1 overflow-y-auto">
        {pendingEscalations.length > 0 ? (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-text-primary">Needs Your Input</h3>
              <Badge variant="warning">{pendingEscalations.length}</Badge>
            </div>
            {pendingEscalations.map((escalation) => (
              <EscalationAlert
                key={escalation.id}
                escalation={escalation}
                onAnswer={onAnswer}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        ) : (
          <div className="p-4">
            <div className="text-center py-8">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-text-secondary font-medium">All Clear</p>
              <p className="text-text-tertiary text-sm">No decisions needed right now</p>
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {stats && stats.recentActivity.length > 0 && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-text-primary text-sm">Recent Activity</h3>
              {onActivityClick && (
                <button
                  onClick={onActivityClick}
                  className="text-xs text-accent hover:underline"
                >
                  View All
                </button>
              )}
            </div>
            <div className="space-y-2">
              {stats.recentActivity.slice(0, 5).map((activity) => (
                <div key={activity.id} className="text-sm">
                  <p className="text-text-secondary">{activity.summary}</p>
                  <p className="text-xs text-text-tertiary">{formatRelativeTime(activity.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
