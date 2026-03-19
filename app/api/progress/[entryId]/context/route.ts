/**
 * Progress Entry Context API
 *
 * GET /api/progress/[entryId]/context - Get rich context for a progress entry
 * Returns task info, attempts, observations, and checkpoint for the iteration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProgressEntryById } from '@/lib/db/progress';
import { getTaskById } from '@/lib/db/tasks';
import { getAttempts } from '@/lib/db/attempts';
import { getLatestCheckpoint } from '@/lib/db/checkpoints';
import { getObservationsByTask, parseObservation } from '@/lib/db/homr';

interface Params {
  params: Promise<{ entryId: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  const { entryId } = await params;

  const entry = getProgressEntryById(parseInt(entryId, 10));
  if (!entry) {
    return NextResponse.json({ error: 'Progress entry not found' }, { status: 404 });
  }

  const taskId = entry.task_id;

  // Task info
  let task: { id: string; title: string; status: string; description: string | null } | null = null;
  if (taskId) {
    const rawTask = getTaskById(taskId);
    if (rawTask) {
      task = {
        id: rawTask.id,
        title: rawTask.title,
        status: rawTask.status,
        description: rawTask.description,
      };
    }
  }

  // Attempts for this task (up to the entry's timestamp)
  const attempts = taskId ? getAttempts(taskId).map(a => ({
    attemptNumber: a.attempt_number,
    approachSummary: a.approach_summary,
    failureReason: a.failure_reason,
    errorOutput: a.error_output,
    filesModified: a.files_modified ? JSON.parse(a.files_modified) : [],
    durationSeconds: a.duration_seconds,
    createdAt: a.created_at,
  })) : [];

  // Latest checkpoint
  let checkpoint: {
    progressSummary: string | null;
    remainingWork: string | null;
    filesModified: string[];
    gitSha: string | null;
  } | null = null;
  if (taskId) {
    const rawCheckpoint = getLatestCheckpoint(taskId);
    if (rawCheckpoint) {
      checkpoint = {
        progressSummary: rawCheckpoint.progress_summary,
        remainingWork: rawCheckpoint.remaining_work,
        filesModified: rawCheckpoint.files_modified ? JSON.parse(rawCheckpoint.files_modified) : [],
        gitSha: rawCheckpoint.git_sha,
      };
    }
  }

  // HOMЯ observation for this task
  let observation: {
    alignmentScore: number;
    quality: string;
    onTrack: boolean;
    summary: string;
    issues: Array<{ type: string; description: string; severity: string }>;
    discoveries: Array<{ type: string; content: string }>;
  } | null = null;
  if (taskId) {
    const rawObservations = getObservationsByTask(taskId);
    if (rawObservations.length > 0) {
      const parsed = parseObservation(rawObservations[0]);
      observation = {
        alignmentScore: parsed.alignmentScore,
        quality: parsed.quality,
        onTrack: parsed.onTrack,
        summary: parsed.summary,
        issues: parsed.issues.map(i => ({ type: i.type, description: i.description, severity: i.severity })),
        discoveries: parsed.discoveries.map(d => ({ type: d.type, content: d.content })),
      };
    }
  }

  return NextResponse.json({
    task,
    attempts,
    checkpoint,
    observation,
  });
}
