/**
 * Iterate API - Create tasks from user feedback on completed work
 *
 * POST /api/outcomes/[id]/iterate
 * Body: { feedback: string, startWorker?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, updateOutcome } from '@/lib/db/outcomes';
import { createTask } from '@/lib/db/tasks';
import { claudeComplete } from '@/lib/claude/client';
import { startRalphWorker } from '@/lib/ralph/worker';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ParsedTask {
  title: string;
  description: string;
  priority: number;
  depends_on?: string[];
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await context.params;
    const { feedback, startWorker = true } = await request.json();

    if (!feedback?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Feedback is required' },
        { status: 400 }
      );
    }

    // Get outcome context
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { success: false, error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Parse intent for context
    let intentSummary = outcome.brief || outcome.name;
    if (outcome.intent) {
      try {
        const parsed = JSON.parse(outcome.intent);
        intentSummary = parsed.summary || intentSummary;
      } catch {
        // Use brief/name
      }
    }

    // Use Claude to convert feedback into actionable tasks
    const prompt = `You are helping iterate on a completed project. The user has feedback/change requests.

Project: ${outcome.name}
Original Intent: ${intentSummary}

User Feedback:
${feedback}

Convert this feedback into specific, actionable tasks. Each task should be:
- Specific enough for a developer to implement
- Self-contained (can be done independently where possible)
- Focused on one change

If tasks have clear sequential dependencies (e.g., "design API" must happen before "implement feature"), use depends_on to specify the relationship by referencing the task index (e.g., depends_on: ["task_0"] means depends on the first task).

Respond with ONLY a JSON array of tasks, no other text:
[
  {
    "title": "Short task title",
    "description": "Detailed description of what needs to change and how",
    "priority": 1,
    "depends_on": []
  }
]

Priority: 1 = critical/blocking, 2 = important, 3 = nice to have
depends_on: Array of task references (e.g., ["task_0", "task_1"]) for tasks that must complete first. Use empty array for independent tasks.

If the feedback is unclear or too vague, create a single task to investigate and clarify.`;

    const result = await claudeComplete({ prompt, timeout: 60000 });
    const response = result.text;

    // Parse the response
    let tasks: ParsedTask[] = [];
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        tasks = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('[Iterate] Failed to parse Claude response:', parseError);
      // Fallback: create a single task from the feedback
      tasks = [{
        title: 'Address user feedback',
        description: feedback,
        priority: 1,
      }];
    }

    // Create the tasks, mapping temporary task references to actual IDs
    const createdTasks: string[] = [];
    const taskIdMap: Record<string, string> = {}; // Maps "task_0" -> actual task ID

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Resolve depends_on references to actual task IDs
      const resolvedDeps: string[] = [];
      if (task.depends_on && Array.isArray(task.depends_on)) {
        for (const dep of task.depends_on) {
          const actualId = taskIdMap[dep];
          if (actualId) {
            resolvedDeps.push(actualId);
          }
        }
      }

      const newTask = createTask({
        outcome_id: outcomeId,
        title: task.title,
        description: task.description,
        priority: task.priority || 2,
        from_review: true, // Mark as coming from user feedback
        depends_on: resolvedDeps.length > 0 ? resolvedDeps : undefined,
      });
      if (newTask) {
        createdTasks.push(newTask.id);
        taskIdMap[`task_${i}`] = newTask.id;
      }
    }

    // Ensure outcome is active
    if (outcome.status !== 'active') {
      updateOutcome(outcomeId, { status: 'active' });
    }

    // Optionally start a worker
    let workerId: string | null = null;
    if (startWorker && createdTasks.length > 0) {
      const worker = await startRalphWorker({ outcomeId });
      workerId = worker?.workerId || null;
    }

    return NextResponse.json({
      success: true,
      tasksCreated: createdTasks.length,
      taskIds: createdTasks,
      workerId,
    });
  } catch (error) {
    console.error('[Iterate API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process feedback' },
      { status: 500 }
    );
  }
}
