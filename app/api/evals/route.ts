/**
 * GET /api/evals — List all global evals (app + user)
 * Optional ?search=query to filter by name
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadAllEvals } from '@/lib/evolve/eval-manager';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    let evals = loadAllEvals();

    // Filter by search query
    if (search) {
      const query = search.toLowerCase();
      evals = evals.filter(
        e =>
          e.name.toLowerCase().includes(query) ||
          e.description.toLowerCase().includes(query) ||
          e.id.toLowerCase().includes(query)
      );
    }

    return NextResponse.json({ evals });
  } catch (error) {
    console.error('[API] Error listing evals:', error);
    return NextResponse.json(
      { error: 'Failed to list evals' },
      { status: 500 }
    );
  }
}
