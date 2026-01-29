'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { Progress } from '@/app/components/ui/Progress';
import type { WorkerStatus, TaskStatus, Task, Worker } from '@/lib/db/schema';

// Status configurations
const workerStatusConfig: Record<WorkerStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  idle: { label: 'Idle', variant: 'default' },
  running: { label: 'Running', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

interface WorkerWithLiveStatus extends Worker {
  liveStatus?: {
    status: string;
    currentTaskId?: string;
    currentTaskTitle?: string;
    completedTasks: number;
    totalTasks: number;
    iteration: number;
    error?: string;
  };
}

export default function WorkerDetailPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const workerId = params.id as string;

  const [worker, setWorker] = useState<WorkerWithLiveStatus | null>(null);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch worker data
  const fetchWorker = useCallback(async () => {
    try {
      const response = await fetch(`/api/workers/${workerId}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Worker not found');
      }
      const data = await response.json();
      setWorker(data.worker);
      setCurrentTask(data.currentTask || null);
      setCompletedTasks(data.completedTasks || []);
      setTotalTasks(data.totalTasks || 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worker');
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    fetchWorker();
    const interval = setInterval(fetchWorker, 3000); // Poll more frequently
    return () => clearInterval(interval);
  }, [fetchWorker]);

  // Actions
  const handleStopWorker = async () => {
    if (!worker) return;
    setActionLoading(true);
    try {
      await fetch(`/api/outcomes/${worker.outcome_id}/workers?workerId=${workerId}`, {
        method: 'DELETE',
      });
      fetchWorker();
    } catch (err) {
      alert('Failed to stop worker');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <p className="text-text-secondary">Loading worker...</p>
      </main>
    );
  }

  if (error || !worker) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <Card padding="lg">
          <CardContent>
            <p className="text-status-error">{error || 'Worker not found'}</p>
            <Button variant="secondary" className="mt-4" onClick={() => router.push('/')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const status = workerStatusConfig[worker.status];
  const isRunning = worker.status === 'running';
  const liveStatus = worker.liveStatus;

  // Calculate progress
  const completedCount = liveStatus?.completedTasks ?? completedTasks.length;
  const total = liveStatus?.totalTasks ?? totalTasks;
  const progressPercent = total > 0 ? (completedCount / total) * 100 : 0;

  // Format duration
  const startedAt = worker.started_at ? new Date(worker.started_at) : null;
  const duration = startedAt
    ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
    : 0;
  const durationText = duration > 3600
    ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
    : duration > 60
    ? `${Math.floor(duration / 60)}m ${duration % 60}s`
    : `${duration}s`;

  return (
    <main className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push(`/outcome/${worker.outcome_id}`)}
          className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
        >
          ← Back to Outcome
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-text-primary">{worker.name}</h1>
              <Badge variant={status.variant}>{status.label}</Badge>
              {isRunning && (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-status-success"></span>
                </span>
              )}
            </div>
            <p className="text-text-secondary text-sm">
              Iteration {worker.iteration} • Running for {durationText} • Cost: ${worker.cost.toFixed(4)}
            </p>
          </div>
          {isRunning && (
            <Button variant="secondary" onClick={handleStopWorker} disabled={actionLoading}>
              Stop Worker
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Current Task */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Current Task</CardTitle>
              {liveStatus?.status && (
                <Badge variant="info">{liveStatus.status}</Badge>
              )}
            </CardHeader>
            <CardContent>
              {currentTask || liveStatus?.currentTaskTitle ? (
                <div>
                  <h3 className="text-text-primary font-medium mb-2">
                    {currentTask?.title || liveStatus?.currentTaskTitle}
                  </h3>
                  {currentTask?.description && (
                    <p className="text-text-secondary text-sm mb-4">{currentTask.description}</p>
                  )}
                </div>
              ) : isRunning ? (
                <p className="text-text-tertiary text-sm">Claiming next task...</p>
              ) : (
                <p className="text-text-tertiary text-sm">No active task</p>
              )}
            </CardContent>
          </Card>

          {/* Progress */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <span className="text-text-tertiary text-sm">
                {completedCount}/{total} tasks
              </span>
            </CardHeader>
            <CardContent>
              <Progress
                value={progressPercent}
                showLabel
                variant={worker.status === 'completed' ? 'success' : 'default'}
              />
              {liveStatus?.error && (
                <div className="mt-4 p-3 bg-status-error/10 border border-status-error/20 rounded text-sm text-status-error">
                  Error: {liveStatus.error}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Completed Tasks */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Completed Tasks</CardTitle>
              <span className="text-text-tertiary text-sm">{completedTasks.length}</span>
            </CardHeader>
            <CardContent>
              {completedTasks.length === 0 ? (
                <p className="text-text-tertiary text-sm">No tasks completed yet</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {completedTasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 text-sm">
                      <span className="w-5 h-5 rounded-full bg-status-success/20 text-status-success flex items-center justify-center text-xs">
                        ✓
                      </span>
                      <span className="text-text-primary">{task.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Stats */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Status</span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Iteration</span>
                  <span className="text-text-primary">{worker.iteration}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Duration</span>
                  <span className="text-text-primary">{durationText}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Cost</span>
                  <span className="text-text-primary">${worker.cost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Tasks Done</span>
                  <span className="text-text-primary">{completedCount}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Progress Summary */}
          {worker.progress_summary && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-text-secondary text-sm whitespace-pre-wrap">
                  {worker.progress_summary}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {isRunning && (
                  <Button variant="secondary" className="w-full" onClick={handleStopWorker} disabled={actionLoading}>
                    Stop Worker
                  </Button>
                )}
                <Button variant="ghost" className="w-full" onClick={() => router.push(`/outcome/${worker.outcome_id}`)}>
                  View Outcome
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => router.push('/')}>
                  Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
