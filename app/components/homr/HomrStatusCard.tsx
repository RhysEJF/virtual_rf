'use client';

/**
 * HOMЯ Status Card
 *
 * Shows HOMЯ Protocol status for an outcome:
 * - Enabled/disabled status
 * - Stats: tasks observed, discoveries, escalations
 * - Recent activity summary
 * - Auto-resolve settings toggle
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface HomrStatus {
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

type AutoResolveMode = 'manual' | 'semi-auto' | 'full-auto';

interface AutoResolveConfig {
  mode: AutoResolveMode;
  confidenceThreshold: number;
}

interface Props {
  outcomeId: string;
  onEscalationClick?: () => void;
  onActivityClick?: () => void;
}

export function HomrStatusCard({ outcomeId, onEscalationClick, onActivityClick }: Props): JSX.Element {
  const [status, setStatus] = useState<HomrStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auto-resolve settings state
  const [showAutoResolveSettings, setShowAutoResolveSettings] = useState(false);
  const [autoResolveConfig, setAutoResolveConfig] = useState<AutoResolveConfig>({
    mode: 'manual',
    confidenceThreshold: 0.8,
  });
  const [savingAutoResolve, setSavingAutoResolve] = useState(false);

  // Fetch auto-resolve config
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
    async function fetchStatus(): Promise<void> {
      try {
        const res = await fetch(`/api/outcomes/${outcomeId}/homr`);
        if (!res.ok) {
          throw new Error('Failed to fetch HOMЯ status');
        }
        const data = await res.json();
        setStatus(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
    fetchAutoResolveConfig();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
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

  const handleThresholdChange = async (threshold: number) => {
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
      <Card>
        <CardHeader>
          <CardTitle>HOMЯ Protocol</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>HOMЯ Protocol</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-status-error text-sm">{error || 'Failed to load status'}</p>
        </CardContent>
      </Card>
    );
  }

  const latestActivity = status.recentActivity[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>HOMЯ Protocol</CardTitle>
          <Badge variant={status.enabled ? 'success' : 'default'}>
            {status.enabled ? 'Active' : 'Disabled'}
          </Badge>
        </div>
        {status.pendingEscalations > 0 && (
          <button
            onClick={onEscalationClick}
            className="text-xs text-status-warning hover:underline"
          >
            {status.pendingEscalations} pending
          </button>
        )}
      </CardHeader>

      <CardContent>
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatBox label="Observed" value={status.stats.tasksObserved} />
          <StatBox label="Discoveries" value={status.stats.discoveriesExtracted} />
          <StatBox label="Steered" value={status.stats.steeringActions} />
          <StatBox label="Escalated" value={status.stats.escalationsCreated} />
        </div>

        {/* Auto-Resolve Toggle */}
        <div className="border-t border-border pt-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">Auto-Resolve</span>
            <button
              onClick={() => setShowAutoResolveSettings(!showAutoResolveSettings)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                autoResolveConfig.mode !== 'manual'
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'
              }`}
            >
              {autoResolveConfig.mode === 'manual' ? 'Off' :
               autoResolveConfig.mode === 'semi-auto' ? 'Semi' : 'Auto'}
            </button>
          </div>

          {/* Expanded Settings */}
          {showAutoResolveSettings && (
            <div className="bg-bg-secondary rounded-lg p-3 space-y-3">
              {/* Mode Selection */}
              <div>
                <label className="text-xs text-text-muted block mb-1">Mode</label>
                <div className="flex gap-1">
                  {(['manual', 'semi-auto', 'full-auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => handleAutoResolveModeChange(mode)}
                      disabled={savingAutoResolve}
                      className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                        autoResolveConfig.mode === mode
                          ? 'bg-accent-primary text-white'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
                      }`}
                    >
                      {mode === 'manual' ? 'Manual' : mode === 'semi-auto' ? 'Semi-Auto' : 'Full Auto'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-1">
                  {autoResolveConfig.mode === 'manual' && 'All escalations require human decision'}
                  {autoResolveConfig.mode === 'semi-auto' && 'AI suggests, you approve before applying'}
                  {autoResolveConfig.mode === 'full-auto' && 'AI decides and applies automatically'}
                </p>
              </div>

              {/* Confidence Threshold */}
              {autoResolveConfig.mode !== 'manual' && (
                <div>
                  <label className="text-xs text-text-muted block mb-1">
                    Confidence Threshold: {Math.round(autoResolveConfig.confidenceThreshold * 100)}%
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.5"
                      max="1"
                      step="0.05"
                      value={autoResolveConfig.confidenceThreshold}
                      onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                      className="flex-1 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleThresholdSave}
                      disabled={savingAutoResolve}
                    >
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Below this threshold, escalations go to human
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Context Summary */}
        <div className="text-xs text-text-secondary mb-3">
          <span className="font-medium">{status.context.discoveries}</span> discoveries,{' '}
          <span className="font-medium">{status.context.decisions}</span> decisions,{' '}
          <span className="font-medium">{status.context.constraints}</span> constraints
        </div>

        {/* Latest Activity */}
        {latestActivity && (
          <div className="text-sm text-text-secondary border-t border-border pt-3">
            <span className="text-xs text-text-muted uppercase">Latest: </span>
            {latestActivity.summary}
            <span className="text-xs text-text-muted ml-1">
              ({formatRelativeTime(latestActivity.createdAt)})
            </span>
          </div>
        )}

        {/* View Activity Log Button */}
        {onActivityClick && (
          <button
            onClick={onActivityClick}
            className="text-xs text-accent-primary hover:underline mt-2"
          >
            View Activity Log
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="text-center">
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
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
