/**
 * GET /api/evals/outcome — List evals in outcome workspace(s)
 * Query params:
 *   ?outcomeId=X — Specific outcome (required)
 *   &includeContent=true — Include full markdown content
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeEvals, getEvalContent } from '@/lib/evolve/eval-manager';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const outcomeId = searchParams.get('outcomeId');
    const includeContent = searchParams.get('includeContent') === 'true';

    if (!outcomeId) {
      return NextResponse.json(
        { error: 'outcomeId query parameter is required' },
        { status: 400 }
      );
    }

    const evals = getOutcomeEvals(outcomeId);

    if (includeContent) {
      const evalsWithContent = evals.map(e => ({
        ...e,
        content: getEvalContent(e.path) || '',
      }));
      return NextResponse.json({ evals: evalsWithContent });
    }

    return NextResponse.json({ evals });
  } catch (error) {
    console.error('[API] Error listing outcome evals:', error);
    return NextResponse.json(
      { error: 'Failed to list outcome evals' },
      { status: 500 }
    );
  }
}
