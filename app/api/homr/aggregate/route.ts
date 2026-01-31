/**
 * Aggregated HOMЯ Stats API
 *
 * GET /api/homr/aggregate - Get HOMЯ stats across all outcomes
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAllOutcomes } from '@/lib/db/outcomes';

interface Escalation {
  id: string;
  outcomeId: string;
  outcomeName: string;
  createdAt: number;
  status: string;
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
}

interface OutcomeHealth {
  outcomeId: string;
  outcomeName: string;
  workersRunning: number;
  workersTotal: number;
  totalCost: number;
  pendingEscalations: number;
  failedTasks: number;
}

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    const outcomes = getAllOutcomes();

    // Get all pending escalations with outcome names
    const escalationsStmt = db.prepare(`
      SELECT
        e.id,
        e.outcome_id,
        e.status,
        e.trigger_type,
        e.trigger_task_id,
        e.trigger_evidence,
        e.question_text,
        e.question_context,
        e.question_options,
        e.created_at,
        o.name as outcome_name
      FROM homr_escalations e
      JOIN outcomes o ON o.id = e.outcome_id
      WHERE e.status = 'pending'
      ORDER BY e.created_at DESC
    `);

    const escalationRows = escalationsStmt.all() as Array<{
      id: string;
      outcome_id: string;
      status: string;
      trigger_type: string;
      trigger_task_id: string;
      trigger_evidence: string;
      question_text: string;
      question_context: string;
      question_options: string;
      created_at: number;
      outcome_name: string;
    }>;

    const escalations: Escalation[] = escalationRows.map((row) => ({
      id: row.id,
      outcomeId: row.outcome_id,
      outcomeName: row.outcome_name,
      createdAt: row.created_at,
      status: row.status,
      trigger: {
        type: row.trigger_type,
        taskId: row.trigger_task_id,
        evidence: JSON.parse(row.trigger_evidence || '[]'),
      },
      question: {
        text: row.question_text,
        context: row.question_context,
        options: JSON.parse(row.question_options || '[]'),
      },
    }));

    // Get worker stats per outcome
    const workerStatsStmt = db.prepare(`
      SELECT
        outcome_id,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(cost) as total_cost
      FROM workers
      GROUP BY outcome_id
    `);

    const workerStats = workerStatsStmt.all() as Array<{
      outcome_id: string;
      total: number;
      running: number;
      total_cost: number;
    }>;

    const workerStatsByOutcome = new Map(
      workerStats.map((w) => [w.outcome_id, w])
    );

    // Get failed task counts per outcome
    const failedTasksStmt = db.prepare(`
      SELECT
        outcome_id,
        COUNT(*) as failed_count
      FROM tasks
      WHERE status = 'failed'
      GROUP BY outcome_id
    `);

    const failedTasks = failedTasksStmt.all() as Array<{
      outcome_id: string;
      failed_count: number;
    }>;

    const failedTasksByOutcome = new Map(
      failedTasks.map((f) => [f.outcome_id, f.failed_count])
    );

    // Get pending escalation counts per outcome
    const pendingByOutcome = new Map<string, number>();
    for (const esc of escalations) {
      pendingByOutcome.set(
        esc.outcomeId,
        (pendingByOutcome.get(esc.outcomeId) || 0) + 1
      );
    }

    // Build outcome health array
    const outcomeHealthList: OutcomeHealth[] = outcomes.map((outcome) => {
      const stats = workerStatsByOutcome.get(outcome.id);
      return {
        outcomeId: outcome.id,
        outcomeName: outcome.name,
        workersRunning: stats?.running || 0,
        workersTotal: stats?.total || 0,
        totalCost: stats?.total_cost || 0,
        pendingEscalations: pendingByOutcome.get(outcome.id) || 0,
        failedTasks: failedTasksByOutcome.get(outcome.id) || 0,
      };
    });

    // Calculate aggregated totals
    const totalWorkersRunning = outcomeHealthList.reduce((sum, o) => sum + o.workersRunning, 0);
    const totalWorkers = outcomeHealthList.reduce((sum, o) => sum + o.workersTotal, 0);
    const totalCost = outcomeHealthList.reduce((sum, o) => sum + o.totalCost, 0);
    const totalPending = escalations.length;
    const totalFailed = outcomeHealthList.reduce((sum, o) => sum + o.failedTasks, 0);

    return NextResponse.json({
      totalWorkersRunning,
      totalWorkers,
      totalCost,
      totalPending,
      totalFailed,
      outcomes: outcomeHealthList.filter(o => o.workersTotal > 0 || o.pendingEscalations > 0),
      escalations,
    });
  } catch (error) {
    console.error('[HOMЯ Aggregate API] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aggregated stats' },
      { status: 500 }
    );
  }
}
