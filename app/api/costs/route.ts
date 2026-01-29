/**
 * Costs API Route
 *
 * GET /api/costs - Get cost summary
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTodayCost, getCostForRange, getCostLogByProject } from '@/lib/db/logs';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const outcomeId = searchParams.get('outcomeId');
    const range = searchParams.get('range') || 'today';

    // Get costs for specific outcome
    if (outcomeId) {
      const costs = getCostLogByProject(outcomeId);
      const total = costs.reduce((sum, c) => sum + c.amount, 0);
      return NextResponse.json({
        outcomeId,
        costs,
        total,
      });
    }

    // Get costs by time range
    const now = Date.now();
    let startTime: number;

    switch (range) {
      case 'hour':
        startTime = now - 60 * 60 * 1000;
        break;
      case 'today':
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startTime = today.getTime();
        break;
      case 'week':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case 'all':
        startTime = 0;
        break;
      default:
        startTime = new Date().setHours(0, 0, 0, 0);
    }

    const total = getCostForRange(startTime, now);
    const todayCost = getTodayCost();

    // Get top outcomes by cost
    const db = getDb();
    const topOutcomes = db.prepare(`
      SELECT
        cl.project_id as outcome_id,
        o.name as outcome_name,
        SUM(cl.amount) as total_cost,
        COUNT(*) as call_count
      FROM cost_log cl
      LEFT JOIN outcomes o ON cl.project_id = o.id
      WHERE cl.created_at >= ?
      GROUP BY cl.project_id
      ORDER BY total_cost DESC
      LIMIT 10
    `).all(startTime) as Array<{
      outcome_id: string | null;
      outcome_name: string | null;
      total_cost: number;
      call_count: number;
    }>;

    return NextResponse.json({
      range,
      total,
      todayCost,
      topOutcomes,
    });
  } catch (error) {
    console.error('Error fetching costs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch costs' },
      { status: 500 }
    );
  }
}
