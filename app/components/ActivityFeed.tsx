'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from './ui/Card';
import type { Activity, ActivityType } from '@/lib/db/schema';

interface ActivityFeedProps {
  onOutcomeClick?: (outcomeId: string) => void;
  outcomeId?: string; // Filter to specific outcome
  showFilter?: boolean; // Show outcome filter dropdown
}

// Activity type icons and colors
const activityConfig: Record<ActivityType, { icon: string; color: string }> = {
  task_completed: { icon: '✓', color: 'text-status-success' },
  task_claimed: { icon: '→', color: 'text-accent' },
  task_failed: { icon: '✗', color: 'text-status-error' },
  worker_started: { icon: '▶', color: 'text-status-success' },
  worker_completed: { icon: '■', color: 'text-status-success' },
  worker_failed: { icon: '!', color: 'text-status-error' },
  review_completed: { icon: '◎', color: 'text-status-info' },
  outcome_created: { icon: '+', color: 'text-accent' },
  outcome_achieved: { icon: '★', color: 'text-status-warning' },
  design_updated: { icon: '◇', color: 'text-text-secondary' },
  intent_updated: { icon: '◆', color: 'text-text-secondary' },
};

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

interface OutcomeOption {
  id: string;
  name: string;
}

export function ActivityFeed({ onOutcomeClick, outcomeId, showFilter = false }: ActivityFeedProps): JSX.Element {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOutcomeId, setFilterOutcomeId] = useState<string>(outcomeId || '');
  const [outcomeOptions, setOutcomeOptions] = useState<OutcomeOption[]>([]);

  // Fetch outcome options for filter
  useEffect(() => {
    if (!showFilter) return;
    const fetchOutcomes = async () => {
      try {
        const response = await fetch('/api/outcomes');
        const data = await response.json();
        const options = (data.outcomes || []).map((o: { id: string; name: string }) => ({
          id: o.id,
          name: o.name,
        }));
        setOutcomeOptions(options);
      } catch (error) {
        console.error('Failed to fetch outcomes:', error);
      }
    };
    fetchOutcomes();
  }, [showFilter]);

  const fetchActivity = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (filterOutcomeId) {
        params.set('outcome_id', filterOutcomeId);
      }
      const response = await fetch(`/api/activity?${params}`);
      const data = await response.json();
      setActivities(data.activities || []);
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    } finally {
      setLoading(false);
    }
  }, [filterOutcomeId]);

  useEffect(() => {
    fetchActivity();
    // Poll for new activity every 10 seconds
    const interval = setInterval(fetchActivity, 10000);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  const filterDropdown = showFilter && (
    <div className="mb-3">
      <select
        value={filterOutcomeId}
        onChange={(e) => setFilterOutcomeId(e.target.value)}
        className="w-full text-xs bg-bg-secondary border border-border rounded px-2 py-1.5 text-text-secondary focus:outline-none focus:border-accent"
      >
        <option value="">All Outcomes</option>
        {outcomeOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );

  if (loading) {
    return (
      <div>
        {filterDropdown}
        <div className="text-text-tertiary text-sm">Loading activity...</div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div>
        {filterDropdown}
        <Card padding="md">
          <CardContent>
            <p className="text-text-tertiary text-sm">
              {filterOutcomeId ? 'No activity for this outcome yet.' : 'No activity yet. Create an outcome to get started!'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {filterDropdown}
      <div className="space-y-2 max-h-[70vh] overflow-y-auto">
      {activities.map((activity) => {
        const config = activityConfig[activity.type] || { icon: '•', color: 'text-text-secondary' };

        return (
          <Card
            key={activity.id}
            padding="sm"
            hover={!!onOutcomeClick}
            onClick={() => onOutcomeClick?.(activity.outcome_id)}
            className="group"
          >
            <CardContent>
              <div className="flex items-start gap-3">
                <span className={`w-5 h-5 flex items-center justify-center rounded ${config.color} bg-bg-tertiary text-xs font-medium`}>
                  {config.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm leading-tight">
                    {activity.title}
                  </p>
                  {activity.description && (
                    <p className="text-text-tertiary text-xs mt-0.5 truncate">
                      {activity.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {activity.outcome_name && (
                      <span className="text-text-tertiary text-xs truncate max-w-[120px]">
                        {activity.outcome_name}
                      </span>
                    )}
                    <span className="text-text-tertiary text-xs">
                      {formatTimeAgo(activity.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
