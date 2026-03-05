/**
 * Outcome Task Refinement API Route
 *
 * POST /api/outcomes/[id]/refine - Create refinement task and deploy worker
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { createTask, getPendingTasks, getTasksByOutcome } from '@/lib/db/tasks';
import { startRalphWorker } from '@/lib/ralph/worker';
import { createActivity } from '@/lib/db/activity';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Check for pending tasks to refine
    const pendingTasks = getPendingTasks(outcomeId);
    if (pendingTasks.length === 0) {
      return NextResponse.json(
        { error: 'No pending tasks to refine' },
        { status: 400 }
      );
    }

    // Check for existing refinement task (pending or running)
    const allTasks = getTasksByOutcome(outcomeId);
    const existingRefinement = allTasks.find(
      t => t.title === 'Refine pending tasks' && (t.status === 'pending' || t.status === 'running')
    );
    if (existingRefinement) {
      return NextResponse.json(
        { error: 'A refinement task is already active', taskId: existingRefinement.id },
        { status: 400 }
      );
    }

    // Build refinement task description with outcome context
    const taskList = pendingTasks
      .map(t => `- ${t.id}: ${t.title}`)
      .join('\n');

    const description = [
      `## Refinement Task`,
      ``,
      `Work through each pending task for this outcome and enrich it with structured fields.`,
      ``,
      `### Outcome Context`,
      `- **Name**: ${outcome.name}`,
      outcome.brief ? `- **Brief**: ${outcome.brief}` : null,
      ``,
      `### Tasks to Refine (${pendingTasks.length})`,
      ``,
      taskList,
      ``,
      `### Instructions`,
      ``,
      `1. Run \`flow show\` to load full outcome context`,
      `2. For each task above, run \`flow task show {id}\` to inspect current state`,
      `3. Enrich missing fields using \`flow task update {id}\`:`,
      `   - \`--intent\`: What this task specifically achieves`,
      `   - \`--approach\`: How a worker should execute (steps, files, constraints)`,
      `   - \`--complexity\`: Complexity score 1-10`,
      `   - \`--turns\`: Estimated turns to complete`,
      `4. Set \`--depends-on\` where tasks have ordering requirements`,
      `5. If any task has complexity ≥ 6 or estimated turns > 30, decompose it into subtasks`,
      `6. Run \`flow tasks\` at the end to verify all tasks are enriched`,
      ``,
      `Use the task-refiner skill methodology for assessment criteria and quality standards.`,
    ].filter(Boolean).join('\n');

    // Create the refinement task with highest priority
    const refinementTask = createTask({
      outcome_id: outcomeId,
      title: 'Refine pending tasks',
      description,
      priority: 0,
      phase: 'execution',
      task_intent: `Audit and enrich ${pendingTasks.length} pending tasks with intent, approach, complexity scores, turn estimates, and dependencies so execution workers can succeed on first attempt.`,
      task_approach: 'Use flow CLI tools to inspect each task, assess complexity, enrich structured fields, set dependencies, and decompose oversized tasks. Follow the task-refiner skill methodology.',
      complexity_score: 4,
      estimated_turns: Math.min(40, pendingTasks.length * 3 + 10),
    });

    // Log activity
    createActivity({
      outcome_id: outcomeId,
      outcome_name: outcome.name,
      type: 'task_refinement_started',
      title: 'Task refinement started',
      description: `Refining ${pendingTasks.length} pending tasks`,
      metadata: { task_id: refinementTask.id, pending_count: pendingTasks.length },
    });

    // Deploy a Ralph worker
    const result = await startRalphWorker({
      outcomeId,
      maxTurns: 40,
    });

    if (!result.started) {
      return NextResponse.json(
        {
          success: true,
          taskId: refinementTask.id,
          workerId: null,
          warning: result.error || 'Worker failed to start, but refinement task was created',
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        taskId: refinementTask.id,
        workerId: result.workerId,
        message: `Refinement task created. Worker deployed to refine ${pendingTasks.length} tasks.`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[Refine API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create refinement task' },
      { status: 500 }
    );
  }
}
