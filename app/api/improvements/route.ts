/**
 * Improvements API Route
 *
 * GET /api/improvements - Get suggestions and analysis summary
 * POST /api/improvements - Run analysis or control engine
 * PATCH /api/improvements - Update suggestion status
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  runAnalysis,
  getAnalysisSummary,
  getSelfImprovementStatus,
  startSelfImprovement,
  stopSelfImprovement,
} from '@/lib/agents/self-improvement';
import {
  getPendingSuggestions,
  getSuggestion,
  updateSuggestionStatus,
} from '@/lib/db/logs';
import type { SuggestionStatus } from '@/lib/db/schema';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const includeAnalysis = searchParams.get('analysis') === 'true';

    const suggestions = getPendingSuggestions();
    const status = getSelfImprovementStatus();

    const response: Record<string, unknown> = {
      suggestions,
      engine: status,
    };

    if (includeAnalysis) {
      response.analysis = getAnalysisSummary();
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching improvements:', error);
    return NextResponse.json(
      { error: 'Failed to fetch improvements' },
      { status: 500 }
    );
  }
}

interface PostRequest {
  action: 'analyze' | 'start' | 'stop';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as PostRequest;

    switch (body.action) {
      case 'analyze':
        const newSuggestions = runAnalysis();
        return NextResponse.json({
          success: true,
          message: `Analysis complete. ${newSuggestions.length} new suggestions generated.`,
          suggestions: newSuggestions,
        });

      case 'start':
        const startResult = startSelfImprovement();
        return NextResponse.json(startResult);

      case 'stop':
        const stopResult = stopSelfImprovement();
        return NextResponse.json(stopResult);

      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be: analyze, start, or stop' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error in improvements POST:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

interface PatchRequest {
  suggestion_id: number;
  status: SuggestionStatus;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as PatchRequest;

    if (!body.suggestion_id || !body.status) {
      return NextResponse.json(
        { error: 'suggestion_id and status are required' },
        { status: 400 }
      );
    }

    const validStatuses: SuggestionStatus[] = ['pending', 'accepted', 'dismissed'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Verify suggestion exists
    const existing = getSuggestion(body.suggestion_id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Suggestion not found' },
        { status: 404 }
      );
    }

    const suggestion = updateSuggestionStatus(body.suggestion_id, body.status);

    return NextResponse.json({ success: true, suggestion });
  } catch (error) {
    console.error('Error updating suggestion:', error);
    return NextResponse.json(
      { error: 'Failed to update suggestion' },
      { status: 500 }
    );
  }
}
