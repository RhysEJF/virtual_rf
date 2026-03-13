/**
 * Discovery Agent
 *
 * Orchestrates the discovery pipeline for outcomes before task execution.
 * Runs clarity check → interview → research → planning → task generation.
 *
 * Phases:
 * - QUICK tier: clarity check → task generation directly
 * - STANDARD tier: clarity check → research → plan (MORE detail) → task generation
 * - DEEP tier: clarity check → interview → research → plan (A LOT detail) → task generation
 */

import { claudeComplete } from '../claude/client';
import { getOutcomeById } from '../db/outcomes';
import { createTask, getTasksByOutcome } from '../db/tasks';
import { createActivity } from '../db/activity';
import { paths } from '../config/paths';
import { getWorkspacePath, ensureWorkspaceExists } from '../workspace/detector';
import path from 'path';
import fs from 'fs';

export type DiscoveryTier = 'QUICK' | 'STANDARD' | 'DEEP';

export interface DiscoverySession {
  outcomeId: string;
  tier: DiscoveryTier;
  status: 'running' | 'completed' | 'failed';
  phase: 'clarity-check' | 'interview' | 'research' | 'planning' | 'task-generation' | 'done';
  planPath?: string;
  error?: string;
}

// In-memory session tracking (survives as long as server process is alive)
const activeSessions = new Map<string, DiscoverySession>();

export function getDiscoverySession(outcomeId: string): DiscoverySession | null {
  return activeSessions.get(outcomeId) || null;
}

/**
 * Run the full discovery pipeline for an outcome.
 * Returns the session when complete (or failed).
 */
export async function runDiscovery(
  outcomeId: string,
  tierOverride?: DiscoveryTier
): Promise<DiscoverySession> {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    throw new Error(`Outcome ${outcomeId} not found`);
  }

  const session: DiscoverySession = {
    outcomeId,
    tier: tierOverride || 'STANDARD',
    status: 'running',
    phase: 'clarity-check',
  };
  activeSessions.set(outcomeId, session);

  try {
    createActivity({
      outcome_id: outcomeId,
      outcome_name: outcome.name,
      type: 'discovery_started',
      title: 'Discovery pipeline started',
      description: `Tier: ${session.tier}`,
      metadata: { tier: session.tier },
    });

    // Build the full description from outcome fields
    const description = outcome.brief || outcome.name || '';
    const intent = outcome.intent ? JSON.parse(outcome.intent) : null;
    const intentText = intent?.items
      ?.map((i: { title: string; description: string }) => `- ${i.title}: ${i.description}`)
      .join('\n') || '';
    let fullDescription = `${description}\n\n${intentText}`.trim();

    // Phase 1: Clarity Check (unless tier overridden by caller)
    if (!tierOverride) {
      session.phase = 'clarity-check';
      activeSessions.set(outcomeId, session);

      const clarityResult = await runClarityCheck(fullDescription);
      session.tier = clarityResult.tier;
      activeSessions.set(outcomeId, session);

      createActivity({
        outcome_id: outcomeId,
        outcome_name: outcome.name,
        type: 'discovery_clarity',
        title: `Clarity check: ${clarityResult.tier} tier`,
        description: clarityResult.reasoning,
        metadata: { tier: clarityResult.tier },
      });
    }

    // Phase 2: QUICK tier — skip research and planning, generate tasks directly
    if (session.tier === 'QUICK') {
      session.phase = 'task-generation';
      activeSessions.set(outcomeId, session);

      await generateTasksFromDescription(outcomeId, fullDescription);

      session.phase = 'done';
      session.status = 'completed';
      activeSessions.set(outcomeId, session);

      createActivity({
        outcome_id: outcomeId,
        outcome_name: outcome.name,
        type: 'discovery_completed',
        title: 'Discovery completed (QUICK tier)',
        description: 'Tasks generated directly from description',
      });

      return session;
    }

    // Phase 2.5: Self-directed Interview (DEEP tier only)
    if (session.tier === 'DEEP') {
      session.phase = 'interview';
      activeSessions.set(outcomeId, session);

      const interviewResult = await runSelfDirectedInterview(outcomeId, fullDescription);
      // Enrich description with interview findings
      fullDescription = `${fullDescription}\n\n## Interview Findings\n${interviewResult}`;

      createActivity({
        outcome_id: outcomeId,
        outcome_name: outcome.name,
        type: 'discovery_interview',
        title: 'Self-directed interview completed',
        description: interviewResult.slice(0, 200),
      });
    }

    // Phase 3: Local Research (STANDARD and DEEP)
    session.phase = 'research';
    activeSessions.set(outcomeId, session);

    const researchContext = await runLocalResearch(outcomeId, fullDescription);

    createActivity({
      outcome_id: outcomeId,
      outcome_name: outcome.name,
      type: 'discovery_research',
      title: 'Local research completed',
      description: researchContext.slice(0, 200),
    });

    // Phase 4: Plan Writing
    session.phase = 'planning';
    activeSessions.set(outcomeId, session);

    const detailLevel = session.tier === 'DEEP' ? 'A LOT' : 'MORE';
    const planPath = await writePlan(outcomeId, outcome.name, fullDescription, researchContext, detailLevel);
    session.planPath = planPath;
    activeSessions.set(outcomeId, session);

    createActivity({
      outcome_id: outcomeId,
      outcome_name: outcome.name,
      type: 'discovery_plan',
      title: 'Implementation plan written',
      description: `Plan document: ${planPath}`,
      metadata: { plan_path: planPath, detail_level: detailLevel },
    });

    // Phase 5: Task Generation from Plan
    session.phase = 'task-generation';
    activeSessions.set(outcomeId, session);

    const planContent = fs.readFileSync(planPath, 'utf-8');
    await generateTasksFromPlan(outcomeId, planContent);

    session.phase = 'done';
    session.status = 'completed';
    activeSessions.set(outcomeId, session);

    createActivity({
      outcome_id: outcomeId,
      outcome_name: outcome.name,
      type: 'discovery_completed',
      title: `Discovery completed (${session.tier} tier)`,
      description: 'Plan and tasks generated',
      metadata: { tier: session.tier, plan_path: planPath },
    });

    return session;

  } catch (error) {
    session.status = 'failed';
    session.error = error instanceof Error ? error.message : String(error);
    activeSessions.set(outcomeId, session);

    try {
      const currentOutcome = getOutcomeById(outcomeId);
      createActivity({
        outcome_id: outcomeId,
        outcome_name: currentOutcome?.name || outcomeId,
        type: 'discovery_failed',
        title: 'Discovery pipeline failed',
        description: session.error,
      });
    } catch {
      // Non-critical — don't mask original error
    }

    return session;
  }
}

// ============================================================================
// Phase Implementations
// ============================================================================

async function runClarityCheck(
  description: string
): Promise<{ tier: DiscoveryTier; reasoning: string }> {
  const prompt = `Evaluate this outcome description for planning depth:

${description}

Score each dimension 1-5:
1. Specificity — How concrete and actionable? (5 = very concrete)
2. Ambiguity — How many terms could be interpreted multiple ways? (5 = no ambiguity)
3. Scope — How well-bounded is the work? (5 = very clear boundaries)
4. Technical Depth — How much implementation detail is provided? (5 = very detailed)

Then recommend a tier:
- QUICK (total >= 16): Clear and bounded — skip interview/research, generate tasks directly
- STANDARD (total 8-15): Needs some clarification — run research and planning
- DEEP (total < 8): Vague or complex — full research, interview, and detailed planning

Respond with ONLY valid JSON (no markdown fences):
{"tier": "QUICK", "scores": {"specificity": 4, "ambiguity": 4, "scope": 4, "technicalDepth": 4}, "reasoning": "Clear enough to proceed directly", "concerns": []}`;

  const result = await claudeComplete({
    prompt,
    maxTurns: 1,
    disableNativeTools: true,
    description: 'Discovery clarity check',
  });

  try {
    const text = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(text);
    return {
      tier: (parsed.tier as DiscoveryTier) || 'STANDARD',
      reasoning: parsed.reasoning || '',
    };
  } catch {
    return { tier: 'STANDARD', reasoning: 'Failed to parse clarity check — defaulting to STANDARD' };
  }
}

/**
 * Self-directed interview for DEEP tier.
 * The agent identifies top unknowns, makes best-guess answers based on
 * codebase context, and flags low-confidence items as risks.
 * This enriches the plan quality without requiring interactive user input.
 */
async function runSelfDirectedInterview(
  outcomeId: string,
  description: string
): Promise<string> {
  const prompt = `You are conducting a self-directed interview to clarify an outcome before planning.

OUTCOME DESCRIPTION:
${description}

The project is at ~/flow/ (Next.js 14, TypeScript, SQLite).

Follow this process:
1. Identify the 3-5 most important unknowns or ambiguities in this outcome
2. For each unknown, use your knowledge of the codebase and common patterns to provide a best-guess answer
3. Rate your confidence in each answer (high/medium/low)
4. Flag low-confidence answers as risks that should be validated during implementation

Respond with ONLY valid JSON (no markdown fences):
{
  "clarifications": [
    {
      "question": "The key unknown",
      "answer": "Your best-guess answer based on codebase context",
      "confidence": "high|medium|low",
      "impact": "How this affects the implementation plan"
    }
  ],
  "scope_summary": "Concise scope statement incorporating your answers",
  "constraints": ["Any constraints discovered from codebase analysis"],
  "out_of_scope": ["Things that should be explicitly excluded"],
  "risks": ["Low-confidence assumptions that need validation"]
}`;

  const result = await claudeComplete({
    prompt,
    outcomeId,
    maxTurns: 3,
    description: 'Discovery self-directed interview',
  });

  try {
    const text = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return result.text;

    const parsed = JSON.parse(jsonMatch[0]);

    // Format interview results as readable context for downstream phases
    const lines: string[] = [];
    if (parsed.scope_summary) {
      lines.push(`**Scope:** ${parsed.scope_summary}`);
    }
    if (parsed.clarifications?.length) {
      lines.push('\n**Key Decisions:**');
      for (const c of parsed.clarifications) {
        const confidence = c.confidence === 'low' ? ' [LOW CONFIDENCE — validate]' : '';
        lines.push(`- ${c.question} → ${c.answer}${confidence}`);
      }
    }
    if (parsed.constraints?.length) {
      lines.push(`\n**Constraints:** ${parsed.constraints.join('; ')}`);
    }
    if (parsed.out_of_scope?.length) {
      lines.push(`\n**Out of Scope:** ${parsed.out_of_scope.join('; ')}`);
    }
    if (parsed.risks?.length) {
      lines.push(`\n**Risks:** ${parsed.risks.join('; ')}`);
    }
    return lines.join('\n');
  } catch {
    // If parsing fails, return raw text — still useful context
    return result.text;
  }
}

async function runLocalResearch(outcomeId: string, description: string): Promise<string> {
  const prompt = `You are researching the Flow project codebase to gather context for planning.

Outcome description:
${description}

The project is at ~/flow/ (Next.js 14, TypeScript, SQLite).
Key directories: lib/ (business logic), app/ (Next.js routes), cli/ (CLI tool).

Analyze what exists in the codebase that's relevant to this outcome. Focus on:
1. Existing files and patterns that relate to this work
2. Integration points (APIs, database tables, shared utilities)
3. Conventions to follow (naming, error handling, imports)
4. Potential risks or complications

Provide a concise research summary as plain text — no code implementations, only findings about what currently exists.`;

  const result = await claudeComplete({
    prompt,
    outcomeId,
    maxTurns: 3,
    description: 'Discovery local research',
  });

  return result.text || 'No research context gathered.';
}

async function writePlan(
  outcomeId: string,
  outcomeName: string,
  description: string,
  researchContext: string,
  detailLevel: string
): Promise<string> {
  const workspacePath = getWorkspacePath(outcomeId);
  ensureWorkspaceExists(outcomeId);

  const prompt = `Write an implementation plan document for this outcome.

## Outcome: ${outcomeName}
${description}

## Research Context
${researchContext}

## Required Detail Level: ${detailLevel}

Write a plan in clean markdown following this structure:

### Approach
- High-level strategy and why this approach over alternatives
- Simplicity criterion: is this the simplest approach that works?

### Tasks
List tasks in execution order. For each task include:
- **Title**: Action-oriented name
- **Description**: What to change and why, with acceptance criteria
- **verify_command**: A shell command (e.g., \`npm run typecheck\`, \`node -e "require('./lib/x')"\`) that returns exit code 0 on success
- **complexity_score**: 1-10
- **estimated_turns**: Number of Claude turns expected
- **depends_on**: Title of any task this depends on (or "none")

### Risks
- Known unknowns and potential blockers
- Mitigation strategies

IMPORTANT RULES:
- NEVER include code implementations — plans only
- Keep tasks focused (each should need fewer than 10 Claude turns)
- Every task MUST have a verify_command
- Prefer the simplest approach that works
- Include a final verification/integration task`;

  const result = await claudeComplete({
    prompt,
    outcomeId,
    maxTurns: 3,
    disableNativeTools: true,
    description: 'Discovery plan writing',
  });

  const planContent = result.text || '# Plan\n\nNo plan generated.';
  const planFile = path.join(workspacePath, 'PLAN.md');
  fs.writeFileSync(planFile, planContent, 'utf-8');

  return planFile;
}

// ============================================================================
// Task Generation
// ============================================================================

async function generateTasksFromDescription(outcomeId: string, description: string): Promise<void> {
  const existingTasks = getTasksByOutcome(outcomeId);
  if (existingTasks.length > 0) {
    return; // Don't generate if tasks already exist
  }

  const prompt = `Generate a focused task list for this outcome:

${description}

Output a JSON array of tasks. Each task:
- title: Short, action-oriented (e.g. "Add X to Y")
- description: What to change, why, and how to verify success
- verify_command: Shell command returning exit code 0 on success (e.g. "npm run typecheck")
- complexity_score: 1-10
- estimated_turns: Expected Claude turns (1-20)
- priority: 10-100 (lower = higher priority)
- depends_on_index: null, or the index (0-based) of a task in this array that must complete first

Keep tasks focused. Maximum 10 tasks. Every task MUST have a verify_command.
Respond with ONLY a valid JSON array (no markdown fences, no explanation):
[{"title":"...","description":"...","verify_command":"...","complexity_score":3,"estimated_turns":5,"priority":50,"depends_on_index":null}]`;

  const result = await claudeComplete({
    prompt,
    outcomeId,
    maxTurns: 3,
    disableNativeTools: true,
    description: 'Discovery task generation from description',
  });

  console.log(`[Discovery] Task generation result: success=${result.success}, textLen=${result.text?.length ?? 0}, error=${result.error || 'none'}`);
  if (!result.text || result.error) {
    throw new Error(`Claude CLI error during task generation: ${result.error || 'empty response'}`);
  }

  await parseAndCreateTasks(outcomeId, result.text);
}

async function generateTasksFromPlan(outcomeId: string, planContent: string): Promise<void> {
  const existingTasks = getTasksByOutcome(outcomeId);
  if (existingTasks.length > 0) {
    return; // Don't overwrite existing tasks
  }

  const prompt = `Extract tasks from this implementation plan and output them as a JSON array.

PLAN:
${planContent}

For each task in the plan output:
- title: Short, action-oriented task name
- description: Full description with what to change, why, and acceptance criteria
- verify_command: Shell command returning exit code 0 on success
- complexity_score: 1-10
- estimated_turns: Expected Claude turns (1-20)
- priority: 10-100 (lower = higher priority, respect plan order)
- depends_on_index: null, or the 0-based index of a prerequisite task in this array

Respond with ONLY a valid JSON array (no markdown fences, no explanation).`;

  const result = await claudeComplete({
    prompt,
    outcomeId,
    maxTurns: 3,
    disableNativeTools: true,
    description: 'Discovery task generation from plan',
  });

  await parseAndCreateTasks(outcomeId, result.text);
}

async function parseAndCreateTasks(outcomeId: string, rawText: string): Promise<void> {
  let tasks: Array<{
    title: string;
    description?: string;
    verify_command?: string;
    complexity_score?: number;
    estimated_turns?: number;
    priority?: number;
    depends_on_index?: number | null;
  }>;

  try {
    // Try stripping markdown code fences first, then parse
    let text = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // If JSON parse fails, try extracting the first JSON array from the text
    try {
      tasks = JSON.parse(text);
    } catch {
      // Claude sometimes wraps JSON in extra text — try to find the array
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        tasks = JSON.parse(arrayMatch[0]);
      } else {
        throw new Error('No JSON array found in response');
      }
    }
  } catch (error) {
    console.error('[Discovery] Failed to parse task generation result:', error);
    console.error('[Discovery] Raw text was:', rawText.slice(0, 500));
    throw new Error(`Discovery task generation failed: could not parse Claude response as JSON. Raw text starts with: ${rawText.slice(0, 200)}`);
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.warn('[Discovery] Task generation returned empty or non-array result');
    throw new Error('Discovery task generation returned empty or non-array result');
  }

  const createdIds: string[] = [];

  for (const task of tasks) {
    try {
      const dependsOn: string[] = [];
      if (
        task.depends_on_index != null &&
        task.depends_on_index >= 0 &&
        task.depends_on_index < createdIds.length
      ) {
        dependsOn.push(createdIds[task.depends_on_index]);
      }

      const created = createTask({
        outcome_id: outcomeId,
        title: task.title || 'Untitled task',
        description: task.description,
        verify_command: task.verify_command,
        complexity_score: task.complexity_score,
        estimated_turns: task.estimated_turns,
        priority: task.priority ?? 50,
        depends_on: dependsOn.length > 0 ? dependsOn : undefined,
        skipGuards: true, // Discovery-generated tasks are pre-validated
      });
      createdIds.push(created.id);
    } catch (error) {
      console.error(`[Discovery] Failed to create task "${task.title}":`, error);
      // Continue creating remaining tasks
    }
  }

  console.log(`[Discovery] Created ${createdIds.length} tasks for outcome ${outcomeId}`);
}
