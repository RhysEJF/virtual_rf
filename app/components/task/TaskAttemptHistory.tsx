'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/app/components/ui/Badge';

interface TaskAttempt {
  id: number;
  task_id: string;
  attempt_number: number;
  worker_id: string | null;
  approach_summary: string | null;
  failure_reason: string | null;
  files_modified: string | null;
  error_output: string | null;
  duration_seconds: number | null;
  created_at: string;
}

interface TaskAttemptHistoryProps {
  taskId: string;
  visible: boolean;
}

export function TaskAttemptHistory({ taskId, visible }: TaskAttemptHistoryProps): JSX.Element | null {
  const [attempts, setAttempts] = useState<TaskAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expandedAttempt, setExpandedAttempt] = useState<number | null>(null);

  const fetchAttempts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/attempts`);
      if (res.ok) {
        const data = await res.json();
        setAttempts(data.attempts || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [taskId]);

  useEffect(() => {
    if (visible && !loaded) {
      fetchAttempts();
    }
  }, [visible, loaded, fetchAttempts]);

  if (!visible || (!loading && attempts.length === 0)) return null;

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  return (
    <div>
      <label className="text-xs text-text-tertiary uppercase tracking-wide mb-2 block">
        Attempt History ({attempts.length})
      </label>

      {loading ? (
        <p className="text-text-tertiary text-sm">Loading attempts...</p>
      ) : (
        <div className="space-y-2">
          {attempts.map((attempt) => {
            const isExpanded = expandedAttempt === attempt.id;
            const hasFailed = !!attempt.failure_reason;

            return (
              <div key={attempt.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedAttempt(isExpanded ? null : attempt.id)}
                  className="w-full flex items-center justify-between p-2 text-xs hover:bg-bg-tertiary"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={hasFailed ? 'error' : 'success'} className="text-[10px]">
                      #{attempt.attempt_number}
                    </Badge>
                    <span className="text-text-secondary truncate max-w-[200px]">
                      {attempt.approach_summary || (hasFailed ? 'Failed' : 'Completed')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-text-tertiary">{formatDuration(attempt.duration_seconds)}</span>
                    <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="p-3 border-t border-border bg-bg-tertiary space-y-2 text-xs">
                    {attempt.approach_summary && (
                      <div>
                        <span className="text-text-tertiary">Approach: </span>
                        <span className="text-text-secondary">{attempt.approach_summary}</span>
                      </div>
                    )}
                    {attempt.failure_reason && (
                      <div className="p-2 bg-status-error/10 border border-status-error/20 rounded text-status-error">
                        {attempt.failure_reason}
                      </div>
                    )}
                    {attempt.error_output && (
                      <details>
                        <summary className="text-text-tertiary cursor-pointer hover:text-text-secondary">
                          Error output
                        </summary>
                        <pre className="mt-1 p-2 bg-bg-primary rounded text-[10px] text-text-secondary font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {attempt.error_output}
                        </pre>
                      </details>
                    )}
                    {attempt.files_modified && (
                      <div>
                        <span className="text-text-tertiary">Files: </span>
                        <span className="text-text-secondary font-mono">{attempt.files_modified}</span>
                      </div>
                    )}
                    <div className="text-text-tertiary">
                      {new Date(attempt.created_at).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
