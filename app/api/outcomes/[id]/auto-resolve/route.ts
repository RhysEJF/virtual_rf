/**
 * HOMЯ Auto-Resolve Configuration API
 *
 * GET - Get current auto-resolve settings
 * PATCH - Update auto-resolve settings
 * POST - Trigger auto-resolve on all pending escalations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, updateOutcome } from '@/lib/db/outcomes';
import { autoResolveAllPending, getAutoResolveConfig, AutoResolveMode } from '@/lib/homr/auto-resolver';
import { getPendingEscalations } from '@/lib/db/homr';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  const config = getAutoResolveConfig(outcome);
  const pendingCount = getPendingEscalations(outcomeId).length;

  return NextResponse.json({
    success: true,
    config,
    pendingEscalations: pendingCount,
  });
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  let body: { mode?: AutoResolveMode; threshold?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.mode !== undefined) {
    if (!['manual', 'semi-auto', 'full-auto'].includes(body.mode)) {
      return NextResponse.json({ error: 'Invalid mode. Must be manual, semi-auto, or full-auto' }, { status: 400 });
    }
    updates.auto_resolve_mode = body.mode;
  }

  if (body.threshold !== undefined) {
    if (typeof body.threshold !== 'number' || body.threshold < 0 || body.threshold > 1) {
      return NextResponse.json({ error: 'Invalid threshold. Must be a number between 0 and 1' }, { status: 400 });
    }
    updates.auto_resolve_threshold = body.threshold;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
  }

  updateOutcome(outcomeId, updates);

  const updatedOutcome = getOutcomeById(outcomeId);
  const config = getAutoResolveConfig(updatedOutcome);

  return NextResponse.json({
    success: true,
    message: `Auto-resolve settings updated`,
    config,
  });
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  // Get config, defaulting to full-auto for this explicit trigger
  let config = getAutoResolveConfig(outcome);

  // Allow override via body
  try {
    const body = await req.json().catch(() => ({}));
    if (body.mode) config = { ...config, mode: body.mode };
    if (body.threshold !== undefined) config = { ...config, confidenceThreshold: body.threshold };
  } catch {
    // Ignore JSON parse errors, use defaults
  }

  // Force to at least semi-auto for this explicit trigger
  if (config.mode === 'manual') {
    config = { ...config, mode: 'full-auto' };
  }

  const result = await autoResolveAllPending(outcomeId, config);

  return NextResponse.json({
    success: true,
    message: `Auto-resolved ${result.resolved}/${result.total} escalations`,
    ...result,
  });
}
