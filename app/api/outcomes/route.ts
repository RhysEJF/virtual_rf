/**
 * Outcomes API Route
 *
 * GET /api/outcomes - List all outcomes
 * POST /api/outcomes - Create a new outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllOutcomes,
  getOutcomesWithCounts,
  createOutcome,
  type CreateOutcomeInput,
} from '@/lib/db/outcomes';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const withCounts = searchParams.get('counts') === 'true';
    const status = searchParams.get('status');

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
