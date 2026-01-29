/**
 * Dispatch API Route
 *
 * Main entry point for user requests. Classifies and routes to appropriate handler.
 * Uses Claude Code CLI (your existing subscription) - no API costs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatch, type DispatchResult } from '@/lib/agents/dispatcher';
import { executeQuick } from '@/lib/agents/quick-executor';
import { generateBrief } from '@/lib/agents/briefer';
import { startRalphWorker } from '@/lib/ralph/worker';
import { isClaudeAvailable } from '@/lib/claude/client';
import { createTask } from '@/lib/db/tasks';
import { createOutcome } from '@/lib/db/outcomes';
import { logOutcomeCreated, logWorkerStarted } from '@/lib/db/activity';

interface DispatchRequest {
  input: string;
  projectContext?: string; // For interventions on existing projects
}

interface DispatchResponse {
  type: DispatchResult['type'];
  response?: string;
  questions?: string[];
  projectId?: string;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<DispatchResponse>> {
  try {
    const body = (await request.json()) as DispatchRequest;
    const { input } = body;

    if (!input || typeof input !== 'string') {
      return NextResponse.json(
        { type: 'clarification', error: 'Input is required' },
        { status: 400 }
      );
    }

    // Check if Claude CLI is available
    const available = await isClaudeAvailable();
    if (!available) {
      return NextResponse.json(
        {
          type: 'clarification',
          error: 'Claude Code CLI not found. Make sure `claude` is installed and in your PATH.',
        },
        { status: 500 }
      );
    }

    // Classify the request
    const classification = await dispatch(input);

    // Handle based on type
    switch (classification.type) {
      case 'quick': {
        const result = await executeQuick(input);

        if (!result.success) {
          return NextResponse.json({
            type: 'quick',
            error: result.error || 'Quick execution failed',
          });
        }

        return NextResponse.json({
          type: 'quick',
          response: result.response,
        });
      }

      case 'research': {
        // TODO: Implement research agent
        return NextResponse.json({
          type: 'research',
          response: `**Research request received:** "${classification.summary || input}"\n\nResearch agent coming soon. For now, I'll treat this as a quick task and do my best to help.`,
        });
      }

      case 'deep': {
        // Generate brief using Claude
        const brief = await generateBrief(input);

        if (!brief) {
          return NextResponse.json({
            type: 'deep',
            error: 'Failed to create project brief',
          });
        }

        // Create an Outcome (not a legacy Project)
        const outcome = createOutcome({
          name: brief.title,
          brief: input,
          intent: JSON.stringify({
            summary: brief.objective,
            items: brief.prd.map(item => ({
              id: item.id,
              title: item.title,
              description: item.description,
              acceptance_criteria: [],
              priority: item.priority <= 3 ? 'high' : item.priority <= 6 ? 'medium' : 'low',
              status: 'pending',
            })),
            success_criteria: brief.deliverables,
          }),
        });

        const outcomeId = outcome.id;

        // Log activity
        logOutcomeCreated(outcomeId, brief.title);

        const prdList = brief.prd
          .map((item, i) => `${i + 1}. [ ] ${item.title}`)
          .join('\n');

        // Create tasks from PRD items for the worker to claim
        for (const item of brief.prd) {
          createTask({
            outcome_id: outcomeId,
            title: item.title,
            description: item.description,
            prd_context: JSON.stringify(item),
            priority: item.priority * 10, // Convert 1-10 scale to 10-100 range
          });
        }

        // Auto-start the Ralph worker
        let workerStatus = '';
        try {
          const workerResult = await startRalphWorker({
            outcomeId: outcomeId,
          });

          if (workerResult.started) {
            logWorkerStarted(outcomeId, brief.title, `Ralph Worker ${workerResult.workerId?.slice(-12)}`, workerResult.workerId || '');
            workerStatus = `\n\n**Worker Started!** (ID: ${workerResult.workerId})\nRalph is now working through the tasks. Check the \`workspaces/${outcomeId}\` folder for progress.`;
          } else {
            workerStatus = `\n\n**Worker failed to start:** ${workerResult.error}`;
          }
        } catch (err) {
          workerStatus = `\n\n**Worker failed to start:** ${err instanceof Error ? err.message : 'Unknown error'}`;
        }

        return NextResponse.json({
          type: 'deep',
          projectId: outcomeId,
          response: `**Outcome Created: ${brief.title}**

**Objective:** ${brief.objective}

**Scope:**
${brief.scope.map(s => `- ${s}`).join('\n')}

**Deliverables:**
${brief.deliverables.map(d => `- ${d}`).join('\n')}

**Tasks:**
${prdList}

**Estimated time:** ~${brief.estimatedMinutes} minutes
${workerStatus}`,
        });
      }

      case 'clarification': {
        const questions = classification.clarifyingQuestions || [
          'Could you please provide more details about what you need?',
        ];

        return NextResponse.json({
          type: 'clarification',
          response: `I need a bit more information:\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
          questions,
        });
      }

      default: {
        return NextResponse.json({
          type: 'clarification',
          response: "I'm not sure how to handle that request. Could you try rephrasing it?",
        });
      }
    }
  } catch (error) {
    console.error('Dispatch error:', error);

    return NextResponse.json(
      {
        type: 'clarification',
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
