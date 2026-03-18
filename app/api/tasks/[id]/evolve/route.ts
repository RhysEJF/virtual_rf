/**
 * POST /api/tasks/:id/evolve — Activate evolve mode from a recipe
 *
 * Request body options:
 *   { recipe_name: string }              — Use existing eval by name
 *   { recipe_content: string }           — Inline recipe markdown
 *   { recipe_content: string, save_as: string } — Save + activate
 *   { overrides: { budget?, samples?, direction? } } — Override recipe defaults
 */

import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getTaskById, updateTask } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import { paths } from '@/lib/config/paths';
import { parseRecipe, applyOverrides } from '@/lib/evolve/recipe-parser';
import { writeEvalToWorkspace } from '@/lib/evolve/eval-generator';
import { findEvalByName, getEvalContent } from '@/lib/evolve/eval-manager';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
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

    const body = await request.json();
    const { recipe_name, recipe_content, save_as, overrides } = body;

    let recipeMarkdown: string;
    let recipeName: string;

    if (recipe_name) {
      // Look up existing eval by name
      const evalMeta = findEvalByName(recipe_name, task.outcome_id);
      if (!evalMeta) {
        return NextResponse.json(
          { error: `Eval not found: ${recipe_name}` },
          { status: 404 }
        );
      }
      const content = getEvalContent(evalMeta.path);
      if (!content) {
        return NextResponse.json(
          { error: `Could not read eval content: ${evalMeta.path}` },
          { status: 500 }
        );
      }
      recipeMarkdown = content;
      recipeName = evalMeta.name;
    } else if (recipe_content) {
      recipeMarkdown = recipe_content;
      recipeName = save_as || 'inline-recipe';
    } else {
      return NextResponse.json(
        { error: 'Either recipe_name or recipe_content is required' },
        { status: 400 }
      );
    }

    // Parse recipe
    const recipe = parseRecipe(recipeMarkdown);
    if ('error' in recipe) {
      return NextResponse.json(
        { error: `Invalid recipe: ${recipe.error}` },
        { status: 400 }
      );
    }

    // Apply overrides if provided
    let finalRecipe = recipe;
    if (overrides && typeof overrides === 'object') {
      finalRecipe = applyOverrides(recipe, overrides);
    }

    // Ensure task workspace exists
    const taskWorkspace = join(paths.workspaces, task.outcome_id, task.id);
    if (!existsSync(taskWorkspace)) {
      mkdirSync(taskWorkspace, { recursive: true });
    }

    // Generate and write eval.sh (using potentially overridden recipe)
    const evalScriptPath = writeEvalToWorkspace(finalRecipe, taskWorkspace);

    // Save recipe to workspace evals/ directory
    const evalsDir = join(paths.workspaces, task.outcome_id, 'evals');
    if (!existsSync(evalsDir)) {
      mkdirSync(evalsDir, { recursive: true });
    }
    const safeRecipeName = (save_as || recipe.name).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    writeFileSync(join(evalsDir, `${safeRecipeName}.md`), recipeMarkdown, 'utf-8');

    // Also save to user evals if save_as is provided
    if (save_as) {
      const userEvalsDir = paths.userEvals;
      if (!existsSync(userEvalsDir)) {
        mkdirSync(userEvalsDir, { recursive: true });
      }
      writeFileSync(join(userEvalsDir, `${safeRecipeName}.md`), recipeMarkdown, 'utf-8');
    }

    // Update task with evolve settings (using overridden values)
    const updated = updateTask(task.id, {
      metric_command: 'bash eval.sh',
      metric_direction: finalRecipe.scoring.direction,
      optimization_budget: finalRecipe.scoring.budget,
      eval_recipe_name: safeRecipeName,
      eval_overrides: overrides ? JSON.stringify(overrides) : null,
    });

    return NextResponse.json({
      task: updated,
      eval_script: evalScriptPath,
      recipe: {
        name: recipe.name,
        mode: finalRecipe.scoring.mode,
        direction: finalRecipe.scoring.direction,
        budget: finalRecipe.scoring.budget,
        criteria_count: finalRecipe.criteria.length,
        examples_count: finalRecipe.examples.length,
      },
    });
  } catch (error) {
    console.error('[API] Error activating evolve mode:', error);
    return NextResponse.json(
      { error: 'Failed to activate evolve mode' },
      { status: 500 }
    );
  }
}
