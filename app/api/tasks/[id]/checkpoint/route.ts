/**
 * Task Checkpoint API
 * GET /api/tasks/[id]/checkpoint - Get latest checkpoint for a task
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLatestCheckpoint } from '@/lib/db/checkpoints';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const checkpoint = getLatestCheckpoint(id);
    return NextResponse.json({ checkpoint });
  } catch (error) {
    console.error('[API] Failed to get checkpoint:', error);
    return NextResponse.json(
      { error: 'Failed to get checkpoint' },
      { status: 500 }
    );
  }
}
