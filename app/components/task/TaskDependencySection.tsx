'use client';

import type { TaskStatus } from '@/lib/db/schema';

interface BlockingTaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
}

interface TaskWithDeps {
  is_blocked?: boolean;
  blocked_by?: string[];
  dependency_ids?: string[];
}

interface TaskDependencySectionProps {
  task: TaskWithDeps;
  taskMap?: Map<string, { id: string; title: string; status: TaskStatus }>;
  dependentIds: string[];
}

export function TaskDependencySection({ task, taskMap, dependentIds }: TaskDependencySectionProps): JSX.Element | null {
  const isBlocked = task.is_blocked || false;
  const blockedByIds = task.blocked_by || [];
  const dependencyIds = task.dependency_ids || [];
  const hasDependencies = dependencyIds.length > 0;
  const hasDependents = dependentIds.length > 0;

  const getTaskInfo = (taskId: string): BlockingTaskInfo | null => {
    if (!taskMap) return null;
    const t = taskMap.get(taskId);
    if (!t) return null;
    return { id: t.id, title: t.title, status: t.status };
  };

  if (!hasDependencies && !hasDependents) return null;

  return (
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
  );
}
