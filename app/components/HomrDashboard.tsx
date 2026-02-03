'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { EscalationAlert } from './homr/EscalationAlert';
import { OutcomeRetro } from './OutcomeRetro';

type AutoResolveMode = 'manual' | 'semi-auto' | 'full-auto';

interface AutoResolveConfig {
  mode: AutoResolveMode;
  confidenceThreshold: number;
}

interface HomrStats {
  enabled: boolean;
  context: {
    discoveries: number;
    decisions: number;
    constraints: number;
  };
  stats: {
    tasksObserved: number;
    discoveriesExtracted: number;
    escalationsCreated: number;
    steeringActions: number;
  };
  pendingEscalations: number;
  recentActivity: Array<{
    id: string;
    type: string;
    summary: string;
    createdAt: number;
  }>;
}

interface Escalation {
  id: string;
  outcomeId: string;
  createdAt: number;
  status: 'pending' | 'answered' | 'dismissed';
  trigger: {
    type: string;
    taskId: string;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: Array<{
      id: string;
      label: string;
      description: string;
      implications: string;
    }>;
  };
  affectedTasks: string[];
}

interface WorkerSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  totalCost: number;
  totalIterations: number;
}

interface HomrDashboardProps {
  outcomeId: string;
  pendingEscalations: Escalation[];
  workerSummary: WorkerSummary;
  onAnswer: (escalationId: string, selectedOption: string, additionalContext?: string) => Promise<void>;
  onDismiss: (escalationId: string) => Promise<void>;
  onActivityClick?: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function HomrDashboard({
  outcomeId,
  pendingEscalations,
  workerSummary,
  onAnswer,
  onDismiss,
  onActivityClick,
}: HomrDashboardProps): JSX.Element {
  const [stats, setStats] = useState<HomrStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Auto-resolve state
  const [showAutoResolveSettings, setShowAutoResolveSettings] = useState(false);
  const [autoResolveConfig, setAutoResolveConfig] = useState<AutoResolveConfig>({
    mode: 'manual',
    confidenceThreshold: 0.8,
  });
  const [savingAutoResolve, setSavingAutoResolve] = useState(false);

  const fetchAutoResolveConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/auto-resolve`);
      if (res.ok) {
        const data = await res.json();
        setAutoResolveConfig(data.config);
      }
    } catch {
      // Ignore errors, use defaults
    }
  }, [outcomeId]);

  useEffect(() => {
    async function fetchStats(): Promise<void> {
      try {
        const res = await fetch(`/api/outcomes/${outcomeId}/homr`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error('Failed to fetch HOMЯ stats:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    fetchAutoResolveConfig();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, [outcomeId, fetchAutoResolveConfig]);

  const handleAutoResolveModeChange = async (mode: AutoResolveMode) => {
    setSavingAutoResolve(true);
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/auto-resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoResolveConfig(data.config);
      }
    } finally {
      setSavingAutoResolve(false);
    }
  };

  const handleThresholdChange = (threshold: number) => {
    setAutoResolveConfig(prev => ({ ...prev, confidenceThreshold: threshold }));
  };

  const handleThresholdSave = async () => {
    setSavingAutoResolve(true);
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/auto-resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: autoResolveConfig.confidenceThreshold }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoResolveConfig(data.config);
      }
    } finally {
      setSavingAutoResolve(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-text-tertiary text-sm">Loading HOMЯ...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compact Health Dashboard */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-primary">Outcome Health</h3>
          <div className="flex items-center gap-2">
            <Badge variant={stats?.enabled ? 'success' : 'default'}>
              {stats?.enabled ? 'HOMЯ Active' : 'HOMЯ Off'}
            </Badge>
          </div>
        </div>

        {/* Auto-Resolve Settings */}
        <div className="mb-3 p-2 bg-bg-secondary rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">Auto-Resolve</span>
            <button
              onClick={() => setShowAutoResolveSettings(!showAutoResolveSettings)}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                autoResolveConfig.mode !== 'manual'
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-tertiary hover:bg-bg-primary'
              }`}
            >
              {autoResolveConfig.mode === 'manual' ? 'Off' :
               autoResolveConfig.mode === 'semi-auto' ? 'Semi' : 'Auto'}
            </button>
          </div>

          {showAutoResolveSettings && (
            <div className="mt-2 pt-2 border-t border-border space-y-2">
              {/* Mode Selection */}
              <div className="flex gap-1">
                {(['manual', 'semi-auto', 'full-auto'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleAutoResolveModeChange(mode)}
                    disabled={savingAutoResolve}
                    className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                      autoResolveConfig.mode === mode
                        ? 'bg-accent-primary text-white'
                        : 'bg-bg-tertiary text-text-tertiary hover:bg-bg-primary'
                    }`}
                  >
                    {mode === 'manual' ? 'Manual' : mode === 'semi-auto' ? 'Semi' : 'Auto'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-tertiary">
                {autoResolveConfig.mode === 'manual' && 'All escalations require your decision'}
                {autoResolveConfig.mode === 'semi-auto' && 'AI suggests, you approve'}
                {autoResolveConfig.mode === 'full-auto' && 'AI decides automatically'}
              </p>

              {/* Confidence Threshold */}
              {autoResolveConfig.mode !== 'manual' && (
                <div>
                  <div className="flex items-center justify-between text-xs text-text-tertiary mb-1">
                    <span>Confidence: {Math.round(autoResolveConfig.confidenceThreshold * 100)}%</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleThresholdSave}
                      disabled={savingAutoResolve}
                      className="text-xs px-2 py-0 h-5"
                    >
                      Save
                    </Button>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1"
                    step="0.05"
                    value={autoResolveConfig.confidenceThreshold}
                    onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compact Metrics Row */}
        <div className="flex gap-4 mb-2">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-text-primary">{workerSummary.running}</span>
            <span className="text-xs text-text-tertiary">/{workerSummary.total} workers</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-text-primary">${workerSummary.totalCost.toFixed(2)}</span>
            <span className="text-xs text-text-tertiary">cost</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-bold ${pendingEscalations.length > 0 ? 'text-status-warning' : 'text-text-primary'}`}>
              {pendingEscalations.length}
            </span>
            <span className="text-xs text-text-tertiary">pending</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-bold ${workerSummary.failed > 0 ? 'text-status-error' : 'text-text-primary'}`}>
              {workerSummary.failed}
            </span>
            <span className="text-xs text-text-tertiary">failed</span>
          </div>
        </div>

        {/* HOMЯ Stats Row */}
        {stats && (
          <div className="flex gap-3 text-xs text-text-tertiary">
            <span>{stats.stats.tasksObserved} observed</span>
            <span>{stats.stats.discoveriesExtracted} discoveries</span>
            <span>{stats.stats.steeringActions} steered</span>
          </div>
        )}
      </div>

      {/* Escalations Feed */}
      <div className="flex-1 overflow-y-auto">
        {pendingEscalations.length > 0 ? (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-text-primary">Needs Your Input</h3>
              <Badge variant="warning">{pendingEscalations.length}</Badge>
            </div>
            {pendingEscalations.map((escalation) => (
              <EscalationAlert
                key={escalation.id}
                escalation={escalation}
                onAnswer={onAnswer}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        ) : (
          <div className="p-4">
            <div className="text-center py-8">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-text-secondary font-medium">All Clear</p>
              <p className="text-text-tertiary text-sm">No decisions needed right now</p>
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {stats && stats.recentActivity.length > 0 && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-text-primary text-sm">Recent Activity</h3>
              {onActivityClick && (
                <button
                  onClick={onActivityClick}
                  className="text-xs text-accent hover:underline"
                >
                  View All
                </button>
              )}
            </div>
            <div className="space-y-2">
              {stats.recentActivity.slice(0, 5).map((activity) => (
                <div key={activity.id} className="text-sm">
                  <p className="text-text-secondary">{activity.summary}</p>
                  <p className="text-xs text-text-tertiary">{formatRelativeTime(activity.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outcome Retro - Analyze escalations for this outcome */}
        <OutcomeRetro outcomeId={outcomeId} />
      </div>
    </div>
  );
}
