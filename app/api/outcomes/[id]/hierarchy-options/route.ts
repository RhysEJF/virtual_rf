/**
 * Hierarchy Options API
 *
 * GET /api/outcomes/[id]/hierarchy-options
 * Returns valid parent and child options for the given outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOutcomeById,
  getValidParentOptions,
  getValidChildOptions,
} from '@/lib/db/outcomes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Get valid options
    const validParents = getValidParentOptions(id).map(o => ({
      id: o.id,
      name: o.name,
      depth: o.depth,
      status: o.status,
    }));

    const validChildren = getValidChildOptions(id).map(o => ({
      id: o.id,
      name: o.name,
      depth: o.depth,
      status: o.status,
    }));

    return NextResponse.json({
      currentParent: outcome.parent_id ? {
        id: outcome.parent_id,
        name: getOutcomeById(outcome.parent_id)?.name || 'Unknown',
      } : null,
      validParents,
      validChildren,
    });
  } catch (error) {
    console.error('Error fetching hierarchy options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch hierarchy options' },
      { status: 500 }
    );
  }
}
