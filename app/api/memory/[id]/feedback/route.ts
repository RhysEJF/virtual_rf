/**
 * Memory Feedback API Route
 *
 * POST /api/memory/[id]/feedback
 * Accepts feedback on whether a memory was helpful for a specific task.
 * Updates the memory_usage record and the memory's helpfulness metrics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, now } from '@/lib/db';
import type { Memory, MemoryUsage } from '@/lib/db/schema';

/**
 * Request body for memory feedback
 */
interface FeedbackRequest {
  taskId: string;
  wasHelpful: boolean;
}

interface FeedbackResponse {
  success: true;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<FeedbackResponse | ErrorResponse>> {
  try {
    const { id: memoryId } = await params;
    const body = (await request.json()) as FeedbackRequest;
    const { taskId, wasHelpful } = body;

    // Validate input
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        {
          error: 'Missing required parameter',
          details: 'taskId (string) is required',
        },
        { status: 400 }
      );
    }

    if (typeof wasHelpful !== 'boolean') {
      return NextResponse.json(
        {
          error: 'Missing required parameter',
          details: 'wasHelpful (boolean) is required',
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const timestamp = now();

    // Check if memory exists
    const memory = db
      .prepare(`SELECT * FROM memories WHERE id = ?`)
      .get(memoryId) as Memory | undefined;

    if (!memory) {
      return NextResponse.json(
        {
          error: 'Memory not found',
          details: `No memory found with id: ${memoryId}`,
        },
        { status: 404 }
      );
    }

    // Find the memory_usage record for this memory+task pair
    const usage = db
      .prepare(
        `SELECT * FROM memory_usage WHERE memory_id = ? AND task_id = ?`
      )
      .get(memoryId, taskId) as MemoryUsage | undefined;

    if (!usage) {
      return NextResponse.json(
        {
          error: 'Usage record not found',
          details: `No memory_usage record found for memory ${memoryId} and task ${taskId}`,
        },
        { status: 404 }
      );
    }

    // Check if feedback was already provided (prevent double-counting)
    if (usage.was_helpful !== null) {
      return NextResponse.json(
        {
          error: 'Feedback already provided',
          details: 'Feedback has already been recorded for this memory+task pair',
        },
        { status: 409 }
      );
    }

    // Update in a transaction for consistency
    const wasHelpfulValue = wasHelpful ? 1 : 0;
    const scoreChange = wasHelpful ? 1 : -1;

    db.transaction(() => {
      // Update memory_usage record with was_helpful value
      db.prepare(
        `UPDATE memory_usage SET was_helpful = ? WHERE id = ?`
      ).run(wasHelpfulValue, usage.id);

      // Update memory's helpfulness_score (+1 if helpful, -1 if not)
      // and increment times_helpful if wasHelpful is true
      if (wasHelpful) {
        db.prepare(
          `UPDATE memories
           SET helpfulness_score = helpfulness_score + ?,
               times_helpful = times_helpful + 1,
               updated_at = ?
           WHERE id = ?`
        ).run(scoreChange, timestamp, memoryId);
      } else {
        db.prepare(
          `UPDATE memories
           SET helpfulness_score = helpfulness_score + ?,
               updated_at = ?
           WHERE id = ?`
        ).run(scoreChange, timestamp, memoryId);
      }
    })();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Memory Feedback API] Error:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred';

    return NextResponse.json(
      {
        error: 'Feedback submission failed',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
