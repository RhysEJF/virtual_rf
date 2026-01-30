/**
 * Task Field Optimization API
 *
 * POST /api/tasks/[id]/optimize-field
 * Optimizes a single field (intent or approach) content
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import { complete } from '@/lib/claude/client';

const OPTIMIZE_INTENT_PROMPT = `You are helping structure the "WHAT" (intent) for a task.

The user has written their thoughts about what this task should achieve. Polish and structure it into clear, actionable requirements. Keep it concise but complete.

TASK: {title}
CONTEXT: {outcomeContext}

USER'S INPUT:
{content}

---

Return ONLY the optimized text (no JSON, no explanation, just the polished content). Keep it under 200 words.`;

const OPTIMIZE_APPROACH_PROMPT = `You are helping structure the "HOW" (approach) for a task.

The user has written their thoughts about how this task should be done. Polish and structure it into clear methodology, tools, patterns, or constraints. Keep it concise but actionable.

TASK: {title}
CONTEXT: {outcomeContext}

USER'S INPUT:
{content}

---

Return ONLY the optimized text (no JSON, no explanation, just the polished content). Keep it under 200 words.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { field, content } = body;

    if (!field || !['intent', 'approach'].includes(field)) {
      return NextResponse.json(
        { error: 'Field must be "intent" or "approach"' },
        { status: 400 }
      );
    }

    if (!content?.trim()) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    // Get task
    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Get outcome for context
    const outcome = getOutcomeById(task.outcome_id);
    const outcomeContext = outcome
      ? `${outcome.name}: ${outcome.brief || 'No description'}`
      : 'No outcome context';

    // Build prompt based on field
    const promptTemplate = field === 'intent'
      ? OPTIMIZE_INTENT_PROMPT
      : OPTIMIZE_APPROACH_PROMPT;

    const prompt = promptTemplate
      .replace('{title}', task.title)
      .replace('{outcomeContext}', outcomeContext)
      .replace('{content}', content);

    // Run Claude
    const result = await complete({
      prompt,
      description: `Optimize task ${field} for: ${task.title}`,
    });

    if (!result.success || !result.text) {
      return NextResponse.json(
        { error: result.error || 'Failed to optimize' },
        { status: 500 }
      );
    }

    // Return the optimized text (Claude returns just the text, no JSON)
    return NextResponse.json({
      success: true,
      optimized: result.text.trim(),
    });
  } catch (error) {
    console.error('Error optimizing task field:', error);
    return NextResponse.json(
      { error: 'Failed to optimize task field' },
      { status: 500 }
    );
  }
}
