/**
 * System Configuration API
 *
 * GET /api/config - Get all system config values
 * PATCH /api/config - Update system config values
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllConfig,
  setConfig,
  getMaxPendingTasks,
  setMaxPendingTasks,
  getMaxSubtaskDepth,
  setMaxSubtaskDepth,
  getMaxChildrenPerTask,
  setMaxChildrenPerTask,
  getDefaultTurnBudget,
  setDefaultTurnBudget,
} from '@/lib/db/system-config';
import type { IsolationMode } from '@/lib/db/schema';

export async function GET(): Promise<NextResponse> {
  try {
    const config = getAllConfig();

    return NextResponse.json({
      config: {
        default_isolation_mode: config.default_isolation_mode || 'workspace',
        max_pending_tasks: getMaxPendingTasks(),
        max_subtask_depth: getMaxSubtaskDepth(),
        max_children_per_task: getMaxChildrenPerTask(),
        default_turn_budget: getDefaultTurnBudget(),
      },
    });
  } catch (error) {
    console.error('[API] Failed to get config:', error);
    return NextResponse.json(
      { error: 'Failed to get config' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    // Validate and set each config value
    if (body.default_isolation_mode !== undefined) {
      const mode = body.default_isolation_mode as IsolationMode;
      if (mode !== 'workspace' && mode !== 'codebase') {
        return NextResponse.json(
          { error: 'Invalid isolation mode. Must be "workspace" or "codebase".' },
          { status: 400 }
        );
      }
      setConfig('default_isolation_mode', mode);
    }

    if (body.max_pending_tasks !== undefined) {
      const val = Number(body.max_pending_tasks);
      if (isNaN(val) || val < 1 || val > 1000) {
        return NextResponse.json(
          { error: 'max_pending_tasks must be between 1 and 1000.' },
          { status: 400 }
        );
      }
      setMaxPendingTasks(val);
    }

    if (body.max_subtask_depth !== undefined) {
      const val = Number(body.max_subtask_depth);
      if (isNaN(val) || val < 1 || val > 10) {
        return NextResponse.json(
          { error: 'max_subtask_depth must be between 1 and 10.' },
          { status: 400 }
        );
      }
      setMaxSubtaskDepth(val);
    }

    if (body.max_children_per_task !== undefined) {
      const val = Number(body.max_children_per_task);
      if (isNaN(val) || val < 1 || val > 100) {
        return NextResponse.json(
          { error: 'max_children_per_task must be between 1 and 100.' },
          { status: 400 }
        );
      }
      setMaxChildrenPerTask(val);
    }

    if (body.default_turn_budget !== undefined) {
      const val = Number(body.default_turn_budget);
      if (isNaN(val) || val < 1 || val > 1000) {
        return NextResponse.json(
          { error: 'default_turn_budget must be between 1 and 1000.' },
          { status: 400 }
        );
      }
      setDefaultTurnBudget(val);
    }

    // Return updated config
    const config = getAllConfig();

    return NextResponse.json({
      success: true,
      config: {
        default_isolation_mode: config.default_isolation_mode || 'workspace',
        max_pending_tasks: getMaxPendingTasks(),
        max_subtask_depth: getMaxSubtaskDepth(),
        max_children_per_task: getMaxChildrenPerTask(),
        default_turn_budget: getDefaultTurnBudget(),
      },
    });
  } catch (error) {
    console.error('[API] Failed to update config:', error);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}
