'use client';

import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Progress } from './ui/Progress';
import { Button } from './ui/Button';
import type { Project, ProjectStatus, WorkerProgress } from '@/lib/db/schema';

export interface ProjectCardProps {
  project: Project;
  workerCount?: number;
  progress?: WorkerProgress;
  totalCost?: number;
  estimatedTimeRemaining?: string;
  onPause?: () => void;
  onResume?: () => void;
  onIntervene?: () => void;
  onClick?: () => void;
}

const statusConfig: Record<
  ProjectStatus,
  { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }
> = {
  pending: { label: 'Pending', variant: 'default' },
  briefing: { label: 'Briefing', variant: 'info' },
  active: { label: 'Active', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
};

export function ProjectCard({
  project,
  workerCount = 0,
  progress,
  totalCost = 0,
  estimatedTimeRemaining,
  onPause,
  onResume,
  onIntervene,
  onClick,
}: ProjectCardProps): JSX.Element {
  const status = statusConfig[project.status];
  const progressPercent = progress ? (progress.completed / Math.max(progress.total, 1)) * 100 : 0;
  const isActive = project.status === 'active';
  const isPaused = project.status === 'paused';

  return (
    <Card hover={!!onClick} onClick={onClick} className="group">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isActive ? 'bg-status-success animate-pulse' : isPaused ? 'bg-status-warning' : 'bg-text-tertiary'}`}
          />
          <CardTitle>{project.name}</CardTitle>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </CardHeader>

      <CardContent>
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm mb-3">
          <span className="text-text-secondary">
            <span className="text-text-primary font-medium">{workerCount}</span> agent{workerCount !== 1 ? 's' : ''}
          </span>
          {estimatedTimeRemaining && (
            <span className="text-text-secondary">
              ~<span className="text-text-primary">{estimatedTimeRemaining}</span> remaining
            </span>
          )}
          <span className="text-text-secondary">
            $<span className="text-text-primary font-medium">{totalCost.toFixed(2)}</span>
          </span>
        </div>

        {/* Progress bar */}
        {progress && progress.total > 0 && (
          <div className="mb-3">
            <Progress
              value={progressPercent}
              showLabel
              variant={project.status === 'completed' ? 'success' : 'default'}
            />
          </div>
        )}

        {/* Actions */}
        {(isActive || isPaused) && (onPause || onResume || onIntervene) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            {isActive && onPause && (
              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onPause(); }}>
                Pause
              </Button>
            )}
            {isPaused && onResume && (
              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onResume(); }}>
                Resume
              </Button>
            )}
            {onIntervene && (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onIntervene(); }}>
                Intervene
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
