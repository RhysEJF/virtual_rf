/**
 * GET /api/evals/outcome/:id — Get eval content by path-encoded ID
 *   ID format: outcomeId:evalName (e.g., out_abc123:my-eval)
 *
 * PUT /api/evals/outcome/:id — Update eval content
 */

import { NextRequest, NextResponse } from 'next/server';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { paths } from '@/lib/config/paths';
import { getEvalContent } from '@/lib/evolve/eval-manager';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseId(id: string): { outcomeId: string; evalName: string } | null {
  const parts = id.split(':');
  if (parts.length < 2) return null;
  return { outcomeId: parts[0], evalName: parts.slice(1).join(':') };
}

export async function GET(
  _request: NextRequest,
  context: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const parsed = parseId(decodeURIComponent(id));
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid ID format. Expected: outcomeId:evalName' },
        { status: 400 }
      );
    }

    const evalPath = join(paths.workspaces, parsed.outcomeId, 'evals', `${parsed.evalName}.md`);
    const content = getEvalContent(evalPath);

    if (content === null) {
      return NextResponse.json({ error: 'Eval not found' }, { status: 404 });
    }

    return NextResponse.json({
      name: parsed.evalName,
      outcomeId: parsed.outcomeId,
      content,
      path: evalPath,
    });
  } catch (error) {
    console.error('[API] Error getting eval:', error);
    return NextResponse.json(
      { error: 'Failed to get eval' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const parsed = parseId(decodeURIComponent(id));
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid ID format. Expected: outcomeId:evalName' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content (string) is required' },
        { status: 400 }
      );
    }

    const evalsDir = join(paths.workspaces, parsed.outcomeId, 'evals');
    const evalPath = join(evalsDir, `${parsed.evalName}.md`);

    // Ensure evals directory exists
    const { mkdirSync } = await import('fs');
    if (!existsSync(evalsDir)) {
      mkdirSync(evalsDir, { recursive: true });
    }

    writeFileSync(evalPath, content, 'utf-8');

    return NextResponse.json({
      name: parsed.evalName,
      outcomeId: parsed.outcomeId,
      path: evalPath,
      updated: true,
    });
  } catch (error) {
    console.error('[API] Error updating eval:', error);
    return NextResponse.json(
      { error: 'Failed to update eval' },
      { status: 500 }
    );
  }
}
