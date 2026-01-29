'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { Progress } from '@/app/components/ui/Progress';
import { InterventionForm } from '@/app/components/InterventionForm';
import { useToast } from '@/app/hooks/useToast';
import type { WorkerStatus, TaskStatus, Task, Worker, ProgressEntry } from '@/lib/db/schema';

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
  const { toast } = useToast();
  const workerId = params.id as string;
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [worker, setWorker] = useState<WorkerWithLiveStatus | null>(null);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [logs, setLogs] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

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

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch(`/api/workers/${workerId}/logs?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.entries || []);
        // Auto-scroll to bottom if enabled
        if (autoScroll && logsEndRef.current) {
          logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } catch (err) {
      // Silent fail for logs
    }
  }, [workerId, autoScroll]);

  useEffect(() => {
    fetchWorker();
    fetchLogs();
    const workerInterval = setInterval(fetchWorker, 3000);
    const logsInterval = setInterval(fetchLogs, 3000);
    return () => {
      clearInterval(workerInterval);
      clearInterval(logsInterval);
    };
  }, [fetchWorker, fetchLogs]);

  // Actions
  const handleStopWorker = async () => {
    if (!worker) return;
    setActionLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${worker.outcome_id}/workers?workerId=${workerId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        toast({ type: 'success', message: 'Worker stopped' });
      } else {
        toast({ type: 'error', message: 'Failed to stop worker' });
      }
      fetchWorker();
    } catch (err) {
      toast({ type: 'error', message: 'Failed to stop worker' });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePauseWorker = async () => {
    if (!worker) return;
    setActionLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${worker.outcome_id}/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pause',
          message: 'Paused from worker detail page',
          worker_id: workerId,
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Pause signal sent - worker will stop after current task' });
      } else {
        toast({ type: 'error', message: data.error || 'Failed to pause worker' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to pause worker' });
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
            <Button variant="secondary" onClick={handlePauseWorker} disabled={actionLoading}>
              Pause Worker
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

          {/* Live Logs */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Live Logs</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-text-tertiary text-sm">{logs.length} entries</span>
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`text-xs px-2 py-0.5 rounded ${
                    autoScroll
                      ? 'bg-accent/20 text-accent'
                      : 'bg-bg-tertiary text-text-tertiary'
                  }`}
                >
                  {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-text-tertiary text-sm">No logs yet</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto font-mono text-xs">
                  {logs.map((entry, idx) => (
                    <div
                      key={entry.id || idx}
                      className="p-2 rounded bg-bg-secondary border-l-2 border-accent/30"
                    >
                      <div className="flex items-center gap-2 mb-1 text-text-tertiary">
                        <span>Iteration {entry.iteration}</span>
                        <span>•</span>
                        <span>{new Date(entry.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-text-secondary whitespace-pre-wrap">
                        {entry.content}
                      </div>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
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

          {/* Send Intervention */}
          {isRunning && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Send Instruction</CardTitle>
              </CardHeader>
              <CardContent>
                <InterventionForm
                  outcomeId={worker.outcome_id}
                  workerId={workerId}
                  onSuccess={() => {
                    fetchWorker();
                    fetchLogs();
                  }}
                  compact
                />
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
                  <>
                    <Button variant="secondary" className="w-full" onClick={handlePauseWorker} disabled={actionLoading}>
                      Pause Worker
                    </Button>
                    <Button variant="ghost" className="w-full text-status-error hover:bg-status-error/10" onClick={handleStopWorker} disabled={actionLoading}>
                      Force Stop
                    </Button>
                  </>
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
