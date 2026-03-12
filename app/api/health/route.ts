/**
 * Health API Route
 *
 * GET /api/health - System health metrics
 *   Returns: DB size, worker/task counts by status,
 *   recent failures, event counts, guard block counts.
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import { getDb } from '@/lib/db/index';
import { paths } from '@/lib/config/paths';

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    const now = Date.now();

    // 1. DB file size
    let dbSizeBytes = 0;
    try {
      const stats = fs.statSync(paths.database);
      dbSizeBytes = stats.size;
    } catch {
      // DB file may not exist yet
    }

    // 2. Worker counts by status
    const workerCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM workers GROUP BY status
    `).all() as { status: string; count: number }[];

    const workers: Record<string, number> = {};
    let totalWorkers = 0;
    for (const row of workerCounts) {
      workers[row.status] = row.count;
      totalWorkers += row.count;
    }

    // 3. Task counts by status
    const taskCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `).all() as { status: string; count: number }[];

    const tasks: Record<string, number> = {};
    let totalTasks = 0;
    for (const row of taskCounts) {
      tasks[row.status] = row.count;
      totalTasks += row.count;
    }

    // 4. Recent failures from task_attempts (last 24h)
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const recentFailures = db.prepare(`
      SELECT id, task_id, attempt_number, worker_id, failure_reason, created_at
      FROM task_attempts
      WHERE failure_reason IS NOT NULL AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(twentyFourHoursAgo) as {
      id: number;
      task_id: string;
      attempt_number: number;
      worker_id: string | null;
      failure_reason: string | null;
      created_at: string;
    }[];

    // 5. Event count from activity_log (last hour)
    const oneHourAgo = now - 60 * 60 * 1000;
    const eventCountResult = db.prepare(`
      SELECT COUNT(*) as count FROM activity_log WHERE created_at > ?
    `).get(oneHourAgo) as { count: number };

    // 6. Guard block count
    const guardBlockResult = db.prepare(`
      SELECT COUNT(*) as count FROM guard_blocks
    `).get() as { count: number };

    const health = {
      status: 'ok',
      timestamp: now,
      database: {
        path: paths.database,
        size_bytes: dbSizeBytes,
        size_mb: Math.round((dbSizeBytes / (1024 * 1024)) * 100) / 100,
      },
      workers: {
        total: totalWorkers,
        by_status: workers,
      },
      tasks: {
        total: totalTasks,
        by_status: tasks,
      },
      recent_failures: {
        count: recentFailures.length,
        last_24h: recentFailures,
      },
      events: {
        last_hour: eventCountResult.count,
      },
      guard_blocks: {
        total: guardBlockResult.count,
      },
    };

    return NextResponse.json(health);
  } catch (error) {
    console.error('Error fetching health:', error);
    return NextResponse.json(
      { status: 'error', error: 'Failed to fetch health metrics' },
      { status: 500 }
    );
  }
}
