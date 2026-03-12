/**
 * Discovery Pipeline API Route
 *
 * POST /api/outcomes/[id]/discover - Start the discovery pipeline
 * GET  /api/outcomes/[id]/discover - Get current discovery session status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { runDiscovery, getDiscoverySession, DiscoveryTier } from '@/lib/agents/discovery-agent';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const tierOverride = body.tier as DiscoveryTier | undefined;

  // Validate tier override if provided
  if (tierOverride && !['QUICK', 'STANDARD', 'DEEP'].includes(tierOverride)) {
    return NextResponse.json(
      { error: 'Invalid tier. Must be QUICK, STANDARD, or DEEP' },
      { status: 400 }
    );
  }

  // Check for existing running session
  const existing = getDiscoverySession(outcomeId);
  if (existing && existing.status === 'running') {
    return NextResponse.json(
      { error: 'Discovery already running', session: existing },
      { status: 409 }
    );
  }

  // Start discovery in background — don't await
  runDiscovery(outcomeId, tierOverride).catch(err => {
    console.error('[Discovery API] Unhandled error:', err);
  });

  // Return immediately with the initial session state
  const session = getDiscoverySession(outcomeId);

  return NextResponse.json(
    {
      message: 'Discovery pipeline started',
      session: session || {
        outcomeId,
        tier: tierOverride || 'STANDARD',
        status: 'running',
        phase: 'clarity-check',
      },
    },
    { status: 202 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  const session = getDiscoverySession(outcomeId);
  if (!session) {
    return NextResponse.json({
      session: null,
      message: 'No active discovery session for this outcome',
    });
  }

  return NextResponse.json({ session });
}
