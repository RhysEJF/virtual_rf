/**
 * Orchestration API
 *
 * POST: Start orchestrated execution (infrastructure + execution phases)
 * GET: Get orchestration status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import {
  runOrchestrated,
  getOrchestrationState,
  isReadyForExecution,
} from '@/lib/ralph/orchestrator';
import { getPhaseStats } from '@/lib/db/tasks';

// ============================================================================
// POST: Start Orchestrated Execution
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: outcomeId } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Parse options from body
    const body = await request.json().catch(() => ({}));
    const {
      maxInfrastructureWorkers = 3,
      maxExecutionWorkers = 1,
      skipValidation = false,
      async: runAsync = true,
    } = body;

    if (runAsync) {
      // Start orchestration in background and return immediately
      runOrchestrated(outcomeId, {
        maxInfrastructureWorkers,
        maxExecutionWorkers,
        skipValidation,
      }).catch(error => {
        console.error('[Orchestrate API] Background error:', error);
      });

      return NextResponse.json({
        success: true,
        message: 'Orchestration started',
        outcomeId,
        status: 'running',
      });
    } else {
      // Run synchronously and wait for result
      const result = await runOrchestrated(outcomeId, {
        maxInfrastructureWorkers,
        maxExecutionWorkers,
        skipValidation,
      });

      return NextResponse.json({
        success: result.success,
        message: result.message,
        outcomeId,
        phase: result.phase,
        errors: result.errors,
      });
    }
  } catch (error) {
    console.error('[Orchestrate API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start orchestration' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET: Get Orchestration Status
// ============================================================================

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: outcomeId } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Get orchestration state
    const state = getOrchestrationState(outcomeId);
    const phaseStats = getPhaseStats(outcomeId);

    return NextResponse.json({
      outcomeId,
      currentPhase: state?.currentPhase || 'execution',
      infrastructureReady: outcome.infrastructure_ready,
      readyForExecution: isReadyForExecution(outcomeId),
      stats: {
        infrastructure: {
          total: phaseStats.infrastructure.total,
          pending: phaseStats.infrastructure.pending,
          completed: phaseStats.infrastructure.completed,
          failed: phaseStats.infrastructure.failed,
        },
        execution: {
          total: phaseStats.execution.total,
          pending: phaseStats.execution.pending,
          completed: phaseStats.execution.completed,
          failed: phaseStats.execution.failed,
        },
      },
      activeWorkers: {
        infrastructure: state?.infrastructureWorkers.length || 0,
        execution: state?.executionWorkers.length || 0,
      },
    });
  } catch (error) {
    console.error('[Orchestrate API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
