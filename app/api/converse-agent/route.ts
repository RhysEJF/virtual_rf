/**
 * Agentic Conversational API Route
 *
 * POST /api/converse-agent - Multi-turn chat endpoint using Claude as an agent with tools
 *
 * Unlike the original /api/converse which uses intent classification,
 * this endpoint gives Claude direct access to tools for reasoning and action.
 *
 * Request body:
 * - message: string - The user's message
 * - session_id?: string - Optional session ID for multi-turn context
 *
 * Response:
 * - type: 'action' | 'response' | 'error'
 * - message: string - Response message to display
 * - session_id: string - Session ID for follow-up messages
 * - tool_calls?: array - Tools that were invoked
 * - data?: object - Additional response data
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  runConverseAgent,
  type ConverseAgentRequest,
  type ConverseAgentResponse,
} from '@/lib/agents/converse-agent';
import {
  createSession,
  getSessionByIdParsed,
  createMessage,
  getRecentMessages,
  isSessionValid,
} from '@/lib/db/sessions';
import type { ParsedConversationSession } from '@/lib/db/schema';

// ============================================================================
// Types
// ============================================================================

interface ApiRequest {
  message: string;
  session_id?: string;
}

interface ApiResponse {
  type: 'action' | 'response' | 'error';
  message: string;
  session_id: string;
  tool_calls?: Array<{
    name: string;
    success: boolean;
  }>;
  data?: Record<string, unknown>;
}

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const body = (await request.json()) as ApiRequest;
    const { message, session_id } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({
        type: 'error',
        message: 'Message is required',
        session_id: session_id || '',
      }, { status: 400 });
    }

    // Get or create session
    let session: ParsedConversationSession;

    if (session_id && isSessionValid(session_id)) {
      const existing = getSessionByIdParsed(session_id);
      if (existing) {
        session = existing;
      } else {
        const newSession = createSession({});
        session = {
          ...newSession,
          context: JSON.parse(newSession.context) as Record<string, unknown>,
        };
      }
    } else {
      const newSession = createSession({});
      session = {
        ...newSession,
        context: JSON.parse(newSession.context) as Record<string, unknown>,
      };
    }

    // Store user message
    createMessage({
      sessionId: session.id,
      role: 'user',
      content: message,
    });

    // Run the agent
    const agentRequest: ConverseAgentRequest = {
      message: message.trim(),
      sessionId: session.id,
    };

    const agentResponse: ConverseAgentResponse = await runConverseAgent(agentRequest);

    // Store assistant response
    createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: agentResponse.message,
      metadata: {
        toolCalls: agentResponse.toolCalls,
      },
    });

    // Determine response type
    const hasToolCalls = agentResponse.toolCalls && agentResponse.toolCalls.length > 0;
    const responseType: ApiResponse['type'] = hasToolCalls ? 'action' : 'response';

    return NextResponse.json({
      type: responseType,
      message: agentResponse.message,
      session_id: session.id,
      tool_calls: agentResponse.toolCalls?.map(tc => ({
        name: tc.name,
        success: tc.success,
      })),
      data: agentResponse.data,
    });

  } catch (error) {
    console.error('[Converse Agent API] Error:', error);

    return NextResponse.json({
      type: 'error',
      message: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      session_id: '',
    }, { status: 500 });
  }
}

// ============================================================================
// GET - Session info
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  }

  const session = getSessionByIdParsed(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const messages = getRecentMessages(sessionId, 20);

  return NextResponse.json({
    session: {
      id: session.id,
      current_outcome_id: session.current_outcome_id,
      created_at: session.created_at,
      last_activity_at: session.last_activity_at,
    },
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
  });
}
