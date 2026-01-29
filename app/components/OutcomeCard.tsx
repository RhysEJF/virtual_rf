'use client';

import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Progress } from './ui/Progress';
import { Button } from './ui/Button';
import type { OutcomeStatus } from '@/lib/db/schema';

export interface OutcomeWithCounts {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;
  brief: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  pending_tasks: number;
  completed_tasks: number;
  total_tasks: number;
  active_workers: number;
  is_converging: boolean;
}

export interface OutcomeCardProps {
  outcome: OutcomeWithCounts;
  onStartWorker?: () => void;
  onPause?: () => void;
  onAchieve?: () => void;
  onClick?: () => void;
}

const statusConfig: Record<
  OutcomeStatus,
  { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }
> = {
  active: { label: 'Active', variant: 'success' },
  dormant: { label: 'Dormant', variant: 'warning' },
  achieved: { label: 'Achieved', variant: 'success' },
  archived: { label: 'Archived', variant: 'default' },
};

export function OutcomeCard({
  outcome,
  onStartWorker,
  onPause,
  onAchieve,
  onClick,
}: OutcomeCardProps): JSX.Element {
  const status = statusConfig[outcome.status];
  const progressPercent = outcome.total_tasks > 0
    ? (outcome.completed_tasks / outcome.total_tasks) * 100
    : 0;
  const isActive = outcome.status === 'active';
  const isDormant = outcome.status === 'dormant';
  const hasWorkers = outcome.active_workers > 0;

  // Format last activity
  const lastActivity = new Date(outcome.last_activity_at);
  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - lastActivity.getTime()) / 60000);
  let activityText = 'Just now';
  if (diffMinutes > 60 * 24) {
    activityText = `${Math.floor(diffMinutes / (60 * 24))}d ago`;
  } else if (diffMinutes > 60) {
    activityText = `${Math.floor(diffMinutes / 60)}h ago`;
  } else if (diffMinutes > 0) {
    activityText = `${diffMinutes}m ago`;
  }

  return (
    <Card hover={!!onClick} onClick={onClick} className="group">
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              hasWorkers ? 'bg-status-success animate-pulse' :
              isActive ? 'bg-accent' :
              isDormant ? 'bg-status-warning' :
              'bg-text-tertiary'
            }`}
          />
          <CardTitle className="truncate">{outcome.name}</CardTitle>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {outcome.is_ongoing && (
            <Badge variant="info" className="text-[10px]">Ongoing</Badge>
          )}
          {outcome.is_converging && (
            <Badge variant="success" className="text-[10px]">Converging</Badge>
          )}
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
      </CardHeader>

      <CardContent>
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm mb-3">
          <span className="text-text-secondary">
            <span className="text-text-primary font-medium">{outcome.completed_tasks}</span>
            <span className="text-text-tertiary">/{outcome.total_tasks}</span> tasks
          </span>
          {outcome.active_workers > 0 && (
            <span className="text-text-secondary">
              <span className="text-text-primary font-medium">{outcome.active_workers}</span> worker{outcome.active_workers !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-text-tertiary text-xs ml-auto">
            {activityText}
          </span>
        </div>

        {/* Progress bar */}
        {outcome.total_tasks > 0 && (
          <div className="mb-3">
            <Progress
              value={progressPercent}
              showLabel
              variant={outcome.status === 'achieved' ? 'success' : 'default'}
            />
          </div>
        )}

        {/* Pending tasks indicator */}
        {outcome.pending_tasks > 0 && !hasWorkers && isActive && (
          <div className="text-xs text-text-tertiary mb-3">
            {outcome.pending_tasks} task{outcome.pending_tasks !== 1 ? 's' : ''} ready
          </div>
        )}

        {/* View outputs link - show when work has been done */}
        {outcome.completed_tasks > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `/outcome/${outcome.id}#outputs`;
            }}
            className="text-xs text-accent hover:text-accent-hover mb-2"
          >
            View outputs
          </button>
        )}

        {/* Actions */}
        {(isActive || isDormant) && (onStartWorker || onPause || onAchieve) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            {isActive && !hasWorkers && outcome.pending_tasks > 0 && onStartWorker && (
              <Button
                variant="primary"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onStartWorker(); }}
              >
                Start Worker
              </Button>
            )}
            {isActive && onPause && (
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onPause(); }}
              >
                Pause
              </Button>
            )}
            {isDormant && onStartWorker && outcome.pending_tasks > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onStartWorker(); }}
              >
                Resume
              </Button>
            )}
            {outcome.is_converging && onAchieve && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onAchieve(); }}
              >
                Mark Achieved
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
