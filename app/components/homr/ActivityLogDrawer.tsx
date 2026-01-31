'use client';

/**
 * HOMЯ Activity Log Drawer
 *
 * Shows full activity history with filtering by type.
 */

import { useState, useEffect } from 'react';
import { Badge } from '../ui/Badge';

interface ActivityItem {
  id: string;
  outcomeId: string;
  type: 'observation' | 'steering' | 'escalation' | 'resolution';
  summary: string;
  details: Record<string, unknown>;
  createdAt: number;
}

interface Props {
  outcomeId: string;
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  observation: { label: 'Observation', variant: 'info' },
  steering: { label: 'Steering', variant: 'success' },
  escalation: { label: 'Escalation', variant: 'warning' },
  resolution: { label: 'Resolution', variant: 'success' },
};

export function ActivityLogDrawer({ outcomeId, isOpen, onClose }: Props): JSX.Element | null {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    async function fetchActivity(): Promise<void> {
      setLoading(true);
      try {
        const url = filter
          ? `/api/outcomes/${outcomeId}/homr/activity?type=${filter}&limit=50`
          : `/api/outcomes/${outcomeId}/homr/activity?limit=50`;

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setActivity(data.activity);
        }
      } catch (err) {
        console.error('Failed to fetch activity:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchActivity();
  }, [outcomeId, isOpen, filter]);

  if (!isOpen) return null;

  // Group activity by date
  const groupedActivity = groupByDate(activity);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-bg-primary border-l border-border h-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-text-primary">HOMЯ Activity Log</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            X
          </button>
        </div>

        {/* Filter */}
        <div className="flex gap-2 p-4 border-b border-border">
          <FilterButton
            label="All"
            active={filter === null}
            onClick={() => setFilter(null)}
          />
          <FilterButton
            label="Observations"
            active={filter === 'observation'}
            onClick={() => setFilter('observation')}
          />
          <FilterButton
            label="Steering"
            active={filter === 'steering'}
            onClick={() => setFilter('steering')}
          />
          <FilterButton
            label="Escalations"
            active={filter === 'escalation'}
            onClick={() => setFilter('escalation')}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-text-secondary text-sm">Loading...</p>
          ) : activity.length === 0 ? (
            <p className="text-text-secondary text-sm">No activity yet.</p>
          ) : (
            Object.entries(groupedActivity).map(([date, items]) => (
              <div key={date} className="mb-6">
                <h3 className="text-xs font-medium text-text-muted uppercase mb-3">
                  {date}
                </h3>
                <div className="space-y-3">
                  {items.map((item) => (
                    <ActivityItemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-full transition-colors ${
        active
          ? 'bg-accent-primary text-white'
          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'
      }`}
    >
      {label}
    </button>
  );
}

function ActivityItemCard({ item }: { item: ActivityItem }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TYPE_LABELS[item.type] || { label: item.type, variant: 'default' as const };

  return (
    <div
      className="p-3 bg-bg-secondary rounded-lg cursor-pointer hover:bg-bg-tertiary transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between mb-1">
        <Badge variant={typeInfo.variant} size="sm">
          {typeInfo.label}
        </Badge>
        <span className="text-xs text-text-muted">
          {formatTime(item.createdAt)}
        </span>
      </div>
      <p className="text-sm text-text-primary">{item.summary}</p>

      {expanded && Object.keys(item.details).length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <pre className="text-xs text-text-secondary overflow-x-auto">
            {JSON.stringify(item.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function groupByDate(items: ActivityItem[]): Record<string, ActivityItem[]> {
  const groups: Record<string, ActivityItem[]> = {};

  for (const item of items) {
    const date = new Date(item.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let dateKey: string;
    if (isSameDay(date, today)) {
      dateKey = 'Today';
    } else if (isSameDay(date, yesterday)) {
      dateKey = 'Yesterday';
    } else {
      dateKey = date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    }

    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(item);
  }

  return groups;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
