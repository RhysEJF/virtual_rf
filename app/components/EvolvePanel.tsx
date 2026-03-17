'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/app/components/ui/Badge';

interface Experiment {
  id: number;
  task_id: string;
  outcome_id: string;
  iteration: number;
  metric_value: number | null;
  metric_command: string;
  baseline_value: number | null;
  change_summary: string | null;
  git_sha: string | null;
  kept: number;
  duration_seconds: number | null;
  created_at: string;
}

interface EvolvePanelProps {
  taskId: string;
  outcomeId: string;
  metricCommand: string;
  metricBaseline: number | null;
  optimizationBudget: number | null;
  metricDirection?: string | null;
}

export function EvolvePanel({
  taskId,
  outcomeId,
  metricCommand,
  metricBaseline,
  optimizationBudget,
  metricDirection,
}: EvolvePanelProps): JSX.Element {
  const direction = metricDirection === 'higher' ? 'higher' : 'lower';
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExperiments = useCallback(async () => {
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/experiments?task_id=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setExperiments(data.experiments || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [taskId, outcomeId]);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  const budget = optimizationBudget || 5;
  const bestExperiment = experiments.filter(e => e.kept === 1).sort((a, b) => {
    if (a.metric_value === null) return 1;
    if (b.metric_value === null) return -1;
    return direction === 'higher' ? b.metric_value - a.metric_value : a.metric_value - b.metric_value;
  })[0] || null;

  const baseline = metricBaseline ?? experiments[0]?.baseline_value ?? null;
  const improvementPct = bestExperiment?.metric_value != null && baseline != null && baseline !== 0
    ? (direction === 'higher'
      ? ((bestExperiment.metric_value - baseline) / Math.abs(baseline) * 100)
      : ((baseline - bestExperiment.metric_value) / Math.abs(baseline) * 100))
    : null;

  // Plateau detection: last 3 experiments all reverted
  const lastThree = experiments.slice(-3);
  const isPlateaued = lastThree.length >= 3 && lastThree.every(e => e.kept === 0);

  // Find max metric value for bar chart scaling
  const allValues = experiments.map(e => e.metric_value).filter((v): v is number => v !== null);
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 1;

  return (
    <div className="p-3 bg-bg-tertiary rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Evolve Mode</span>
          <Badge variant={isPlateaued ? 'warning' : experiments.length >= budget ? 'success' : 'info'}>
            {experiments.length}/{budget} iterations
          </Badge>
          {isPlateaued && (
            <Badge variant="warning">Plateaued</Badge>
          )}
        </div>
        {improvementPct !== null && (
          <span className={`text-xs font-medium ${improvementPct > 0 ? 'text-status-success' : 'text-status-error'}`}>
            {improvementPct > 0 ? '+' : ''}{improvementPct.toFixed(1)}% improvement
          </span>
        )}
      </div>

      {/* Metric command */}
      <div>
        <span className="text-[10px] text-text-tertiary uppercase tracking-wide">Metric Command</span>
        <code className="block mt-1 text-xs bg-bg-primary px-2 py-1 rounded text-text-secondary font-mono">
          {metricCommand}
        </code>
      </div>

      {/* Baseline */}
      {baseline !== null && (
        <div className="flex items-center gap-4 text-xs">
          <span className="text-text-tertiary">Baseline: <span className="text-text-primary font-medium">{baseline}</span></span>
          {bestExperiment?.metric_value != null && (
            <span className="text-text-tertiary">Best: <span className="text-status-success font-medium">{bestExperiment.metric_value}</span></span>
          )}
        </div>
      )}

      {/* Experiments */}
      {loading ? (
        <p className="text-text-tertiary text-sm">Loading experiments...</p>
      ) : experiments.length === 0 ? (
        <p className="text-text-tertiary text-sm">No experiments yet</p>
      ) : (
        <div className="space-y-1.5">
          {experiments.map((exp) => {
            const isKept = exp.kept === 1;
            const barWidth = exp.metric_value != null && maxValue > 0
              ? Math.max(5, (exp.metric_value / maxValue) * 100)
              : 0;
            const delta = exp.metric_value != null && baseline != null
              ? exp.metric_value - baseline
              : null;

            return (
              <div key={exp.id} className="flex items-center gap-2 text-xs">
                <span className="text-text-tertiary w-6 text-right shrink-0">#{exp.iteration}</span>
                <div className="flex-1 h-4 bg-bg-primary rounded overflow-hidden relative">
                  <div
                    className={`h-full rounded ${isKept ? 'bg-status-success/40' : 'bg-status-error/20'}`}
                    style={{ width: `${barWidth}%` }}
                  />
                  {exp.metric_value != null && (
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-text-secondary">
                      {exp.metric_value}
                      {delta != null && (
                        <span className={`ml-1 ${(direction === 'higher' ? delta > 0 : delta < 0) ? 'text-status-success' : (direction === 'higher' ? delta < 0 : delta > 0) ? 'text-status-error' : 'text-text-tertiary'}`}>
                          ({delta > 0 ? '+' : ''}{delta.toFixed(1)})
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <Badge variant={isKept ? 'success' : 'error'} className="text-[10px] shrink-0">
                  {isKept ? 'Kept' : 'Reverted'}
                </Badge>
              </div>
            );
          })}
        </div>
      )}

      {/* Change summaries */}
      {experiments.some(e => e.change_summary) && (
        <details className="text-xs">
          <summary className="text-text-tertiary cursor-pointer hover:text-text-secondary">
            Change summaries
          </summary>
          <div className="mt-2 space-y-1.5">
            {experiments.filter(e => e.change_summary).map((exp) => (
              <div key={exp.id} className="pl-2 border-l-2 border-border">
                <span className="text-text-tertiary">#{exp.iteration}: </span>
                <span className="text-text-secondary">{exp.change_summary}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
