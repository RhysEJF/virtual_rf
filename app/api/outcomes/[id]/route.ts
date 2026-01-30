/**
 * Single Outcome API Route
 *
 * GET /api/outcomes/[id] - Get outcome details with relations
 *   Includes: parent, children, breadcrumbs, aggregated_stats (if has children)
 * PATCH /api/outcomes/[id] - Update outcome
 * DELETE /api/outcomes/[id] - Delete outcome (cascades to children)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOutcomeById,
  getOutcomeWithRelations,
  updateOutcome,
  deleteOutcome,
  activateOutcome,
  pauseOutcome,
  achieveOutcome,
  archiveOutcome,
  getBreadcrumbs,
  getChildrenWithCounts,
  getAggregatedStats,
  hasChildren,
} from '@/lib/db/outcomes';
import { getConvergenceStatus } from '@/lib/db/review-cycles';
import { getTaskStats } from '@/lib/db/tasks';
import type { OutcomeStatus } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const withRelations = searchParams.get('relations') !== 'false';

    if (withRelations) {
      const outcome = getOutcomeWithRelations(id);
      if (!outcome) {
        return NextResponse.json(
          { error: 'Outcome not found' },
          { status: 404 }
        );
      }

      // Add convergence and task stats
      const convergence = getConvergenceStatus(id);
      const taskStats = getTaskStats(id);

      // Add hierarchy data
      const breadcrumbs = getBreadcrumbs(id);
      const children = getChildrenWithCounts(id);
      const isParent = children.length > 0;

      // Get parent info if exists
      let parent: { id: string; name: string } | null = null;
      if (outcome.parent_id) {
        const parentOutcome = getOutcomeById(outcome.parent_id);
        if (parentOutcome) {
          parent = { id: parentOutcome.id, name: parentOutcome.name };
        }
      }

      // Get aggregated stats if this outcome has children
      const aggregatedStats = isParent ? getAggregatedStats(id) : null;

      return NextResponse.json({
        outcome,
        convergence,
        taskStats,
        // Hierarchy data
        parent,
        children,
        breadcrumbs,
        aggregatedStats,
        isParent,
      });
    }

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ outcome });
  } catch (error) {
    console.error('Error fetching outcome:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outcome' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();

    // Handle status transitions specially
    if (body.status) {
      let outcome;
      switch (body.status as OutcomeStatus) {
        case 'active':
          outcome = activateOutcome(id);
          break;
        case 'dormant':
          outcome = pauseOutcome(id);
          break;
        case 'achieved':
          outcome = achieveOutcome(id);
          break;
        case 'archived':
          outcome = archiveOutcome(id);
          break;
        default:
          return NextResponse.json(
            { error: 'Invalid status' },
            { status: 400 }
          );
      }

      if (!outcome) {
        return NextResponse.json(
          { error: 'Outcome not found or invalid transition' },
          { status: 404 }
        );
      }

      return NextResponse.json({ outcome });
    }

    // Regular update
    const outcome = updateOutcome(id, body);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ outcome });
  } catch (error) {
    console.error('Error updating outcome:', error);
    return NextResponse.json(
      { error: 'Failed to update outcome' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const deleted = deleteOutcome(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting outcome:', error);
    return NextResponse.json(
      { error: 'Failed to delete outcome' },
      { status: 500 }
    );
  }
}
