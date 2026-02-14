/**
 * Task Context Optimization API
 *
 * POST /api/tasks/[id]/optimize-context
 * Takes a ramble and optimizes it into structured task_intent and task_approach
 * Also detects and sets required_capabilities for skill/tool dependencies
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, updateTask } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import { complete } from '@/lib/claude/client';
import { detectCapabilities } from '@/lib/capabilities/detection';

const OPTIMIZE_PROMPT = `You are helping structure context for a task. The user has rambled their thoughts about how this task should be done.

Parse their ramble into two distinct sections:

1. **WHAT (Task Intent)**: What should this task achieve? What are the specific requirements, acceptance criteria, or deliverables? Focus on WHAT, not HOW.

2. **HOW (Task Approach)**: How should this task be executed? What methodology, tools, libraries, patterns, or constraints should be followed? Focus on HOW, not WHAT.

Some rambles might only contain "what" or only "how" - that's fine. Extract what's there.

TASK TITLE: {title}
TASK DESCRIPTION: {description}
OUTCOME CONTEXT: {outcomeContext}

USER'S RAMBLE:
{ramble}

---

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "task_intent": "Structured what - or null if the ramble doesn't contain what info",
  "task_approach": "Structured how - or null if the ramble doesn't contain how info"
}`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { ramble } = body;

    if (!ramble?.trim()) {
      return NextResponse.json(
        { error: 'Ramble text is required' },
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

    // Build prompt
    const prompt = OPTIMIZE_PROMPT
      .replace('{title}', task.title)
      .replace('{description}', task.description || 'No description')
      .replace('{outcomeContext}', outcomeContext)
      .replace('{ramble}', ramble);

    // Run Claude
    const result = await complete({
      prompt,
      description: `Optimize task context for: ${task.title}`,
    });

    if (!result.success || !result.text) {
      return NextResponse.json(
        { error: result.error || 'Failed to process ramble' },
        { status: 500 }
      );
    }

    // Parse response
    let parsed: { task_intent: string | null; task_approach: string | null };
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', result.text);
      return NextResponse.json(
        { error: 'Failed to parse optimization result' },
        { status: 500 }
      );
    }

    // Update task with new context (merge with existing)
    const updates: { task_intent?: string; task_approach?: string; required_capabilities?: string[] } = {};

    if (parsed.task_intent) {
      // Merge with existing intent if present
      const existingIntent = task.task_intent;
      updates.task_intent = existingIntent
        ? `${existingIntent}\n\n${parsed.task_intent}`
        : parsed.task_intent;
    }

    if (parsed.task_approach) {
      // Merge with existing approach if present
      const existingApproach = task.task_approach;
      updates.task_approach = existingApproach
        ? `${existingApproach}\n\n${parsed.task_approach}`
        : parsed.task_approach;
    }

    // Detect capabilities mentioned in the ramble and parsed approach
    const textToAnalyze = `${ramble}\n\n${parsed.task_approach || ''}`;
    const detectedCaps = detectCapabilities(textToAnalyze, task.outcome_id);

    // Build required_capabilities array from detected skills/tools
    const requiredCaps: string[] = [];

    // Add detected skills/tools that need to be built
    for (const cap of detectedCaps.suggested) {
      requiredCaps.push(`${cap.type}:${cap.name.toLowerCase().replace(/\s+/g, '-')}`);
    }

    // Also add any existing capability references (skills that exist but should be available)
    for (const ref of detectedCaps.skillReferences) {
      const capName = `skill:${ref.toLowerCase().replace(/\s+/g, '-')}`;
      if (!requiredCaps.includes(capName)) {
        requiredCaps.push(capName);
      }
    }

    // Merge with existing required_capabilities
    if (requiredCaps.length > 0) {
      let existingCaps: string[] = [];
      if (task.required_capabilities) {
        try {
          existingCaps = JSON.parse(task.required_capabilities);
        } catch {
          existingCaps = [];
        }
      }
      const mergedCaps = Array.from(new Set([...existingCaps, ...requiredCaps]));
      updates.required_capabilities = mergedCaps;
    }

    if (Object.keys(updates).length > 0) {
      updateTask(id, updates);
    }

    // Get updated task
    const updatedTask = getTaskById(id);

    return NextResponse.json({
      success: true,
      task: updatedTask,
      parsed: {
        task_intent: parsed.task_intent,
        task_approach: parsed.task_approach,
      },
      capabilities: {
        detected: detectedCaps.suggested.map(c => `${c.type}:${c.name}`),
        references: detectedCaps.skillReferences,
        setOnTask: updates.required_capabilities || [],
      },
    });
  } catch (error) {
    console.error('Error optimizing task context:', error);
    return NextResponse.json(
      { error: 'Failed to optimize task context' },
      { status: 500 }
    );
  }
}
