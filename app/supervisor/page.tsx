'use client';

/**
 * Supervisor Page
 *
 * A comprehensive view of all escalation analytics including:
 * - Summary statistics and key metrics
 * - Trigger type leaderboard
 * - Time-based trend visualization
 * - Detailed escalation drill-down
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { EscalationDetailModal } from '@/app/components/EscalationDetailModal';
import { EscalationTrends } from '@/app/components/EscalationTrends';
import { ImprovementPreviewModal } from '@/app/components/ImprovementPreviewModal';

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
  by_incorporation?: {
    new: number;
    incorporated: number;
  };
  avg_resolution_time_ms: number | null;
}

type ActiveSection = 'overview' | 'leaderboard' | 'trends';

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
  if (minutes > 0) return `${minutes}m`;
  return '< 1m';
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

export default function SupervisorPage(): JSX.Element {
  const router = useRouter();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [selectedEscalationId, setSelectedEscalationId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ActiveSection>('overview');
  const [showImprovementModal, setShowImprovementModal] = useState(false);

  const fetchInsights = useCallback(async () => {
    try {
      const response = await fetch('/api/insights/escalations');
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
  }, []);

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, 30000);
    return () => clearInterval(interval);
  }, [fetchInsights]);

  const handleToggleExpand = (triggerType: string): void => {
    setExpandedType(expandedType === triggerType ? null : triggerType);
  };

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto p-6 pb-20">
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-semibold text-text-primary">Supervisor</h1>
          <p className="text-text-secondary mt-1">
            Monitor escalations, trends, and system health
          </p>
        </div>
        <Card padding="lg">
          <CardContent>
            <div className="text-center py-12">
              <p className="text-text-tertiary">Loading insights...</p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-6xl mx-auto p-6 pb-20">
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-semibold text-text-primary">Supervisor</h1>
        </div>
        <Card padding="lg">
          <CardContent>
            <div className="text-center py-12">
              <p className="text-status-error">{error}</p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!data || data.total_escalations === 0) {
    return (
      <main className="max-w-6xl mx-auto p-6 pb-20">
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-semibold text-text-primary">Supervisor</h1>
          <p className="text-text-secondary mt-1">
            Monitor escalations, trends, and system health
          </p>
        </div>
        <Card padding="lg">
          <CardContent>
            <div className="text-center py-12">
              <p className="text-text-secondary mb-2">No escalations recorded yet</p>
              <p className="text-text-tertiary text-sm">
                Escalations are created when workers encounter ambiguity and need human input.
                As your workers run, patterns will emerge here.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const maxCount = data.by_trigger_type.length > 0 ? data.by_trigger_type[0].count : 1;
  const resolutionRate = data.total_escalations > 0
    ? Math.round(((data.by_status.answered + data.by_status.dismissed) / data.total_escalations) * 100)
    : 0;

  return (
    <main className="max-w-6xl mx-auto p-6 pb-20">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/')}
          className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
        >
          ← Back to Dashboard
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Supervisor</h1>
            <p className="text-text-secondary mt-1">
              Monitor escalations, trends, and system health to reduce worker babysitting
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="default">{data.total_escalations} total</Badge>
            {data.by_incorporation && data.by_incorporation.new > 0 && (
              <Badge variant="warning" title="Escalations not yet addressed by improvement outcomes">
                {data.by_incorporation.new} unaddressed
              </Badge>
            )}
            {data.by_incorporation && data.by_incorporation.incorporated > 0 && (
              <Badge variant="success" title="Escalations incorporated into improvement outcomes">
                {data.by_incorporation.incorporated} addressed
              </Badge>
            )}
            <Button
              variant="primary"
              onClick={() => setShowImprovementModal(true)}
            >
              Analyze &amp; Improve
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card padding="md">
          <CardContent>
            <div className="text-2xl font-semibold text-text-primary">{data.total_escalations}</div>
            <div className="text-sm text-text-secondary">Total Escalations</div>
          </CardContent>
        </Card>
        <Card padding="md">
          <CardContent>
            <div className="text-2xl font-semibold text-status-warning">{data.by_status.pending}</div>
            <div className="text-sm text-text-secondary">Pending</div>
          </CardContent>
        </Card>
        <Card padding="md">
          <CardContent>
            <div className="text-2xl font-semibold text-status-success">{resolutionRate}%</div>
            <div className="text-sm text-text-secondary">Resolution Rate</div>
          </CardContent>
        </Card>
        <Card padding="md">
          <CardContent>
            <div className="text-2xl font-semibold text-text-primary">
              {formatDuration(data.avg_resolution_time_ms)}
            </div>
            <div className="text-sm text-text-secondary">Avg. Resolution Time</div>
          </CardContent>
        </Card>
      </div>

      {/* Section Navigation */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveSection('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeSection === 'overview'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveSection('leaderboard')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeSection === 'leaderboard'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Trigger Leaderboard
        </button>
        <button
          onClick={() => setActiveSection('trends')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeSection === 'trends'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Trends Over Time
        </button>
      </div>

      {/* Section Content */}
      {activeSection === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Breakdown */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Pending */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-status-warning" />
                      <span className="text-text-primary text-sm">Pending</span>
                    </div>
                    <span className="text-text-secondary text-sm">{data.by_status.pending}</span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-status-warning rounded-full transition-all duration-300"
                      style={{ width: `${data.total_escalations > 0 ? (data.by_status.pending / data.total_escalations) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Answered */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-status-success" />
                      <span className="text-text-primary text-sm">Answered</span>
                    </div>
                    <span className="text-text-secondary text-sm">{data.by_status.answered}</span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-status-success rounded-full transition-all duration-300"
                      style={{ width: `${data.total_escalations > 0 ? (data.by_status.answered / data.total_escalations) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Dismissed */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-text-tertiary" />
                      <span className="text-text-primary text-sm">Dismissed</span>
                    </div>
                    <span className="text-text-secondary text-sm">{data.by_status.dismissed}</span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-text-tertiary rounded-full transition-all duration-300"
                      style={{ width: `${data.total_escalations > 0 ? (data.by_status.dismissed / data.total_escalations) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Trigger Types */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Top Trigger Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.by_trigger_type.slice(0, 5).map((item, index) => (
                  <div key={item.trigger_type} className="flex items-center gap-3">
                    <span className="w-5 text-center text-text-tertiary text-sm font-medium">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-text-primary truncate">
                          {formatTriggerType(item.trigger_type)}
                        </span>
                        <span className="text-sm text-text-secondary font-medium ml-2">
                          {item.count}
                        </span>
                      </div>
                      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent-primary rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(10, (item.count / maxCount) * 100)}%` }}
                        />
                      </div>
                    </div>
                    {item.pending_count > 0 && (
                      <Badge variant="warning" size="sm">
                        {item.pending_count}
                      </Badge>
                    )}
                  </div>
                ))}
                {data.by_trigger_type.length > 5 && (
                  <button
                    onClick={() => setActiveSection('leaderboard')}
                    className="text-xs text-accent hover:text-accent-hover w-full text-center pt-2"
                  >
                    View all {data.by_trigger_type.length} trigger types →
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.by_status.pending > 0 && (
                  <div className="p-3 rounded-lg border border-status-warning/30 bg-status-warning/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-text-primary text-sm font-medium">
                          {data.by_status.pending} Pending Escalation{data.by_status.pending !== 1 ? 's' : ''}
                        </p>
                        <p className="text-text-tertiary text-xs mt-1">
                          Workers are waiting for your input
                        </p>
                      </div>
                      <Badge variant="warning">Action Required</Badge>
                    </div>
                  </div>
                )}
                <p className="text-text-tertiary text-sm">
                  Review escalation patterns to identify common blockers and improve
                  your outcome specifications or skills.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Insights Summary */}
          <Card padding="md">
            <CardHeader>
              <CardTitle>Insights Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {data.by_trigger_type.length > 0 && (
                  <p className="text-text-secondary">
                    <span className="text-text-primary font-medium">
                      {formatTriggerType(data.by_trigger_type[0].trigger_type)}
                    </span>{' '}
                    is your most common escalation type with {data.by_trigger_type[0].count} occurrences.
                  </p>
                )}
                {data.avg_resolution_time_ms !== null && (
                  <p className="text-text-secondary">
                    On average, escalations are resolved in{' '}
                    <span className="text-text-primary font-medium">
                      {formatDuration(data.avg_resolution_time_ms)}
                    </span>.
                  </p>
                )}
                {resolutionRate >= 80 && (
                  <p className="text-status-success">
                    Great job! You have a high resolution rate of {resolutionRate}%.
                  </p>
                )}
                {resolutionRate < 50 && data.by_status.pending > 0 && (
                  <p className="text-status-warning">
                    Consider addressing pending escalations to help workers progress.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeSection === 'leaderboard' && (
        <Card padding="md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Trigger Type Leaderboard</CardTitle>
              <Badge variant="default">{data.by_trigger_type.length} types</Badge>
            </div>
            <p className="text-text-tertiary text-xs mt-1">
              Click on a trigger type to see recent examples
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.by_trigger_type.map((item, index) => {
                const isExpanded = expandedType === item.trigger_type;
                const barWidth = Math.max(10, (item.count / maxCount) * 100);

                return (
                  <div key={item.trigger_type}>
                    {/* Leaderboard row */}
                    <div
                      className="flex items-center gap-3 cursor-pointer hover:bg-bg-tertiary rounded-lg p-3 -mx-3 transition-colors"
                      onClick={() => handleToggleExpand(item.trigger_type)}
                    >
                      {/* Rank */}
                      <span className="w-6 text-center text-text-tertiary text-sm font-medium">
                        {index + 1}
                      </span>

                      {/* Type and bar */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-text-primary">
                            {formatTriggerType(item.trigger_type)}
                          </span>
                          <div className="flex items-center gap-2 ml-2">
                            <span className="text-sm text-text-secondary font-medium">
                              {item.count}
                            </span>
                            <span className="text-xs text-text-tertiary">
                              ({Math.round((item.count / data.total_escalations) * 100)}%)
                            </span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-primary rounded-full transition-all duration-300"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>

                        {/* Status breakdown */}
                        <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                            {item.answered_count} answered
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />
                            {item.pending_count} pending
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
                            {item.dismissed_count} dismissed
                          </span>
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
                      <div className="ml-9 mt-2 mb-4 space-y-2">
                        <div className="text-xs text-text-tertiary mb-2">
                          Recent examples • Avg. resolution: {formatDuration(item.avg_resolution_time_ms)}
                        </div>
                        {item.recent_escalations.map((esc) => (
                          <div
                            key={esc.id}
                            className="p-3 rounded-lg border border-border text-sm cursor-pointer hover:border-accent transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEscalationId(esc.id);
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
      )}

      {activeSection === 'trends' && (
        <EscalationTrends defaultPeriod="daily" defaultDays={30} />
      )}

      {/* Escalation Detail Modal */}
      {selectedEscalationId && (
        <EscalationDetailModal
          escalationId={selectedEscalationId}
          onClose={() => setSelectedEscalationId(null)}
        />
      )}

      {/* Improvement Preview Modal */}
      {showImprovementModal && (
        <ImprovementPreviewModal
          onClose={() => setShowImprovementModal(false)}
          onSuccess={() => {
            setShowImprovementModal(false);
            fetchInsights();
          }}
          lookbackDays={30}
        />
      )}
    </main>
  );
}
