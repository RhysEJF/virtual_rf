/**
 * Outcomes API Route
 *
 * GET /api/outcomes - List all outcomes
 *   Query params:
 *   - counts=true: Include task/worker counts
 *   - tree=true: Return nested tree structure
 *   - parent_id=xxx: Get children of specific outcome
 *   - roots_only=true: Get only root outcomes
 *   - status=active|dormant|achieved|archived: Filter by status
 * POST /api/outcomes - Create a new outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllOutcomes,
  getOutcomesWithCounts,
  createOutcome,
  getOutcomeTree,
  getRootOutcomes,
  getChildOutcomes,
  type CreateOutcomeInput,
} from '@/lib/db/outcomes';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const withCounts = searchParams.get('counts') === 'true';
    const tree = searchParams.get('tree') === 'true';
    const rootsOnly = searchParams.get('roots_only') === 'true';
    const parentId = searchParams.get('parent_id');
    const status = searchParams.get('status');

    // Tree view - return nested structure
    if (tree) {
      let outcomes = getOutcomeTree();

      // Filter by status if provided (filters root level)
      if (status) {
        outcomes = outcomes.filter(o => o.status === status);
      }

      return NextResponse.json({ outcomes });
    }

    // Get children of a specific parent
    if (parentId) {
      const children = getChildOutcomes(parentId);
      return NextResponse.json({ outcomes: children });
    }

    // Get only root outcomes
    if (rootsOnly) {
      let outcomes = getRootOutcomes();

      if (status) {
        outcomes = outcomes.filter(o => o.status === status);
      }

      return NextResponse.json({ outcomes });
    }

    // Standard list with counts
    if (withCounts) {
      let outcomes = getOutcomesWithCounts();

      // Filter by status if provided
      if (status) {
        outcomes = outcomes.filter(o => o.status === status);
      }

      return NextResponse.json({ outcomes });
    }

    let outcomes = getAllOutcomes();

    // Filter by status if provided
    if (status) {
      outcomes = outcomes.filter(o => o.status === status);
    }

    return NextResponse.json({ outcomes });
  } catch (error) {
    console.error('Error fetching outcomes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outcomes' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as CreateOutcomeInput;

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    const outcome = createOutcome(body);

    return NextResponse.json({ outcome }, { status: 201 });
  } catch (error) {
    console.error('Error creating outcome:', error);
    return NextResponse.json(
      { error: 'Failed to create outcome' },
      { status: 500 }
    );
  }
}
