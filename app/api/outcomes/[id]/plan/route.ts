/**
 * Outcome Plan API
 * GET /api/outcomes/[id]/plan - Read PLAN.md from workspace
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getWorkspacePath } from '@/lib/workspace/detector';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const workspacePath = getWorkspacePath(id);
    const planPath = join(workspacePath, 'PLAN.md');

    if (!existsSync(planPath)) {
      return NextResponse.json({ plan: null, exists: false });
    }

    const content = readFileSync(planPath, 'utf-8');
    return NextResponse.json({ plan: content, exists: true });
  } catch (error) {
    console.error('[API] Failed to read plan:', error);
    return NextResponse.json(
      { error: 'Failed to read plan' },
      { status: 500 }
    );
  }
}
