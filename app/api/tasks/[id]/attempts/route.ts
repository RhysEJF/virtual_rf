/**
 * Task Attempts API
 * GET /api/tasks/[id]/attempts - Get attempt history for a task
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAttempts } from '@/lib/db/attempts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const attempts = getAttempts(id);
    return NextResponse.json({ attempts });
  } catch (error) {
    console.error('[API] Failed to get attempts:', error);
    return NextResponse.json(
      { error: 'Failed to get attempts' },
      { status: 500 }
    );
  }
}
