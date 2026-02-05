/**
 * Capability Detection API
 *
 * POST /api/capabilities/detect - Detect capabilities in text
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectCapabilities } from '@/lib/capabilities';

interface DetectRequest {
  text: string;
  outcome_id?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as DetectRequest;
    const { text, outcome_id } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'text is required and must be a string' },
        { status: 400 }
      );
    }

    const result = detectCapabilities(text, outcome_id);

    return NextResponse.json({
      success: true,
      suggested: result.suggested,
      existing: result.existing,
      skillReferences: result.skillReferences,
      summary: {
        suggestedCount: result.suggested.length,
        existingCount: result.existing.length,
        referencesCount: result.skillReferences.length,
      },
    });
  } catch (error) {
    console.error('[API] Capability detection error:', error);
    return NextResponse.json(
      { error: 'Failed to detect capabilities' },
      { status: 500 }
    );
  }
}
