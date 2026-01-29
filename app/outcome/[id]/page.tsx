'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { Progress } from '@/app/components/ui/Progress';
import type { OutcomeStatus, TaskStatus, WorkerStatus, Task, Worker } from '@/lib/db/schema';

// Types
interface OutcomeDetail {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;
  brief: string | null;
  intent: string | null;
  timeline: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  design_doc: { approach: string; version: number } | null;
  tasks: Task[];
  workers: Worker[];
}

interface TaskStats {
  total: number;
  pending: number;
  claimed: number;
  running: number;
  completed: number;
  failed: number;
}

interface ConvergenceStatus {
  is_converging: boolean;
  consecutive_zero_issues: number;
  trend: string;
  last_issues: number;
  total_cycles: number;
}

// Status configurations
const outcomeStatusConfig: Record<OutcomeStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  active: { label: 'Active', variant: 'success' },
  dormant: { label: 'Dormant', variant: 'warning' },
  achieved: { label: 'Achieved', variant: 'success' },
  archived: { label: 'Archived', variant: 'default' },
};

const taskStatusConfig: Record<TaskStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  pending: { label: 'Pending', variant: 'default' },
  claimed: { label: 'Claimed', variant: 'info' },
  running: { label: 'Running', variant: 'info' },
  completed: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

const workerStatusConfig: Record<WorkerStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  idle: { label: 'Idle', variant: 'default' },
  running: { label: 'Running', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

export default function OutcomeDetailPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const outcomeId = params.id as string;

  const [outcome, setOutcome] = useState<OutcomeDetail | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [convergence, setConvergence] = useState<ConvergenceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch outcome data
  const fetchOutcome = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}?relations=true`);
      if (!response.ok) {
        throw new Error('Outcome not found');
      }
      const data = await response.json();
      setOutcome(data.outcome);
      setTaskStats(data.taskStats);
      setConvergence(data.convergence);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load outcome');
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchOutcome();
    const interval = setInterval(fetchOutcome, 5000);
    return () => clearInterval(interval);
  }, [fetchOutcome]);

  // Actions
  const handleStartWorker = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/workers`, { method: 'POST' });
      const data = await response.json();
      if (!data.success) {
        alert(data.error || 'Failed to start worker');
      }
      fetchOutcome();
    } catch (err) {
      alert('Failed to start worker');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunReview = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/review`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        alert(`Review complete: ${data.message}`);
      } else {
        alert(data.error || 'Review failed');
      }
      fetchOutcome();
    } catch (err) {
      alert('Failed to run review');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: OutcomeStatus) => {
    setActionLoading(true);
    try {
      await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchOutcome();
    } catch (err) {
      alert('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <p className="text-text-secondary">Loading...</p>
      </main>
    );
  }

  if (error || !outcome) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <Card padding="lg">
          <CardContent>
            <p className="text-status-error">{error || 'Outcome not found'}</p>
            <Button variant="secondary" className="mt-4" onClick={() => router.push('/')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const status = outcomeStatusConfig[outcome.status];
  const progressPercent = taskStats && taskStats.total > 0
    ? (taskStats.completed / taskStats.total) * 100
    : 0;
  const hasRunningWorker = outcome.workers.some(w => w.status === 'running');
  const hasPendingTasks = taskStats ? taskStats.pending > 0 : false;

  // Parse intent if available
  let intent: { summary?: string; items?: { id: string; title: string; status: string }[] } | null = null;
  if (outcome.intent) {
    try {
      intent = JSON.parse(outcome.intent);
    } catch {
      // Not valid JSON
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/')}
          className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-text-primary">{outcome.name}</h1>
              {outcome.is_ongoing && <Badge variant="info">Ongoing</Badge>}
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            {outcome.brief && (
              <p className="text-text-secondary text-sm max-w-2xl">{outcome.brief}</p>
            )}
          </div>
          <div className="flex gap-2">
            {outcome.status === 'active' && hasPendingTasks && !hasRunningWorker && (
              <Button onClick={handleStartWorker} disabled={actionLoading}>
                Start Worker
              </Button>
            )}
            {outcome.status === 'active' && (
              <Button variant="secondary" onClick={() => handleStatusChange('dormant')} disabled={actionLoading}>
                Pause
              </Button>
            )}
            {outcome.status === 'dormant' && (
              <Button onClick={() => handleStatusChange('active')} disabled={actionLoading}>
                Resume
              </Button>
            )}
            {convergence?.is_converging && outcome.status === 'active' && (
              <Button variant="secondary" onClick={() => handleStatusChange('achieved')} disabled={actionLoading}>
                Mark Achieved
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress Overview */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              {convergence && (
                <Badge variant={convergence.is_converging ? 'success' : 'default'}>
                  {convergence.is_converging ? 'Converging' : `${convergence.trend}`}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Progress value={progressPercent} showLabel variant={progressPercent === 100 ? 'success' : 'default'} />
              </div>
              {taskStats && (
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-text-tertiary">Completed: </span>
                    <span className="text-text-primary font-medium">{taskStats.completed}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Running: </span>
                    <span className="text-text-primary font-medium">{taskStats.running + taskStats.claimed}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Pending: </span>
                    <span className="text-text-primary font-medium">{taskStats.pending}</span>
                  </div>
                  <div>
                    <span className="text-text-tertiary">Failed: </span>
                    <span className="text-status-error font-medium">{taskStats.failed}</span>
                  </div>
                </div>
              )}
              {convergence && convergence.total_cycles > 0 && (
                <div className="mt-4 pt-4 border-t border-border text-sm">
                  <span className="text-text-tertiary">Review cycles: </span>
                  <span className="text-text-primary">{convergence.total_cycles}</span>
                  {convergence.consecutive_zero_issues > 0 && (
                    <span className="text-status-success ml-2">
                      ({convergence.consecutive_zero_issues} clean)
                    </span>
                  )}
                  <Button variant="ghost" size="sm" className="ml-4" onClick={handleRunReview} disabled={actionLoading}>
                    Run Review
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Intent (PRD) */}
          {intent && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Intent (What)</CardTitle>
              </CardHeader>
              <CardContent>
                {intent.summary && (
                  <p className="text-text-secondary text-sm mb-4">{intent.summary}</p>
                )}
                {intent.items && intent.items.length > 0 && (
                  <div className="space-y-2">
                    {intent.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm">
                        <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs
                          ${item.status === 'done' ? 'bg-status-success/20 border-status-success text-status-success' : 'border-border'}`}>
                          {item.status === 'done' ? '✓' : ''}
                        </span>
                        <span className={item.status === 'done' ? 'text-text-tertiary line-through' : 'text-text-primary'}>
                          {item.title}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Approach (Design Doc) */}
          {outcome.design_doc && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Approach (How)</CardTitle>
                <Badge variant="default">v{outcome.design_doc.version}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-text-secondary text-sm whitespace-pre-wrap">
                  {outcome.design_doc.approach}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Tasks */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
              <span className="text-text-tertiary text-sm">{outcome.tasks.length} total</span>
            </CardHeader>
            <CardContent>
              {outcome.tasks.length === 0 ? (
                <p className="text-text-tertiary text-sm">No tasks yet</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {outcome.tasks.map((task) => {
                    const taskStatus = taskStatusConfig[task.status];
                    return (
                      <div key={task.id} className="flex items-center justify-between p-2 rounded bg-bg-secondary">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary text-sm truncate">{task.title}</span>
                            {task.from_review && (
                              <Badge variant="warning" className="text-[10px]">From Review</Badge>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-text-tertiary text-xs truncate">{task.description}</p>
                          )}
                        </div>
                        <Badge variant={taskStatus.variant}>{taskStatus.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Workers */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Workers</CardTitle>
            </CardHeader>
            <CardContent>
              {outcome.workers.length === 0 ? (
                <p className="text-text-tertiary text-sm">No workers</p>
              ) : (
                <div className="space-y-3">
                  {outcome.workers.map((worker) => {
                    const workerStatus = workerStatusConfig[worker.status];
                    return (
                      <div key={worker.id} className="p-2 rounded bg-bg-secondary">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-text-primary text-sm">{worker.name}</span>
                          <Badge variant={workerStatus.variant}>{workerStatus.label}</Badge>
                        </div>
                        <div className="text-xs text-text-tertiary">
                          Iteration {worker.iteration} • ${worker.cost.toFixed(4)}
                        </div>
                        {worker.status === 'running' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 w-full"
                            onClick={() => router.push(`/worker/${worker.id}`)}
                          >
                            View Details
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {!hasRunningWorker && hasPendingTasks && (
                  <Button variant="primary" className="w-full" onClick={handleStartWorker} disabled={actionLoading}>
                    Start Worker
                  </Button>
                )}
                <Button variant="secondary" className="w-full" onClick={handleRunReview} disabled={actionLoading}>
                  Run Review
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => router.push('/')}>
                  Back to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Timeline */}
          {outcome.timeline && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-text-secondary text-sm">{outcome.timeline}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
