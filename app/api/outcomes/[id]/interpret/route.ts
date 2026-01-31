/**
 * Interpret API - Parse user input and suggest actions for an outcome
 *
 * POST /api/outcomes/[id]/interpret
 * Body: { input: string, previousPlan?: ActionPlan, originalInput?: string }
 *
 * Returns: { success: true, plan: ActionPlan }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, getDesignDoc } from '@/lib/db/outcomes';
import { getTasksByOutcome } from '@/lib/db/tasks';
import { getWorkersByOutcome } from '@/lib/db/workers';
import { getWorkspacePath } from '@/lib/workspace/detector';
import type { Task, Worker } from '@/lib/db/schema';
import fs from 'fs';
import path from 'path';
import { claudeComplete } from '@/lib/claude/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface SuggestedAction {
  id: string;
  type: 'update_intent' | 'update_approach' | 'create_tasks' | 'start_worker' | 'pause_workers' | 'run_review';
  description: string;
  details: string;
  data?: Record<string, unknown>;
  enabled: boolean;
}

interface ActionPlan {
  summary: string;
  reasoning: string;
  actions: SuggestedAction[];
  warnings?: string[];
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await context.params;
    const { input, previousPlan, originalInput } = await request.json();

    if (!input?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Input is required' },
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

    // Get related data for context
    const tasks = getTasksByOutcome(outcomeId);
    const workers = getWorkersByOutcome(outcomeId);
    const designDoc = getDesignDoc(outcomeId);

    // Parse intent
    let intentSummary = outcome.brief || '';
    let intentItems: { title: string; status: string }[] = [];
    let successCriteria: string[] = [];
    if (outcome.intent) {
      try {
        const parsed = JSON.parse(outcome.intent);
        intentSummary = parsed.summary || intentSummary;
        intentItems = parsed.items || [];
        successCriteria = parsed.success_criteria || [];
      } catch {
        // Use brief
      }
    }

    // Parse approach
    let approach = '';
    if (designDoc) {
      approach = designDoc.approach || '';
    }

    // Build context for Claude
    const taskSummary = tasks.length > 0
      ? tasks.map(t => `- [${t.status}] ${t.title}`).join('\n')
      : 'No tasks yet';

    const workerSummary = workers.length > 0
      ? workers.map(w => `- ${w.name}: ${w.status}`).join('\n')
      : 'No workers yet';

    // Check for existing skills in this outcome's workspace
    const workspacePath = getWorkspacePath(outcomeId);
    const skillsPath = path.join(workspacePath, 'skills');
    let existingSkills: string[] = [];
    try {
      if (fs.existsSync(skillsPath)) {
        existingSkills = fs.readdirSync(skillsPath)
          .filter(f => f.endsWith('.md'))
          .map(f => f.replace('.md', ''));
      }
    } catch {
      // No skills yet
    }

    const skillsSummary = existingSkills.length > 0
      ? `Existing skills: ${existingSkills.join(', ')}`
      : 'No skills built yet for this outcome';

    // Build refinement context - this is CRITICAL for conversational flow
    let conversationContext = '';
    if (previousPlan && originalInput) {
      conversationContext = `
---
CONVERSATION CONTEXT (This is a REFINEMENT - ADD to the previous plan, don't replace it):

Original request: "${originalInput}"

Previous plan you suggested:
${JSON.stringify(previousPlan, null, 2)}

User's refinement/addition: "${input}"

IMPORTANT: The user is BUILDING ON the previous plan. You should:
1. KEEP all the actions from the previous plan
2. ADD new actions based on their refinement
3. MODIFY existing actions if they explicitly asked for changes
4. DO NOT remove actions unless specifically asked

Think of this as a conversation where you're collaboratively building a plan together.
---`;
    }

    const prompt = `You are helping manage an AI project/outcome. The user has made a request that may modify the outcome.

OUTCOME: ${outcome.name}
STATUS: ${outcome.status}
CAPABILITY STATUS: ${outcome.capability_ready === 2 ? 'Ready (skills built)' : outcome.capability_ready === 1 ? 'Building (skills in progress)' : 'Not started (no skills yet)'}

SKILLS FOR THIS OUTCOME:
${skillsSummary}

CURRENT INTENT (What):
${intentSummary}
Items: ${intentItems.length > 0 ? intentItems.map(i => `- [${i.status}] ${i.title}`).join('\n') : 'None'}
Success Criteria: ${successCriteria.length > 0 ? successCriteria.map(c => `- ${c}`).join('\n') : 'None'}

CURRENT APPROACH (How):
${approach || 'Not defined yet'}

TASKS:
${taskSummary}

WORKERS:
${workerSummary}
${conversationContext}

USER REQUEST:
"${input}"

SYSTEM ARCHITECTURE - Skills-First Pattern:
This system uses a TWO-PHASE approach:
1. CAPABILITY PHASE: Build skills (reusable knowledge/instructions) before executing work
2. EXECUTION PHASE: Workers use the skills to complete tasks

If the user asks about skills or if the work would benefit from building skills first:
- Suggest "build_capabilities" action to create skills before execution
- Skills are markdown files that teach the AI how to do specific tasks for this project

Analyze this request and suggest appropriate actions. Consider:
1. Does the user want to change the intent/scope?
2. Does the user want to change the approach/implementation?
3. Should new tasks be created?
4. Would skills help? Should we build infrastructure first?
5. Should workers be started, paused, or is a review needed?

IMPORTANT: Be conservative. If the request is ambiguous, ask for clarification in the summary rather than making assumptions.

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "summary": "Brief description of what you understand the user wants",
  "reasoning": "Why you're suggesting these specific actions",
  "actions": [
    {
      "id": "unique_id",
      "type": "action_type",
      "description": "Short human-readable description",
      "details": "More specific details about what will change",
      "data": { "any": "relevant data for execution" },
      "enabled": true
    }
  ],
  "warnings": ["Any concerns or risks the user should know about"]
}

Action types:
- update_intent: Modify the PRD/intent. Include "new_summary" and/or "new_items" and/or "new_success_criteria" in data
- update_approach: Modify the design doc. Include "new_approach" in data
- create_tasks: Add new tasks. Include "tasks" array in data with {title, description, priority}
- build_infrastructure: Build skills/tools first. Include "skill_names" array with suggested skills to build
- start_worker: Start a worker to execute tasks (will build infrastructure first if needed)
- pause_workers: Pause all running workers
- run_review: Trigger a review cycle

Keep actions focused. If this is a refinement, MERGE with the previous plan.`;

    const result = await claudeComplete({ prompt, timeout: 60000 });

    // Parse the response
    let plan: ActionPlan;
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }

      // Validate and ensure required fields
      if (!plan.summary) plan.summary = 'I understood your request but need clarification.';
      if (!plan.reasoning) plan.reasoning = '';
      if (!plan.actions) plan.actions = [];
      if (!plan.warnings) plan.warnings = [];

      // Ensure all actions have required fields
      plan.actions = plan.actions.map((action, i) => ({
        id: action.id || `action_${i}`,
        type: action.type,
        description: action.description || 'Action',
        details: action.details || '',
        data: action.data || {},
        enabled: action.enabled !== false,
      }));

    } catch (parseError) {
      console.error('[Interpret] Failed to parse Claude response:', parseError);
      console.error('[Interpret] Raw response:', result.text);

      // Return a clarification plan
      plan = {
        summary: 'I had trouble understanding your request. Could you be more specific?',
        reasoning: 'The request was ambiguous or I encountered an error processing it.',
        actions: [],
        warnings: ['Please try rephrasing your request with more detail.'],
      };
    }

    return NextResponse.json({
      success: true,
      plan,
    });

  } catch (error) {
    console.error('[Interpret API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to interpret request' },
      { status: 500 }
    );
  }
}
