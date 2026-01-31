'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { Task, TaskStatus } from '@/lib/db/schema';

interface TaskSkillStatus {
  name: string;
  status: 'ready' | 'needs_api_key' | 'will_be_built';
  skillId?: string;
  missingKeys?: string[];
  description?: string;
}

interface AvailableSkill {
  id: string;
  name: string;
  category: string;
  description: string | null;
}

/** Blocking task information */
interface BlockingTaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
}

/** Task with dependency information */
export interface TaskWithDependencies extends Task {
  dependency_ids?: string[];
  blocked_by?: string[];
  is_blocked?: boolean;
}

interface ExpandableTaskCardProps {
  task: TaskWithDependencies;
  /** Map of all tasks by ID for displaying dependency titles */
  taskMap?: Map<string, TaskWithDependencies>;
  /** List of task IDs that depend on this task (computed from parent) */
  dependentIds?: string[];
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
  taskMap,
  dependentIds = [],
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
  const [description, setDescription] = useState(task.description || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [optimizingIntent, setOptimizingIntent] = useState(false);
  const [optimizingApproach, setOptimizingApproach] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Skills state
  const [skills, setSkills] = useState<TaskSkillStatus[]>([]);
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);

  const status = statusConfig[task.status];
  const hasContext = Boolean(task.task_intent || task.task_approach);

  // Dependency information
  const isBlocked = task.is_blocked || false;
  const blockedByIds = task.blocked_by || [];
  const dependencyIds = task.dependency_ids || [];
  const hasDependencies = dependencyIds.length > 0;
  const hasDependents = dependentIds.length > 0;

  // Get blocking task info from task map
  const getTaskInfo = (taskId: string): BlockingTaskInfo | null => {
    if (!taskMap) return null;
    const t = taskMap.get(taskId);
    if (!t) return null;
    return { id: t.id, title: t.title, status: t.status };
  };

  // Fetch skills when expanded
  const fetchSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/skills`);
      if (response.ok) {
        const data = await response.json();
        setSkills(data.skills || []);
        setAvailableSkills(data.availableSkills || []);
      }
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoadingSkills(false);
    }
  }, [task.id]);

  useEffect(() => {
    if (expanded) {
      fetchSkills();
    }
  }, [expanded, fetchSkills]);

  // Add skill to task
  const handleAddSkill = async (skillName: string) => {
    const currentSkills = skills.map(s => s.name);
    if (currentSkills.includes(skillName)) return;

    const newSkills = [...currentSkills, skillName];

    try {
      const response = await fetch(`/api/tasks/${task.id}/skills`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: newSkills }),
      });

      if (response.ok) {
        fetchSkills();
      }
    } catch (err) {
      console.error('Failed to add skill:', err);
    }

    setShowSkillDropdown(false);
  };

  // Remove skill from task
  const handleRemoveSkill = async (skillName: string) => {
    const newSkills = skills.map(s => s.name).filter(s => s !== skillName);

    try {
      const response = await fetch(`/api/tasks/${task.id}/skills`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: newSkills }),
      });

      if (response.ok) {
        fetchSkills();
      }
    } catch (err) {
      console.error('Failed to remove skill:', err);
    }
  };

  // Track changes
  const checkForChanges = (newIntent: string, newApproach: string, newDescription: string) => {
    const intentChanged = newIntent !== (task.task_intent || '');
    const approachChanged = newApproach !== (task.task_approach || '');
    const descriptionChanged = newDescription !== (task.description || '');
    setHasChanges(intentChanged || approachChanged || descriptionChanged);
  };

  const handleIntentChange = (value: string) => {
    setTaskIntent(value);
    checkForChanges(value, taskApproach, description);
  };

  const handleApproachChange = (value: string) => {
    setTaskApproach(value);
    checkForChanges(taskIntent, value, description);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    checkForChanges(taskIntent, taskApproach, value);
  };

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description || null,
          task_intent: taskIntent || null,
          task_approach: taskApproach || null,
        }),
      });

      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setHasChanges(false);
        setIsEditingDescription(false);
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

        // Refresh skills if any were detected during optimization
        if (data.detectedSkills && data.detectedSkills.length > 0) {
          fetchSkills();
        }
      }
    } catch (err) {
      console.error('Failed to optimize:', err);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${
      isBlocked
        ? 'border-border/50 bg-bg-secondary/50 opacity-70'
        : 'border-border bg-bg-secondary'
    }`}>
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
          className="flex-1 p-3 text-left hover:bg-bg-tertiary transition-colors"
        >
          <div className="flex items-start gap-2">
            {/* Chevron */}
            <span className={`text-text-tertiary transition-transform mt-0.5 shrink-0 ${expanded ? 'rotate-90' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </span>

            {/* Task info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text-primary text-sm font-medium">
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
                {task.required_skills && (
                  <span className="text-accent text-xs shrink-0" title="Has required skills">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                  </span>
                )}
                {/* Dependency indicators */}
                {hasDependencies && !isBlocked && (
                  <span className="text-text-tertiary text-xs shrink-0" title={`Depends on ${dependencyIds.length} task(s)`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </span>
                )}
                {hasDependents && (
                  <span className="text-status-info text-xs shrink-0" title={`${dependentIds.length} task(s) depend on this`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </span>
                )}
              </div>
              {task.description && !expanded && (
                <p className="text-text-tertiary text-xs mt-1 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>

            {/* Status badges - always visible */}
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              {isBlocked && (
                <Badge variant="warning" className="text-[10px]" title={`Blocked by ${blockedByIds.length} task(s)`}>
                  Blocked ({blockedByIds.length})
                </Badge>
              )}
              <Badge variant={status.variant}>
                {status.label}
              </Badge>
            </div>
          </div>
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Description - Editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                Description
              </label>
              {!isEditingDescription && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingDescription(true)}
                  className="text-xs h-6 px-2"
                >
                  Edit
                </Button>
              )}
            </div>
            {isEditingDescription ? (
              <textarea
                value={description}
                onChange={(e) => handleDescriptionChange(e.target.value)}
                placeholder="Brief description of the task..."
                className="w-full h-20 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                autoFocus
              />
            ) : (
              <p className="text-text-secondary text-sm">
                {description || <span className="text-text-tertiary italic">No description</span>}
              </p>
            )}
          </div>

          {/* Dependencies Section - Show if task has dependencies or dependents */}
          {(hasDependencies || hasDependents) && (
            <div className="p-3 bg-bg-tertiary rounded-lg space-y-3">
              {/* Blocked by (incomplete dependencies) */}
              {isBlocked && blockedByIds.length > 0 && (
                <div>
                  <p className="text-xs text-status-warning font-medium mb-1.5 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    Blocked by ({blockedByIds.length})
                  </p>
                  <div className="space-y-1">
                    {blockedByIds.map((depId) => {
                      const info = getTaskInfo(depId);
                      return (
                        <div key={depId} className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            info?.status === 'running' ? 'bg-status-info/20 text-status-info' :
                            info?.status === 'claimed' ? 'bg-status-info/20 text-status-info' :
                            info?.status === 'failed' ? 'bg-status-error/20 text-status-error' :
                            'bg-bg-secondary text-text-tertiary'
                          }`}>
                            {info?.status || 'pending'}
                          </span>
                          <span className="text-text-secondary truncate">
                            {info?.title || depId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All Dependencies (including completed ones) */}
              {hasDependencies && !isBlocked && (
                <div>
                  <p className="text-xs text-text-tertiary font-medium mb-1.5 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                    Depends on ({dependencyIds.length})
                  </p>
                  <div className="space-y-1">
                    {dependencyIds.map((depId) => {
                      const info = getTaskInfo(depId);
                      return (
                        <div key={depId} className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            info?.status === 'completed' ? 'bg-status-success/20 text-status-success' :
                            info?.status === 'running' ? 'bg-status-info/20 text-status-info' :
                            info?.status === 'failed' ? 'bg-status-error/20 text-status-error' :
                            'bg-bg-secondary text-text-tertiary'
                          }`}>
                            {info?.status || 'pending'}
                          </span>
                          <span className="text-text-secondary truncate">
                            {info?.title || depId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dependents (tasks that depend on this task) */}
              {hasDependents && (
                <div>
                  <p className="text-xs text-status-info font-medium mb-1.5 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                    Blocking ({dependentIds.length})
                  </p>
                  <div className="space-y-1">
                    {dependentIds.map((depId) => {
                      const info = getTaskInfo(depId);
                      return (
                        <div key={depId} className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            info?.status === 'completed' ? 'bg-status-success/20 text-status-success' :
                            info?.status === 'running' ? 'bg-status-info/20 text-status-info' :
                            info?.status === 'pending' ? 'bg-bg-secondary text-text-tertiary' :
                            'bg-bg-secondary text-text-tertiary'
                          }`}>
                            {info?.status || 'pending'}
                          </span>
                          <span className="text-text-secondary truncate">
                            {info?.title || depId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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

          {/* Skills Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                Required Skills
              </label>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSkillDropdown(!showSkillDropdown)}
                  className="text-xs h-6 px-2"
                >
                  + Add Skill
                </Button>
                {showSkillDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-bg-primary border border-border rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
                    {availableSkills
                      .filter(s => !skills.some(sk => sk.name === s.name))
                      .map((skill) => (
                        <button
                          key={skill.id}
                          onClick={() => handleAddSkill(skill.name)}
                          className="w-full text-left px-3 py-2 hover:bg-bg-secondary text-sm"
                        >
                          <span className="text-text-primary">{skill.name}</span>
                          <span className="text-text-tertiary text-xs ml-2">({skill.category})</span>
                        </button>
                      ))
                    }
                    {availableSkills.filter(s => !skills.some(sk => sk.name === s.name)).length === 0 && (
                      <p className="px-3 py-2 text-text-tertiary text-sm">No more skills available</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {loadingSkills ? (
              <p className="text-text-tertiary text-sm">Loading skills...</p>
            ) : skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <div
                    key={skill.name}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                      skill.status === 'ready'
                        ? 'bg-status-success/10 border-status-success/30 text-status-success'
                        : skill.status === 'needs_api_key'
                        ? 'bg-status-warning/10 border-status-warning/30 text-status-warning'
                        : 'bg-accent/10 border-accent/30 text-accent'
                    }`}
                  >
                    <span>
                      {skill.status === 'ready' && '✓'}
                      {skill.status === 'needs_api_key' && '⚠'}
                      {skill.status === 'will_be_built' && '⏳'}
                    </span>
                    <span>{skill.name}</span>
                    {skill.status === 'needs_api_key' && skill.missingKeys && (
                      <span className="text-[10px] opacity-80">
                        (needs: {skill.missingKeys.join(', ')})
                      </span>
                    )}
                    <button
                      onClick={() => handleRemoveSkill(skill.name)}
                      className="ml-1 opacity-60 hover:opacity-100"
                      title="Remove skill"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-tertiary text-sm">
                No skills mapped. Skills will be auto-detected when you optimize the approach.
              </p>
            )}
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
                      setDescription(task.description || '');
                      setIsEditingDescription(false);
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
