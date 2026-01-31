/**
 * Orchestration API
 *
 * POST: Start orchestrated execution (capability + execution phases)
 * GET: Get orchestration status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, hasChildren } from '@/lib/db/outcomes';
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

    // Only leaf outcomes (no children) can be orchestrated
    if (hasChildren(outcomeId)) {
      return NextResponse.json(
        { error: 'Cannot orchestrate parent outcomes. Only leaf outcomes (those without children) can be executed.' },
        { status: 400 }
      );
    }

    // Parse options from body
    const body = await request.json().catch(() => ({}));
    const {
      maxCapabilityWorkers = 3,
      maxExecutionWorkers = 1,
      skipValidation = false,
      async: runAsync = true,
    } = body;

    if (runAsync) {
      // Start orchestration in background and return immediately
      runOrchestrated(outcomeId, {
        maxCapabilityWorkers,
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
        maxCapabilityWorkers,
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
      capabilityReady: outcome.capability_ready,
      readyForExecution: isReadyForExecution(outcomeId),
      stats: {
        capability: {
          total: phaseStats.capability.total,
          pending: phaseStats.capability.pending,
          completed: phaseStats.capability.completed,
          failed: phaseStats.capability.failed,
        },
        execution: {
          total: phaseStats.execution.total,
          pending: phaseStats.execution.pending,
          completed: phaseStats.execution.completed,
          failed: phaseStats.execution.failed,
        },
      },
      activeWorkers: {
        capability: state?.capabilityWorkers.length || 0,
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
