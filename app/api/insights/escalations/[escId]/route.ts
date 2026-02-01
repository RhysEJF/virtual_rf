/**
 * Escalation Detail API
 *
 * GET /api/insights/escalations/[escId] - Get detailed escalation data including affected tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getEscalationById, parseEscalation, getObservationsByTask } from '@/lib/db/homr';
import { getTaskById } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
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

interface EscalationDetailResponse {
  id: string;
  outcomeId: string;
  outcomeName: string;
  createdAt: number;
  status: 'pending' | 'answered' | 'dismissed';
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
  };

  return NextResponse.json(response);
}
