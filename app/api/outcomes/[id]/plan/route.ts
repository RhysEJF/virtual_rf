/**
 * Outcome Plan API
 * GET  /api/outcomes/[id]/plan - Read PLAN.md from workspace
 * PUT  /api/outcomes/[id]/plan - Save direct edits to PLAN.md
 * POST /api/outcomes/[id]/plan - Optimize plan with user ramble
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getWorkspacePath, ensureWorkspaceExists } from '@/lib/workspace/detector';
import { claudeComplete } from '@/lib/claude/client';
import { readFileSync, existsSync, writeFileSync } from 'fs';
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { plan } = body as { plan: string };

    if (!plan || typeof plan !== 'string') {
      return NextResponse.json({ error: 'Plan content is required' }, { status: 400 });
    }

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    ensureWorkspaceExists(id);
    const planPath = join(getWorkspacePath(id), 'PLAN.md');
    writeFileSync(planPath, plan, 'utf-8');

    return NextResponse.json({ success: true, plan });
  } catch (error) {
    console.error('[API] Failed to save plan:', error);
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { ramble } = body as { ramble: string };

    if (!ramble || typeof ramble !== 'string') {
      return NextResponse.json({ error: 'Ramble text is required' }, { status: 400 });
    }

    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    // Read existing plan
    const workspacePath = getWorkspacePath(id);
    const planPath = join(workspacePath, 'PLAN.md');
    const existingPlan = existsSync(planPath) ? readFileSync(planPath, 'utf-8') : '';

    const prompt = `You are refining an implementation plan based on user feedback.

OUTCOME: ${outcome.name}
BRIEF: ${outcome.brief || 'None'}
INTENT: ${outcome.intent || 'None'}

EXISTING PLAN:
${existingPlan || 'No plan yet.'}

USER'S FEEDBACK / REFINEMENT:
"${ramble}"

Based on the user's feedback, update and improve the plan. Incorporate their suggestions, fix issues they raised, and refine the approach.

Respond with ONLY the complete updated plan as plain markdown (no JSON, no code fences wrapping the whole document). Preserve the existing structure where it still makes sense, but feel free to restructure if the user's feedback calls for it.

Rules:
- Merge feedback into the existing plan (don't start from scratch unless the user asks)
- Keep tasks focused (each should need fewer than 10 Claude turns)
- Every task should have a verify_command
- Be concise but specific
- Output the complete plan, not just the changes`;

    const result = await claudeComplete({
      prompt,
      timeout: 90000,
      maxTurns: 1,
      disableNativeTools: true,
      description: 'Plan optimization',
    });

    if (!result.success || !result.text) {
      return NextResponse.json(
        { error: result.error || 'Failed to optimize plan' },
        { status: 500 }
      );
    }

    // Clean up response
    let planText = result.text.trim();
    if (planText.startsWith('```')) {
      planText = planText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }

    // Save to workspace
    ensureWorkspaceExists(id);
    writeFileSync(planPath, planText, 'utf-8');

    return NextResponse.json({ success: true, plan: planText });
  } catch (error) {
    console.error('[API] Failed to optimize plan:', error);
    return NextResponse.json({ error: 'Failed to optimize plan' }, { status: 500 });
  }
}
