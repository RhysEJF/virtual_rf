'use client';

import { useState } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { Task, TaskStatus } from '@/lib/db/schema';

interface ExpandableTaskCardProps {
  task: Task;
  onUpdate?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onMoveUp?: (taskId: string) => void;
  onMoveDown?: (taskId: string) => void;
  isFirst?: boolean;
  isLast?: boolean;
}

const statusConfig: Record<TaskStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  pending: { label: 'Pending', variant: 'default' },
  claimed: { label: 'Claimed', variant: 'info' },
  running: { label: 'Running', variant: 'info' },
  completed: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

export function ExpandableTaskCard({
  task,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
}: ExpandableTaskCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taskIntent, setTaskIntent] = useState(task.task_intent || '');
  const [taskApproach, setTaskApproach] = useState(task.task_approach || '');
  const [optimizingIntent, setOptimizingIntent] = useState(false);
  const [optimizingApproach, setOptimizingApproach] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const status = statusConfig[task.status];
  const hasContext = Boolean(task.task_intent || task.task_approach);

  // Track changes
  const handleIntentChange = (value: string) => {
    setTaskIntent(value);
    setHasChanges(value !== (task.task_intent || '') || taskApproach !== (task.task_approach || ''));
  };

  const handleApproachChange = (value: string) => {
    setTaskApproach(value);
    setHasChanges(taskIntent !== (task.task_intent || '') || value !== (task.task_approach || ''));
  };

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_intent: taskIntent || null,
          task_approach: taskApproach || null,
        }),
      });

      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setHasChanges(false);
      }
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  // Delete task
  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
      });

      if (response.ok && onDelete) {
        onDelete(task.id);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Optimize a specific field
  const handleOptimize = async (field: 'intent' | 'approach') => {
    const content = field === 'intent' ? taskIntent : taskApproach;
    if (!content.trim()) return;

    const setOptimizing = field === 'intent' ? setOptimizingIntent : setOptimizingApproach;
    const setValue = field === 'intent' ? setTaskIntent : setTaskApproach;

    setOptimizing(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/optimize-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, content }),
      });

      const data = await response.json();
      if (response.ok && data.optimized) {
        setValue(data.optimized);
        setHasChanges(true);
      }
    } catch (err) {
      console.error('Failed to optimize:', err);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="border border-border rounded-lg bg-bg-secondary overflow-hidden">
      {/* Collapsed Header - Always visible */}
      <div className="flex items-center">
        {/* Reorder buttons */}
        {(onMoveUp || onMoveDown) && (
          <div className="flex flex-col px-1 border-r border-border">
            <button
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(task.id); }}
              disabled={isFirst}
              className={`p-0.5 ${isFirst ? 'text-text-tertiary/30' : 'text-text-tertiary hover:text-text-secondary'}`}
              title="Move up"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 8L6 4L10 8" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(task.id); }}
              disabled={isLast}
              className={`p-0.5 ${isLast ? 'text-text-tertiary/30' : 'text-text-tertiary hover:text-text-secondary'}`}
              title="Move down"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4L6 8L10 4" />
              </svg>
            </button>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 p-3 flex items-center justify-between text-left hover:bg-bg-tertiary transition-colors"
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
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Description */}
          {task.description && (
            <div>
              <p className="text-text-secondary text-sm">{task.description}</p>
            </div>
          )}

          {/* Task Intent (What) - Editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                What (Task Intent)
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOptimize('intent')}
                disabled={optimizingIntent || !taskIntent.trim()}
                className="text-xs h-6 px-2"
              >
                {optimizingIntent ? 'Optimizing...' : 'Optimize'}
              </Button>
            </div>
            <textarea
              value={taskIntent}
              onChange={(e) => handleIntentChange(e.target.value)}
              placeholder="What should this task achieve? What are the requirements?"
              className="w-full h-20 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          {/* Task Approach (How) - Editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                How (Task Approach)
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOptimize('approach')}
                disabled={optimizingApproach || !taskApproach.trim()}
                className="text-xs h-6 px-2"
              >
                {optimizingApproach ? 'Optimizing...' : 'Optimize'}
              </Button>
            </div>
            <textarea
              value={taskApproach}
              onChange={(e) => handleApproachChange(e.target.value)}
              placeholder="How should this be done? What tools, patterns, or constraints?"
              className="w-full h-20 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          {/* Save/Delete buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              {hasChanges && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTaskIntent(task.task_intent || '');
                      setTaskApproach(task.task_approach || '');
                      setHasChanges(false);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="text-status-error hover:text-status-error/80"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
