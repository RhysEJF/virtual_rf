'use client';

/**
 * Escalation Trends Component
 *
 * Displays time-based visualization of escalation frequency trends,
 * showing whether interventions are increasing or decreasing over time.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

type Period = 'daily' | 'weekly' | 'monthly';

interface TrendDataPoint {
  period_start: number;
  period_label: string;
  total: number;
  pending: number;
  answered: number;
  dismissed: number;
  by_trigger_type: Record<string, number>;
}

interface TrendData {
  period: Period;
  data_points: TrendDataPoint[];
  summary: {
    total_escalations: number;
    avg_per_period: number;
    trend_direction: 'increasing' | 'decreasing' | 'stable';
    trend_percentage: number;
  };
  time_range: {
    from: number;
    to: number;
  };
}

interface EscalationTrendsProps {
  outcomeId?: string;
  defaultPeriod?: Period;
  defaultDays?: number;
}

const periodOptions: { value: Period; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const daysOptions = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
];

function getTrendIcon(direction: 'increasing' | 'decreasing' | 'stable'): string {
  switch (direction) {
    case 'increasing':
      return '\u2197'; // ↗
    case 'decreasing':
      return '\u2198'; // ↘
    case 'stable':
      return '\u2192'; // →
  }
}

function getTrendVariant(direction: 'increasing' | 'decreasing' | 'stable'): 'warning' | 'success' | 'default' {
  switch (direction) {
    case 'increasing':
      return 'warning'; // More escalations = more human intervention needed
    case 'decreasing':
      return 'success'; // Fewer escalations = workers more autonomous
    case 'stable':
      return 'default';
  }
}

export function EscalationTrends({
  outcomeId,
  defaultPeriod = 'daily',
  defaultDays = 30,
}: EscalationTrendsProps): JSX.Element {
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [days, setDays] = useState(defaultDays);

  const fetchTrends = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('period', period);
      params.set('days', days.toString());
      if (outcomeId) {
        params.set('outcome_id', outcomeId);
      }

      const response = await fetch(`/api/insights/escalations/trends?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch trend data');
      }

      const trendData = await response.json();
      setData(trendData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [period, days, outcomeId]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  if (loading) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Escalation Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-text-tertiary text-sm">Loading trends...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Escalation Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-status-error text-sm">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.data_points.length === 0) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Escalation Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-text-tertiary text-sm">No trend data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxValue = Math.max(...data.data_points.map((dp) => dp.total), 1);

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Escalation Trends</CardTitle>
          <Badge variant={getTrendVariant(data.summary.trend_direction)}>
            {getTrendIcon(data.summary.trend_direction)} {data.summary.trend_percentage}%{' '}
            {data.summary.trend_direction}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="text-xs bg-bg-tertiary border border-border rounded px-2 py-1 text-text-secondary"
          >
            {periodOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {/* Days selector */}
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="text-xs bg-bg-tertiary border border-border rounded px-2 py-1 text-text-secondary"
          >
            {daysOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>

      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-4 pb-4 border-b border-border">
          <div className="text-center">
            <p className="text-2xl font-semibold text-text-primary">
              {data.summary.total_escalations}
            </p>
            <p className="text-xs text-text-tertiary">Total Escalations</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-text-primary">
              {data.summary.avg_per_period}
            </p>
            <p className="text-xs text-text-tertiary">Avg per {period.slice(0, -2)}</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-text-primary">
              {data.data_points.length}
            </p>
            <p className="text-xs text-text-tertiary">Periods Tracked</p>
          </div>
        </div>

        {/* Bar chart */}
        <div className="relative">
          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-right pr-2">
            <span className="text-xs text-text-tertiary">{maxValue}</span>
            <span className="text-xs text-text-tertiary">{Math.round(maxValue / 2)}</span>
            <span className="text-xs text-text-tertiary">0</span>
          </div>

          {/* Chart area */}
          <div className="ml-10">
            {/* Grid lines */}
            <div className="absolute left-10 right-0 top-0 h-full pointer-events-none">
              <div className="absolute w-full border-t border-border/30" style={{ top: '0%' }} />
              <div className="absolute w-full border-t border-border/30" style={{ top: '50%' }} />
              <div className="absolute w-full border-t border-border/30" style={{ top: '100%' }} />
            </div>

            {/* Bars */}
            <div className="flex items-end gap-1 h-32 relative">
              {data.data_points.map((dp, index) => {
                const heightPercent = maxValue > 0 ? (dp.total / maxValue) * 100 : 0;
                const answeredPercent = dp.total > 0 ? (dp.answered / dp.total) * 100 : 0;
                const pendingPercent = dp.total > 0 ? (dp.pending / dp.total) * 100 : 0;

                return (
                  <div
                    key={dp.period_start}
                    className="flex-1 flex flex-col items-center group relative"
                  >
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-bg-primary border border-border rounded shadow-lg p-2 text-xs whitespace-nowrap">
                        <p className="font-medium text-text-primary">{dp.period_label}</p>
                        <p className="text-text-secondary">
                          Total: {dp.total}
                        </p>
                        <p className="text-status-success">
                          Answered: {dp.answered}
                        </p>
                        <p className="text-status-warning">
                          Pending: {dp.pending}
                        </p>
                        <p className="text-text-tertiary">
                          Dismissed: {dp.dismissed}
                        </p>
                      </div>
                    </div>

                    {/* Bar */}
                    <div
                      className="w-full max-w-6 bg-bg-tertiary rounded-t overflow-hidden transition-all duration-200 hover:opacity-80 cursor-pointer"
                      style={{ height: `${Math.max(heightPercent, 2)}%` }}
                    >
                      {/* Stacked segments */}
                      <div className="w-full h-full flex flex-col-reverse">
                        <div
                          className="w-full bg-status-success"
                          style={{ height: `${answeredPercent}%` }}
                        />
                        <div
                          className="w-full bg-status-warning"
                          style={{ height: `${pendingPercent}%` }}
                        />
                        <div
                          className="w-full bg-text-tertiary"
                          style={{ height: `${100 - answeredPercent - pendingPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* X-axis labels - show every few labels to prevent crowding */}
            <div className="flex gap-1 mt-2 overflow-hidden">
              {data.data_points.map((dp, index) => {
                // Show label for every nth item based on data length
                const showEvery = data.data_points.length > 14 ? 7 : data.data_points.length > 7 ? 2 : 1;
                const showLabel = index % showEvery === 0 || index === data.data_points.length - 1;

                return (
                  <div key={dp.period_start} className="flex-1 text-center">
                    {showLabel && (
                      <span className="text-xs text-text-tertiary truncate block">
                        {period === 'weekly'
                          ? dp.period_label.split(' - ')[0]
                          : dp.period_label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-status-success" />
            <span className="text-xs text-text-tertiary">Answered</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-status-warning" />
            <span className="text-xs text-text-tertiary">Pending</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-text-tertiary" />
            <span className="text-xs text-text-tertiary">Dismissed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
