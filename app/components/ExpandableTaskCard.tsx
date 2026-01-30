'use client';

import { useState } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { Task, TaskStatus } from '@/lib/db/schema';

interface ExpandableTaskCardProps {
  task: Task;
  onUpdate?: (task: Task) => void;
}

const statusConfig: Record<TaskStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  pending: { label: 'Pending', variant: 'default' },
  claimed: { label: 'Claimed', variant: 'info' },
  running: { label: 'Running', variant: 'info' },
  completed: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

export function ExpandableTaskCard({ task, onUpdate }: ExpandableTaskCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [ramble, setRamble] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = statusConfig[task.status];
  const hasContext = Boolean(task.task_intent || task.task_approach);

  const handleOptimize = async () => {
    if (!ramble.trim()) return;

    setOptimizing(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}/optimize-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ramble }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to optimize');
      }

      setRamble('');
      if (data.task && onUpdate) {
        onUpdate(data.task);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize context');
    } finally {
      setOptimizing(false);
    }
  };

  const handleDirectEdit = async (field: 'task_intent' | 'task_approach', value: string) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update');
      }

      if (data.task && onUpdate) {
        onUpdate(data.task);
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  return (
    <div className="border border-border rounded-lg bg-bg-secondary overflow-hidden">
      {/* Collapsed Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between text-left hover:bg-bg-tertiary transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Chevron */}
          <span className={`text-text-tertiary transition-transform ${expanded ? 'rotate-90' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </span>

          {/* Task info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-text-primary text-sm font-medium truncate">
                {task.title}
              </span>
              {task.from_review && (
                <Badge variant="warning" className="text-[10px] shrink-0">Review</Badge>
              )}
              {hasContext && (
                <span className="text-text-tertiary text-xs shrink-0" title="Has context">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </span>
              )}
            </div>
            {task.description && !expanded && (
              <p className="text-text-tertiary text-xs truncate mt-0.5">
                {task.description}
              </p>
            )}
          </div>
        </div>

        <Badge variant={status.variant} className="shrink-0 ml-2">
          {status.label}
        </Badge>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Description */}
          {task.description && (
            <div>
              <p className="text-text-secondary text-sm">{task.description}</p>
            </div>
          )}

          {/* Task Intent (What) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                What (Task Intent)
              </label>
            </div>
            {task.task_intent ? (
              <div className="p-3 bg-bg-primary rounded-lg border border-border">
                <p className="text-text-secondary text-sm whitespace-pre-wrap">
                  {task.task_intent}
                </p>
                <button
                  className="text-xs text-text-tertiary hover:text-text-secondary mt-2"
                  onClick={() => {
                    const newValue = prompt('Edit task intent:', task.task_intent || '');
                    if (newValue !== null) {
                      handleDirectEdit('task_intent', newValue);
                    }
                  }}
                >
                  Edit
                </button>
              </div>
            ) : (
              <p className="text-text-tertiary text-sm italic">
                No intent specified. Add context below.
              </p>
            )}
          </div>

          {/* Task Approach (How) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                How (Task Approach)
              </label>
            </div>
            {task.task_approach ? (
              <div className="p-3 bg-bg-primary rounded-lg border border-border">
                <p className="text-text-secondary text-sm whitespace-pre-wrap">
                  {task.task_approach}
                </p>
                <button
                  className="text-xs text-text-tertiary hover:text-text-secondary mt-2"
                  onClick={() => {
                    const newValue = prompt('Edit task approach:', task.task_approach || '');
                    if (newValue !== null) {
                      handleDirectEdit('task_approach', newValue);
                    }
                  }}
                >
                  Edit
                </button>
              </div>
            ) : (
              <p className="text-text-tertiary text-sm italic">
                No approach specified. Add context below.
              </p>
            )}
          </div>

          {/* Ramble Box */}
          <div className="border-t border-border pt-4">
            <textarea
              value={ramble}
              onChange={(e) => setRamble(e.target.value)}
              placeholder="Add context to this task... What should it achieve? How should it be done?"
              className="w-full h-24 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
            />
            {error && (
              <p className="text-status-error text-xs mt-1">{error}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleOptimize}
                disabled={optimizing || !ramble.trim()}
              >
                {optimizing ? 'Optimizing...' : 'Optimize Context'}
              </Button>
              <span className="text-xs text-text-tertiary">
                AI will structure your ramble into What/How
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
