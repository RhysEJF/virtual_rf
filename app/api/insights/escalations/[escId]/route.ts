/**
 * Escalation Detail API
 *
 * GET /api/insights/escalations/[escId] - Get detailed escalation data including affected tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getEscalationById, parseEscalation, getObservationsByTask, parseObservation } from '@/lib/db/homr';
import { getTaskById } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getAttempts } from '@/lib/db/attempts';
import { getLatestCheckpoint } from '@/lib/db/checkpoints';
import type { Task } from '@/lib/db/schema';

interface Params {
  params: Promise<{ escId: string }>;
}

interface TaskSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

interface AttemptSummary {
  attemptNumber: number;
  approachSummary: string | null;
  failureReason: string | null;
  errorOutput: string | null;
  filesModified: string[];
  durationSeconds: number | null;
  createdAt: string;
}

interface CheckpointSummary {
  progressSummary: string | null;
  remainingWork: string | null;
  filesModified: string[];
  gitSha: string | null;
  createdAt: string;
}

interface ObservationSummary {
  alignmentScore: number;
  quality: string;
  onTrack: boolean;
  summary: string;
  drift: Array<{ type: string; description: string; severity: string }>;
  discoveries: Array<{ type: string; content: string }>;
  issues: Array<{ type: string; description: string; severity: string }>;
  createdAt: number;
}

interface InvestigationContext {
  attempts: AttemptSummary[];
  checkpoint: CheckpointSummary | null;
  observations: ObservationSummary[];
  lastWorkerOutput: string | null;
}

interface EscalationDetailResponse {
  id: string;
  outcomeId: string;
  outcomeName: string;
  createdAt: number;
  status: 'pending' | 'pending_confirmation' | 'answered' | 'dismissed';
  trigger: {
    type: string;
    taskId: string;
    taskTitle: string | null;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: {
      id: string;
      label: string;
      description: string;
      implications: string;
    }[];
  };
  affectedTasks: TaskSummary[];
  answer?: {
    option: string;
    optionLabel: string | null;
    context: string | null;
    answeredAt: number;
  };
  resolutionTimeMs: number | null;
  investigation: InvestigationContext;
}

export async function GET(
  _req: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  const { escId } = await params;

  // Get the escalation
  const rawEscalation = getEscalationById(escId);
  if (!rawEscalation) {
    return NextResponse.json({ error: 'Escalation not found' }, { status: 404 });
  }

  const escalation = parseEscalation(rawEscalation);

  // Get the outcome name
  const outcome = getOutcomeById(escalation.outcomeId);
  const outcomeName = outcome?.name || 'Unknown Outcome';

  // Get the trigger task details
  const triggerTask = getTaskById(escalation.trigger.taskId);

  // Get details for all affected tasks
  const affectedTasks: TaskSummary[] = escalation.affectedTasks
    .map((taskId: string) => {
      const task = getTaskById(taskId);
      if (!task) return null;
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status as string,
      };
    })
    .filter((t): t is TaskSummary => t !== null);

  // Build investigation context from related tables
  const triggerTaskId = escalation.trigger.taskId;

  // Task attempts
  const rawAttempts = getAttempts(triggerTaskId);
  const attempts: AttemptSummary[] = rawAttempts.map(a => ({
    attemptNumber: a.attempt_number,
    approachSummary: a.approach_summary,
    failureReason: a.failure_reason,
    errorOutput: a.error_output,
    filesModified: a.files_modified ? JSON.parse(a.files_modified) : [],
    durationSeconds: a.duration_seconds,
    createdAt: a.created_at,
  }));

  // Latest checkpoint
  const rawCheckpoint = getLatestCheckpoint(triggerTaskId);
  const checkpoint: CheckpointSummary | null = rawCheckpoint ? {
    progressSummary: rawCheckpoint.progress_summary,
    remainingWork: rawCheckpoint.remaining_work,
    filesModified: rawCheckpoint.files_modified ? JSON.parse(rawCheckpoint.files_modified) : [],
    gitSha: rawCheckpoint.git_sha,
    createdAt: rawCheckpoint.created_at,
  } : null;

  // HOMЯ observations
  const rawObservations = getObservationsByTask(triggerTaskId);
  const observations: ObservationSummary[] = rawObservations.map(obs => {
    const parsed = parseObservation(obs);
    return {
      alignmentScore: parsed.alignmentScore,
      quality: parsed.quality,
      onTrack: parsed.onTrack,
      summary: parsed.summary,
      drift: parsed.drift.map(d => ({ type: d.type, description: d.description, severity: d.severity })),
      discoveries: parsed.discoveries.map(d => ({ type: d.type, content: d.content })),
      issues: parsed.issues.map(i => ({ type: i.type, description: i.description, severity: i.severity })),
      createdAt: parsed.createdAt,
    };
  });

  // Last worker output from progress entries
  const db2 = getDb();
  const lastProgress = db2.prepare(`
    SELECT full_output FROM progress_entries
    WHERE task_id = ? AND full_output IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(triggerTaskId) as { full_output: string } | undefined;
  const lastWorkerOutput = lastProgress?.full_output?.slice(0, 5000) || null;

  const investigation: InvestigationContext = {
    attempts,
    checkpoint,
    observations,
    lastWorkerOutput,
  };

  // Find the selected option label if answered
  let answerOptionLabel: string | null = null;
  if (escalation.answer) {
    const selectedOption = escalation.question.options.find(
      (opt) => opt.id === escalation.answer?.option
    );
    answerOptionLabel = selectedOption?.label || null;
  }

  // Calculate resolution time
  const resolutionTimeMs =
    escalation.answer && rawEscalation.answered_at
      ? rawEscalation.answered_at - rawEscalation.created_at
      : null;

  const response: EscalationDetailResponse = {
    id: escalation.id,
    outcomeId: escalation.outcomeId,
    outcomeName,
    createdAt: escalation.createdAt,
    status: escalation.status,
    trigger: {
      type: escalation.trigger.type,
      taskId: escalation.trigger.taskId,
      taskTitle: triggerTask?.title || null,
      evidence: escalation.trigger.evidence,
    },
    question: {
      text: escalation.question.text,
      context: escalation.question.context,
      options: escalation.question.options,
    },
    affectedTasks,
    ...(escalation.answer && {
      answer: {
        option: escalation.answer.option,
        optionLabel: answerOptionLabel,
        context: escalation.answer.context,
        answeredAt: escalation.answer.answeredAt,
      },
    }),
    resolutionTimeMs,
    investigation,
  };

  return NextResponse.json(response);
}
