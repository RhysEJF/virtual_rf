'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/Button';

interface TaskCheckpoint {
  id: number;
  task_id: string;
  worker_id: string | null;
  progress_summary: string | null;
  remaining_work: string | null;
  files_modified: string | null;
  git_sha: string | null;
  created_at: string;
}

interface TaskCheckpointInfoProps {
  taskId: string;
  taskStatus: string;
  attempts: number;
  visible: boolean;
  onResumed?: () => void;
}

export function TaskCheckpointInfo({ taskId, taskStatus, attempts, visible, onResumed }: TaskCheckpointInfoProps): JSX.Element | null {
  const [checkpoint, setCheckpoint] = useState<TaskCheckpoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [resuming, setResuming] = useState(false);

  const showCheckpoint = (taskStatus === 'failed' || (taskStatus === 'pending' && attempts > 0));

  const fetchCheckpoint = useCallback(async () => {
    if (!showCheckpoint) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/checkpoint`);
      if (res.ok) {
        const data = await res.json();
        setCheckpoint(data.checkpoint || null);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [taskId, showCheckpoint]);

  useEffect(() => {
    if (visible && !loaded && showCheckpoint) {
      fetchCheckpoint();
    }
  }, [visible, loaded, showCheckpoint, fetchCheckpoint]);

  if (!visible || !showCheckpoint || (!loading && !checkpoint)) return null;

  const handleResume = async () => {
    setResuming(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/resume`, { method: 'POST' });
      if (res.ok) {
        onResumed?.();
      }
    } catch {
      // Silent fail
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="p-3 bg-bg-tertiary rounded-lg border border-border space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-tertiary uppercase tracking-wide">
          Checkpoint
        </label>
        <Button
          variant="primary"
          size="sm"
          onClick={handleResume}
          disabled={resuming}
          className="text-xs"
        >
          {resuming ? 'Resuming...' : 'Resume from Checkpoint'}
        </Button>
      </div>

      {loading ? (
        <p className="text-text-tertiary text-sm">Loading checkpoint...</p>
      ) : checkpoint ? (
        <div className="space-y-2 text-xs">
          {checkpoint.progress_summary && (
            <div>
              <span className="text-text-tertiary">Progress: </span>
              <span className="text-text-secondary">{checkpoint.progress_summary}</span>
            </div>
          )}
          {checkpoint.remaining_work && (
            <div>
              <span className="text-text-tertiary">Remaining: </span>
              <span className="text-text-secondary">{checkpoint.remaining_work}</span>
            </div>
          )}
          {checkpoint.files_modified && (
            <div>
              <span className="text-text-tertiary">Files: </span>
              <span className="text-text-secondary font-mono">{checkpoint.files_modified}</span>
            </div>
          )}
          <div className="flex items-center gap-4 text-text-tertiary">
            {checkpoint.git_sha && <span>SHA: {checkpoint.git_sha.slice(0, 8)}</span>}
            <span>{new Date(checkpoint.created_at).toLocaleString()}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
