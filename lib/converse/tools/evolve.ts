/**
 * Evolve Mode Converse Tools
 *
 * Provides setupEvolve and listEvals tools for the converse agent.
 */

import { getTaskById, updateTask } from '../../db/tasks';
import { getOutcomeById, getDesignDoc } from '../../db/outcomes';
import { loadAllEvals, getOutcomeEvals, findEvalByName, getEvalContent } from '../../evolve/eval-manager';
import { parseRecipe } from '../../evolve/recipe-parser';
import { writeEvalToWorkspace } from '../../evolve/eval-generator';
import { paths } from '../../config/paths';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * List available evals, optionally filtered by outcome.
 */
export function listEvals(outcomeId?: string): {
  evals: Array<{
    id: string;
    name: string;
    source: string;
    description: string;
    mode: string;
    direction: string;
  }>;
} {
  const evals = outcomeId ? getOutcomeEvals(outcomeId) : loadAllEvals();
  return {
    evals: evals.map(e => ({
      id: e.id,
      name: e.name,
      source: e.source,
      description: e.description,
      mode: e.mode,
      direction: e.direction,
    })),
  };
}

/**
 * Set up evolve mode on a task from an eval recipe name or generate one.
 */
export async function setupEvolve(
  taskId: string,
  evalName?: string,
  generate?: boolean
): Promise<{ success: boolean; message: string; recipe_name?: string }> {
  const task = getTaskById(taskId);
  if (!task) {
    return { success: false, message: `Task not found: ${taskId}` };
  }

  const outcome = getOutcomeById(task.outcome_id);
  if (!outcome) {
    return { success: false, message: `Outcome not found: ${task.outcome_id}` };
  }

  if (generate) {
    try {
      const { generateRecipe } = await import('../../evolve/recipe-generator');
      const designDoc = getDesignDoc(task.outcome_id);
      const designDocText = designDoc?.approach || '';

      const recipeMarkdown = await generateRecipe({
        taskTitle: task.title,
        taskDescription: task.description || '',
        outcomeIntent: outcome.intent || '',
        designDoc: designDocText,
      });

      return {
        success: true,
        message: `Generated recipe:\n\n${recipeMarkdown}\n\nUse setupEvolve with evalName to activate it after saving.`,
      };
    } catch (err) {
      return { success: false, message: `Failed to generate recipe: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (!evalName) {
    return { success: false, message: 'Either evalName or generate=true is required' };
  }

  const evalMeta = findEvalByName(evalName, task.outcome_id);
  if (!evalMeta) {
    return { success: false, message: `Eval not found: ${evalName}` };
  }

  const content = getEvalContent(evalMeta.path);
  if (!content) {
    return { success: false, message: `Could not read eval content: ${evalMeta.path}` };
  }

  const recipe = parseRecipe(content);
  if ('error' in recipe) {
    return { success: false, message: `Invalid recipe: ${recipe.error}` };
  }

  // Write eval.sh to task workspace
  const taskWorkspace = join(paths.workspaces, task.outcome_id, task.id);
  if (!existsSync(taskWorkspace)) {
    mkdirSync(taskWorkspace, { recursive: true });
  }
  writeEvalToWorkspace(recipe, taskWorkspace);

  // Save recipe to outcome evals dir
  const evalsDir = join(paths.workspaces, task.outcome_id, 'evals');
  if (!existsSync(evalsDir)) {
    mkdirSync(evalsDir, { recursive: true });
  }
  const safeName = evalMeta.id;
  writeFileSync(join(evalsDir, `${safeName}.md`), content, 'utf-8');

  // Update task
  updateTask(task.id, {
    metric_command: 'bash eval.sh',
    metric_direction: recipe.scoring.direction,
    optimization_budget: recipe.scoring.budget,
    eval_recipe_name: safeName,
  });

  return {
    success: true,
    message: `Evolve mode activated on task ${taskId} using recipe "${recipe.name}" (${recipe.scoring.mode}, ${recipe.scoring.direction}, budget=${recipe.scoring.budget})`,
    recipe_name: safeName,
  };
}
