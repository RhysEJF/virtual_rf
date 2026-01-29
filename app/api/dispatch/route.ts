/**
 * Dispatch API Route
 *
 * Main entry point for user requests. Classifies and routes to appropriate handler.
 * Uses Claude Code CLI (your existing subscription) - no API costs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatch, type DispatchResult } from '@/lib/agents/dispatcher';
import { executeQuick } from '@/lib/agents/quick-executor';
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
        // TODO: Implement briefer and orchestrator
        return NextResponse.json({
          type: 'deep',
          response: `**Deep work request received:** "${classification.summary || input}"\n\nThis would normally create a project brief and spawn workers. Coming soon.\n\nFor now, try breaking this into smaller, specific tasks I can help with immediately.`,
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
