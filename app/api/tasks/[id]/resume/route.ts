/**
 * Task Resume API
 * POST /api/tasks/[id]/resume - Create a new task from a checkpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLatestCheckpoint } from '@/lib/db/checkpoints';
import { createTask } from '@/lib/db/tasks';
import { getDb } from '@/lib/db/index';
import type { Task } from '@/lib/db/schema';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Get the original task
    const db = getDb();
    const originalTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
    if (!originalTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Get checkpoint
    const checkpoint = getLatestCheckpoint(id);
    if (!checkpoint) {
      return NextResponse.json({ error: 'No checkpoint found for this task' }, { status: 404 });
    }

    // Build checkpoint context for the new task
    const checkpointContext = [
      '## Resuming from checkpoint',
      checkpoint.progress_summary ? `### Progress so far\n${checkpoint.progress_summary}` : '',
      checkpoint.remaining_work ? `### Remaining work\n${checkpoint.remaining_work}` : '',
      checkpoint.files_modified ? `### Files modified\n${checkpoint.files_modified}` : '',
      checkpoint.git_sha ? `### Git SHA: ${checkpoint.git_sha}` : '',
    ].filter(Boolean).join('\n\n');

    // Create new task with checkpoint context
    const newTask = createTask({
      outcome_id: originalTask.outcome_id,
      title: `${originalTask.title} (resumed)`,
      description: originalTask.description ?? undefined,
      task_intent: originalTask.task_intent ?? undefined,
      task_approach: [originalTask.task_approach || '', checkpointContext].filter(Boolean).join('\n\n---\n\n'),
      verify_command: originalTask.verify_command ?? undefined,
      complexity_score: originalTask.complexity_score ?? undefined,
      estimated_turns: originalTask.estimated_turns ?? undefined,
      metric_command: originalTask.metric_command ?? undefined,
      metric_baseline: originalTask.metric_baseline ?? undefined,
      optimization_budget: originalTask.optimization_budget ?? undefined,
    });

    return NextResponse.json({ task: newTask }, { status: 201 });
  } catch (error) {
    console.error('[API] Failed to resume task:', error);
    return NextResponse.json(
      { error: 'Failed to resume task' },
      { status: 500 }
    );
  }
}
