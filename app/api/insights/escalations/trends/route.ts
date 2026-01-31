/**
 * Escalation Trends API
 *
 * GET /api/insights/escalations/trends - Get escalation frequency trends over time
 *
 * Query params:
 * - period: 'daily' | 'weekly' | 'monthly' (default: 'daily')
 * - days: Number of days to look back (default: 30)
 * - outcome_id: Filter by specific outcome (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { HomrEscalation } from '@/lib/db/schema';

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

interface TrendResponse {
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

function getStartOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getStartOfWeek(timestamp: number): number {
  const date = new Date(timestamp);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday as start
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getStartOfMonth(timestamp: number): number {
  const date = new Date(timestamp);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatPeriodLabel(timestamp: number, period: Period): string {
  const date = new Date(timestamp);

  switch (period) {
    case 'daily':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'weekly':
      const endOfWeek = new Date(timestamp);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    case 'monthly':
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    default:
      return date.toISOString();
  }
}

function getPeriodStart(timestamp: number, period: Period): number {
  switch (period) {
    case 'daily':
      return getStartOfDay(timestamp);
    case 'weekly':
      return getStartOfWeek(timestamp);
    case 'monthly':
      return getStartOfMonth(timestamp);
    default:
      return getStartOfDay(timestamp);
  }
}

function getNextPeriod(timestamp: number, period: Period): number {
  const date = new Date(timestamp);

  switch (period) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
  }

  return date.getTime();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  // Parse query params
  const period = (searchParams.get('period') || 'daily') as Period;
  const days = parseInt(searchParams.get('days') || '30', 10);
  const outcomeId = searchParams.get('outcome_id');

  // Validate period
  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    return NextResponse.json(
      { error: 'Invalid period. Must be daily, weekly, or monthly' },
      { status: 400 }
    );
  }

  const now = Date.now();
  const fromTimestamp = now - days * 24 * 60 * 60 * 1000;

  const db = getDb();

  // Build query
  const conditions: string[] = ['created_at >= ?'];
  const params: (string | number)[] = [fromTimestamp];

  if (outcomeId) {
    conditions.push('outcome_id = ?');
    params.push(outcomeId);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get all escalations in the time range
  const escalations = db.prepare(`
    SELECT * FROM homr_escalations
    ${whereClause}
    ORDER BY created_at ASC
  `).all(...params) as HomrEscalation[];

  // Generate all periods in the range (even empty ones)
  const periodStarts: number[] = [];
  let currentPeriod = getPeriodStart(fromTimestamp, period);
  const endPeriod = getPeriodStart(now, period);

  while (currentPeriod <= endPeriod) {
    periodStarts.push(currentPeriod);
    currentPeriod = getNextPeriod(currentPeriod, period);
  }

  // Initialize data points for each period
  const dataPointsMap = new Map<number, TrendDataPoint>();

  for (const periodStart of periodStarts) {
    dataPointsMap.set(periodStart, {
      period_start: periodStart,
      period_label: formatPeriodLabel(periodStart, period),
      total: 0,
      pending: 0,
      answered: 0,
      dismissed: 0,
      by_trigger_type: {},
    });
  }

  // Aggregate escalations into periods
  for (const esc of escalations) {
    const periodStart = getPeriodStart(esc.created_at, period);
    const dataPoint = dataPointsMap.get(periodStart);

    if (dataPoint) {
      dataPoint.total++;
      dataPoint[esc.status as 'pending' | 'answered' | 'dismissed']++;

      if (!dataPoint.by_trigger_type[esc.trigger_type]) {
        dataPoint.by_trigger_type[esc.trigger_type] = 0;
      }
      dataPoint.by_trigger_type[esc.trigger_type]++;
    }
  }

  // Convert map to sorted array
  const dataPoints = Array.from(dataPointsMap.values()).sort(
    (a, b) => a.period_start - b.period_start
  );

  // Calculate summary statistics
  const totalEscalations = escalations.length;
  const avgPerPeriod = dataPoints.length > 0 ? totalEscalations / dataPoints.length : 0;

  // Calculate trend direction by comparing first half to second half
  let trendDirection: 'increasing' | 'decreasing' | 'stable' = 'stable';
  let trendPercentage = 0;

  if (dataPoints.length >= 2) {
    const midpoint = Math.floor(dataPoints.length / 2);
    const firstHalf = dataPoints.slice(0, midpoint);
    const secondHalf = dataPoints.slice(midpoint);

    const firstHalfTotal = firstHalf.reduce((sum, dp) => sum + dp.total, 0);
    const secondHalfTotal = secondHalf.reduce((sum, dp) => sum + dp.total, 0);

    const firstHalfAvg = firstHalf.length > 0 ? firstHalfTotal / firstHalf.length : 0;
    const secondHalfAvg = secondHalf.length > 0 ? secondHalfTotal / secondHalf.length : 0;

    if (firstHalfAvg > 0) {
      trendPercentage = Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100);
    } else if (secondHalfAvg > 0) {
      trendPercentage = 100;
    }

    if (trendPercentage > 10) {
      trendDirection = 'increasing';
    } else if (trendPercentage < -10) {
      trendDirection = 'decreasing';
    }
  }

  const response: TrendResponse = {
    period,
    data_points: dataPoints,
    summary: {
      total_escalations: totalEscalations,
      avg_per_period: Math.round(avgPerPeriod * 10) / 10,
      trend_direction: trendDirection,
      trend_percentage: Math.abs(trendPercentage),
    },
    time_range: {
      from: fromTimestamp,
      to: now,
    },
  };

  return NextResponse.json(response);
}
