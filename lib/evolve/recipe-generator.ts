/**
 * Recipe Generator
 *
 * AI-generates a draft eval recipe from task/outcome context using Claude CLI.
 */

import { execFileSync } from 'child_process';

/**
 * Generate a draft eval recipe markdown from task and outcome context.
 */
export async function generateRecipe(params: {
  taskTitle: string;
  taskDescription: string;
  outcomeIntent: string;
  designDoc: string;
}): Promise<string> {
  const prompt = buildPrompt(params);

  try {
    const result = execFileSync('claude', [
      '-p', prompt,
      '--max-turns', '1',
      '--output-format', 'text',
    ], {
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '' },
      maxBuffer: 1024 * 1024,
    });

    return result.toString('utf-8').trim();
  } catch (err) {
    throw new Error(`Failed to generate recipe: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildPrompt(params: {
  taskTitle: string;
  taskDescription: string;
  outcomeIntent: string;
  designDoc: string;
}): string {
  return `You are a recipe writer for Flow's evolve mode. Generate a complete eval recipe in markdown format.

## Context

**Task:** ${params.taskTitle}
${params.taskDescription ? `**Description:** ${params.taskDescription}` : ''}

**Outcome Intent:**
${params.outcomeIntent || 'Not provided'}

**Design Doc:**
${params.designDoc || 'Not provided'}

## Instructions

Write an eval recipe that will help optimize this task's output. Follow this exact format:

\`\`\`markdown
# Evolve Recipe: <name>

## Artifact
- file: <the file to optimize>
- description: <what this artifact is>

## Scoring
- mode: judge
- direction: higher
- budget: 5
- samples: 1

## Criteria
- <Criterion Name> (<weight>): <description>
- <Criterion Name> (<weight>): <description>
- <Criterion Name> (<weight>): <description>

## Examples
### "<low quality example label>" → <low score>
<brief reasoning why this scores low>

### "<high quality example label>" → <high score>
<brief reasoning why this scores high>

## Context
<any additional context the judge needs>

## Prerequisites
- <file>: <description of what it is>
\`\`\`

Rules:
1. Choose 3-5 criteria with weights summing to ~1.0
2. Include at least 2 calibration examples (one low, one high)
3. If the task involves code, consider using mode: command with a test/benchmark command
4. If the task involves content/writing, use mode: judge
5. Set direction to "higher" for quality scores, "lower" for error/cost metrics
6. Budget should be 3-7 iterations depending on complexity
7. The artifact file should be the primary output file of the task

Output ONLY the recipe markdown, no extra commentary.`;
}
