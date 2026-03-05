/**
 * Task Field Optimization API
 *
 * POST /api/tasks/[id]/optimize-field
 * Optimizes a single field (intent or approach) content
 * Uses Claude-powered semantic detection for skills and new capabilities
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, updateTask } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import { complete } from '@/lib/claude/client';
import { detectCapabilitiesWithClaude } from '@/lib/capabilities/detection';

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

    // Run Claude to optimize text
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

    const optimizedText = result.text.trim();

    // Use Claude to semantically detect capabilities from both original and optimized text
    const combinedText = `${optimizedText}\n\n---\nOriginal input:\n${content}`;
    const capabilityResult = await detectCapabilitiesWithClaude(
      combinedText,
      field,
      task.title,
      outcomeContext,
      task.outcome_id
    );

    // Update required_skills if existing skills were detected
    if (capabilityResult.existingSkills.length > 0) {
      let existingSkills: string[] = [];
      if (task.required_skills) {
        try {
          existingSkills = JSON.parse(task.required_skills);
        } catch {
          existingSkills = [];
        }
      }

      const allSkills = Array.from(new Set([...existingSkills, ...capabilityResult.existingSkills]));
      updateTask(id, {
        required_skills: JSON.stringify(allSkills),
      });
    }

    // Return the optimized text with capability detection results
    return NextResponse.json({
      success: true,
      optimized: optimizedText,
      detectedSkills: capabilityResult.existingSkills.length > 0
        ? capabilityResult.existingSkills
        : undefined,
      detectedCapabilities: capabilityResult.newCapabilities.length > 0
        ? capabilityResult.newCapabilities
        : undefined,
    });
  } catch (error) {
    console.error('Error optimizing task field:', error);
    return NextResponse.json(
      { error: 'Failed to optimize task field' },
      { status: 500 }
    );
  }
}
