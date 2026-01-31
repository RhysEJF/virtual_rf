/**
 * Resources API - Tools
 *
 * GET /api/resources/tools - Get all tools across all outcomes
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();

    // Get all tools with outcome names
    const stmt = db.prepare(`
      SELECT
        oi.id,
        oi.outcome_id,
        oi.filename as name,
        oi.file_path as path,
        oi.target_override,
        oi.synced_to,
        oi.created_at,
        o.name as outcome_name
      FROM outcome_items oi
      JOIN outcomes o ON o.id = oi.outcome_id
      WHERE oi.item_type = 'tool'
      ORDER BY o.name, oi.filename
    `);

    const rows = stmt.all() as Array<{
      id: string;
      outcome_id: string;
      name: string;
      path: string;
      target_override: string | null;
      synced_to: string | null;
      created_at: number;
      outcome_name: string;
    }>;

    // Group by outcome name
    const byOutcome: Record<string, Array<{
      id: string;
      name: string;
      outcomeId: string;
      outcomeName: string;
      path: string;
      syncStatus: string;
    }>> = {};

    for (const row of rows) {
      if (!byOutcome[row.outcome_name]) {
        byOutcome[row.outcome_name] = [];
      }
      byOutcome[row.outcome_name].push({
        id: row.id,
        name: row.name,
        outcomeId: row.outcome_id,
        outcomeName: row.outcome_name,
        path: row.path,
        syncStatus: row.synced_to ? 'synced' : 'local',
      });
    }

    return NextResponse.json({
      byOutcome,
      total: rows.length,
    });
  } catch (error) {
    console.error('[Resources API] Failed to fetch tools:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tools' },
      { status: 500 }
    );
  }
}
