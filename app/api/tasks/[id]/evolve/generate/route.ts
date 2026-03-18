/**
 * POST /api/tasks/:id/evolve/generate — AI-generate a recipe draft
 *
 * Reads task description + outcome context, calls generateRecipe(),
 * returns the draft recipe markdown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById } from '@/lib/db/tasks';
import { getOutcomeById, getDesignDoc } from '@/lib/db/outcomes';
import { generateRecipe } from '@/lib/evolve/recipe-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: NextRequest,
  context: RouteParams
): Promise<NextResponse> {
  try {
    const { id: taskId } = await context.params;
    const task = getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const outcome = getOutcomeById(task.outcome_id);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const designDoc = getDesignDoc(task.outcome_id);
    const designDocText = designDoc?.approach || '';

    const recipe = await generateRecipe({
      taskTitle: task.title,
      taskDescription: task.description || '',
      outcomeIntent: outcome.intent || '',
      designDoc: designDocText,
    });

    return NextResponse.json({ recipe });
  } catch (error) {
    console.error('[API] Error generating recipe:', error);
    return NextResponse.json(
      { error: `Failed to generate recipe: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
