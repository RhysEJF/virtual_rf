/**
 * Dispatch API Route
 *
 * Main entry point for user requests. Classifies and routes to appropriate handler.
 * Uses Claude Code CLI (your existing subscription) - no API costs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatch, type DispatchResult } from '@/lib/agents/dispatcher';
import { executeQuick } from '@/lib/agents/quick-executor';
import { briefAndCreateProject } from '@/lib/agents/briefer';
import { startRalphWorker } from '@/lib/ralph/worker';
import { isClaudeAvailable } from '@/lib/claude/client';

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
        // Generate brief and create project
        const briefResult = await briefAndCreateProject(input);

        if (!briefResult.success || !briefResult.brief) {
          return NextResponse.json({
            type: 'deep',
            error: briefResult.error || 'Failed to create project brief',
          });
        }

        const brief = briefResult.brief;
        const prdList = brief.prd
          .map((item, i) => `${i + 1}. [ ] ${item.title}`)
          .join('\n');

        // Auto-start the Ralph worker
        let workerStatus = '';
        try {
          const workerResult = await startRalphWorker({
            projectId: briefResult.projectId!,
            projectName: brief.title,
            objective: brief.objective,
            prd: brief.prd,
          });

          if (workerResult.started) {
            workerStatus = `\n\n**Worker Started!** (ID: ${workerResult.workerId})\nRalph is now working through the PRD. Check the \`workspaces/${briefResult.projectId}\` folder for progress.`;
          } else {
            workerStatus = `\n\n**Worker failed to start:** ${workerResult.error}`;
          }
        } catch (err) {
          workerStatus = `\n\n**Worker failed to start:** ${err instanceof Error ? err.message : 'Unknown error'}`;
        }

        return NextResponse.json({
          type: 'deep',
          projectId: briefResult.projectId,
          response: `**Project Created: ${brief.title}**

**Objective:** ${brief.objective}

**Scope:**
${brief.scope.map(s => `- ${s}`).join('\n')}

**Deliverables:**
${brief.deliverables.map(d => `- ${d}`).join('\n')}

**PRD Checklist:**
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
