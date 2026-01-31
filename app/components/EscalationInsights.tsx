'use client';

/**
 * Escalation Insights Component
 *
 * Displays a leaderboard of escalation trigger types by frequency
 * with click-to-expand recent examples for each type.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

interface RecentEscalation {
  id: string;
  outcome_id: string;
  question_text: string;
  status: 'pending' | 'answered' | 'dismissed';
  created_at: number;
}

interface TriggerTypeAggregation {
  trigger_type: string;
  count: number;
  pending_count: number;
  answered_count: number;
  dismissed_count: number;
  avg_resolution_time_ms: number | null;
  recent_escalations: RecentEscalation[];
}

interface InsightsData {
  total_escalations: number;
  by_trigger_type: TriggerTypeAggregation[];
  by_status: {
    pending: number;
    answered: number;
    dismissed: number;
  };
  avg_resolution_time_ms: number | null;
}

interface EscalationInsightsProps {
  outcomeId?: string;
  onEscalationClick?: (escalationId: string, outcomeId: string) => void;
}

const triggerTypeLabels: Record<string, string> = {
  unclear_requirement: 'Unclear Requirement',
  conflicting_info: 'Conflicting Info',
  missing_context: 'Missing Context',
  scope_ambiguity: 'Scope Ambiguity',
  technical_decision: 'Technical Decision',
  priority_conflict: 'Priority Conflict',
  dependency_unclear: 'Dependency Unclear',
  success_criteria: 'Success Criteria',
};

function formatTriggerType(triggerType: string): string {
  return triggerTypeLabels[triggerType] || triggerType.replace(/_/g, ' ');
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function EscalationInsights({ outcomeId, onEscalationClick }: EscalationInsightsProps): JSX.Element {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (outcomeId) {
        params.set('outcome_id', outcomeId);
      }

      const response = await fetch(`/api/insights/escalations?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch escalation insights');
      }

      const insights = await response.json();
      setData(insights);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchInsights]);

  const handleToggleExpand = (triggerType: string): void => {
    setExpandedType(expandedType === triggerType ? null : triggerType);
  };

  if (loading) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Escalation Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-text-tertiary text-sm">Loading insights...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Escalation Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-status-error text-sm">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.total_escalations === 0) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Escalation Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-text-tertiary text-sm">No escalations recorded yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxCount = data.by_trigger_type.length > 0 ? data.by_trigger_type[0].count : 1;

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Escalation Insights</CardTitle>
          <Badge variant="default">{data.total_escalations} total</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-warning" />
            {data.by_status.pending} pending
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-success" />
            {data.by_status.answered} answered
          </span>
        </div>
      </CardHeader>

      <CardContent>
        {/* Summary stats */}
        {data.avg_resolution_time_ms !== null && (
          <div className="mb-4 pb-4 border-b border-border">
            <p className="text-xs text-text-tertiary">
              Avg. resolution time: <span className="text-text-secondary">{formatDuration(data.avg_resolution_time_ms)}</span>
            </p>
          </div>
        )}

        {/* Trigger type leaderboard */}
        <div className="space-y-2">
          {data.by_trigger_type.map((item, index) => {
            const isExpanded = expandedType === item.trigger_type;
            const barWidth = Math.max(10, (item.count / maxCount) * 100);

            return (
              <div key={item.trigger_type}>
                {/* Leaderboard row */}
                <div
                  className="flex items-center gap-3 cursor-pointer hover:bg-bg-tertiary rounded-lg p-2 -mx-2 transition-colors"
                  onClick={() => handleToggleExpand(item.trigger_type)}
                >
                  {/* Rank */}
                  <span className="w-5 text-center text-text-tertiary text-sm font-medium">
                    {index + 1}
                  </span>

                  {/* Type and bar */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-text-primary truncate">
                        {formatTriggerType(item.trigger_type)}
                      </span>
                      <span className="text-sm text-text-secondary font-medium ml-2">
                        {item.count}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-primary rounded-full transition-all duration-300"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>

                  {/* Pending indicator */}
                  {item.pending_count > 0 && (
                    <Badge variant="warning" size="sm">
                      {item.pending_count} pending
                    </Badge>
                  )}

                  {/* Expand indicator */}
                  <span className={`text-text-tertiary transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    ▾
                  </span>
                </div>

                {/* Expanded recent examples */}
                {isExpanded && item.recent_escalations.length > 0 && (
                  <div className="ml-8 mt-2 mb-3 space-y-2">
                    <div className="text-xs text-text-tertiary mb-2">
                      Recent examples • Avg. resolution: {formatDuration(item.avg_resolution_time_ms)}
                    </div>
                    {item.recent_escalations.map((esc) => (
                      <div
                        key={esc.id}
                        className={`p-2 rounded border border-border text-sm ${
                          onEscalationClick ? 'cursor-pointer hover:border-border-hover' : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEscalationClick?.(esc.id, esc.outcome_id);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-text-primary text-sm line-clamp-2">
                            {esc.question_text}
                          </p>
                          <Badge
                            variant={
                              esc.status === 'pending'
                                ? 'warning'
                                : esc.status === 'answered'
                                  ? 'success'
                                  : 'default'
                            }
                            size="sm"
                          >
                            {esc.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-text-tertiary mt-1">
                          {formatTime(esc.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
