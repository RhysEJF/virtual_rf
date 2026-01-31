/**
 * Resources API - Output Files
 *
 * GET /api/resources/files - Get all output files across all outcomes
 */

import { NextResponse } from 'next/server';
import { getAllOutcomes } from '@/lib/db/outcomes';
import { detectOutputs } from '@/lib/workspace/detector';

export async function GET(): Promise<NextResponse> {
  try {
    const outcomes = getAllOutcomes();

    const byOutcome: Record<string, Array<{
      id: string;
      name: string;
      outcomeId: string;
      outcomeName: string;
      path: string;
      type: string;
      createdAt: number;
    }>> = {};

    let total = 0;

    for (const outcome of outcomes) {
      try {
        const workspaceInfo = detectOutputs(outcome.id);

        if (!workspaceInfo.exists || workspaceInfo.outputs.length === 0) continue;

        const files = workspaceInfo.outputs.map((output) => ({
          id: `${outcome.id}-${output.name}`,
          name: output.name,
          outcomeId: outcome.id,
          outcomeName: outcome.name,
          path: output.path,
          type: output.type,
          createdAt: Date.now(), // detectOutputs doesn't include timestamps
        }));

        if (files.length > 0) {
          byOutcome[outcome.name] = files;
          total += files.length;
        }
      } catch {
        // Skip outcomes with issues
      }
    }

    return NextResponse.json({
      byOutcome,
      total,
    });
  } catch (error) {
    console.error('[Resources API] Failed to fetch files:', error);
    return NextResponse.json(
      { error: 'Failed to fetch files' },
      { status: 500 }
    );
  }
}
