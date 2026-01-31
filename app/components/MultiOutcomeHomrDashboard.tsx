'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

interface Escalation {
  id: string;
  outcomeId: string;
  outcomeName: string;
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
}

interface OutcomeHealth {
  outcomeId: string;
  outcomeName: string;
  workersRunning: number;
  workersTotal: number;
  totalCost: number;
  pendingEscalations: number;
  failedTasks: number;
}

interface AggregatedStats {
  totalWorkersRunning: number;
  totalWorkers: number;
  totalCost: number;
  totalPending: number;
  totalFailed: number;
  outcomes: OutcomeHealth[];
  escalations: Escalation[];
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function MultiOutcomeHomrDashboard(): JSX.Element {
  const router = useRouter();
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string>('');

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/homr/aggregate');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch aggregated HOMЯ stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleAnswer = async (escalation: Escalation) => {
    if (!selectedOption) return;

    try {
      const res = await fetch(
        `/api/outcomes/${escalation.outcomeId}/homr/escalations/${escalation.id}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedOption }),
        }
      );

      if (res.ok) {
        setAnsweringId(null);
        setSelectedOption('');
        fetchStats();
      }
    } catch (err) {
      console.error('Failed to answer escalation:', err);
    }
  };

  const handleDismiss = async (escalation: Escalation) => {
    try {
      const res = await fetch(
        `/api/outcomes/${escalation.outcomeId}/homr/escalations/${escalation.id}/dismiss`,
        { method: 'POST' }
      );

      if (res.ok) {
        fetchStats();
      }
    } catch (err) {
      console.error('Failed to dismiss escalation:', err);
    }
  };

  if (loading) {
    return (
      <Card padding="md">
        <CardContent>
          <p className="text-text-tertiary text-sm">Loading HOMЯ...</p>
        </CardContent>
      </Card>
    );
  }

  const hasActivity = stats && (stats.totalWorkersRunning > 0 || stats.escalations.length > 0);

  return (
    <Card padding="md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">HOMЯ</CardTitle>
          {stats && stats.totalPending > 0 && (
            <Badge variant="warning">{stats.totalPending} pending</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">😴</div>
            <p className="text-text-secondary text-sm">No active workers</p>
            <p className="text-text-tertiary text-xs mt-1">Start a worker to see HOMЯ activity</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Compact Metrics Row */}
            <div className="flex gap-4 text-sm">
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-text-primary">{stats!.totalWorkersRunning}</span>
                <span className="text-xs text-text-tertiary">/{stats!.totalWorkers} workers</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-text-primary">${stats!.totalCost.toFixed(2)}</span>
                <span className="text-xs text-text-tertiary">cost</span>
              </div>
              {stats!.totalFailed > 0 && (
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-status-error">{stats!.totalFailed}</span>
                  <span className="text-xs text-text-tertiary">failed</span>
                </div>
              )}
            </div>

            {/* Pending Escalations */}
            {stats!.escalations.length > 0 ? (
              <div className="space-y-3">
                <div className="text-xs text-text-tertiary uppercase tracking-wide">
                  Needs Your Input
                </div>
                {stats!.escalations.slice(0, 3).map((esc) => (
                  <div
                    key={esc.id}
                    className="p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => router.push(`/outcome/${esc.outcomeId}`)}
                          className="text-xs text-accent hover:underline truncate block"
                        >
                          {esc.outcomeName}
                        </button>
                        <p className="text-sm text-text-primary mt-1">{esc.question.text}</p>
                      </div>
                      <span className="text-xs text-text-tertiary whitespace-nowrap">
                        {formatRelativeTime(esc.createdAt)}
                      </span>
                    </div>

                    {answeringId === esc.id ? (
                      <div className="space-y-2">
                        <select
                          value={selectedOption}
                          onChange={(e) => setSelectedOption(e.target.value)}
                          className="w-full text-sm bg-bg-primary border border-border rounded px-2 py-1.5 text-text-primary"
                        >
                          <option value="">Select an option...</option>
                          {esc.question.options.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleAnswer(esc)}
                            disabled={!selectedOption}
                          >
                            Submit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setAnsweringId(null);
                              setSelectedOption('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => setAnsweringId(esc.id)}>
                          Answer
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDismiss(esc)}>
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => router.push(`/outcome/${esc.outcomeId}`)}
                        >
                          View →
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {stats!.escalations.length > 3 && (
                  <button
                    onClick={() => router.push('/supervisor')}
                    className="text-xs text-accent hover:underline"
                  >
                    View all {stats!.escalations.length} escalations →
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-2">
                <div className="text-2xl mb-1">✓</div>
                <p className="text-text-secondary text-sm">All clear</p>
                <p className="text-text-tertiary text-xs">No decisions needed</p>
              </div>
            )}

            {/* Active Outcomes Summary */}
            {stats!.outcomes.filter(o => o.workersRunning > 0).length > 1 && (
              <div className="pt-2 border-t border-border">
                <div className="text-xs text-text-tertiary mb-2">Active Outcomes</div>
                <div className="space-y-1">
                  {stats!.outcomes
                    .filter(o => o.workersRunning > 0)
                    .map((o) => (
                      <button
                        key={o.outcomeId}
                        onClick={() => router.push(`/outcome/${o.outcomeId}`)}
                        className="w-full flex items-center justify-between text-sm hover:bg-bg-secondary rounded px-2 py-1 -mx-2"
                      >
                        <span className="text-text-primary truncate">{o.outcomeName}</span>
                        <span className="text-text-tertiary text-xs">
                          {o.workersRunning} worker{o.workersRunning !== 1 ? 's' : ''}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
