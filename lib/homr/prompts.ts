/**
 * HOMЯ Protocol Claude Prompts
 *
 * Prompt building functions for AI-powered observation and analysis.
 */

import type { Task, Intent, HomrDiscovery, HomrDecision, HomrConstraint } from '../db/schema';
import type { ParsedContextStore, HomrAmbiguitySignal } from './types';

// ============================================================================
// Observation Prompts
// ============================================================================

/**
 * Build the prompt for task observation analysis
 */
export function buildObservationPrompt(
  task: Task,
  fullOutput: string,
  intent: Intent | null,
  designDoc: string | null,
  contextStore: ParsedContextStore | null
): string {
  const intentSummary = intent?.summary || 'No specific intent defined.';
  const intentItems = intent?.items?.map(item =>
    `- ${item.title}: ${item.description} [${item.priority}]`
  ).join('\n') || 'No items defined.';

  const designSummary = designDoc ? extractDesignSummary(designDoc) : 'No design document.';

  const contextSummary = contextStore ? buildContextSummary(contextStore) : 'No prior context.';

  // Truncate output if too long to avoid token limits
  const maxOutputLength = 50000;
  const truncatedOutput = fullOutput.length > maxOutputLength
    ? fullOutput.substring(0, maxOutputLength) + '\n\n[Output truncated due to length...]'
    : fullOutput;

  return `# Task Observation Analysis

You are HOMЯ, an intelligent orchestration layer that observes completed task outputs and extracts learnings. Your job is to analyze this completed task against the outcome intent and design.

## Outcome Context

**Intent Summary:** ${intentSummary}

**PRD Items:**
${intentItems}

**Design Approach:**
${designSummary}

## Prior Context (from other tasks)
${contextSummary}

## Task Information

**Task ID:** ${task.id}
**Task Title:** ${task.title}
**Task Description:** ${task.description || 'No description'}
**PRD Context:** ${task.prd_context || 'None'}
**Design Context:** ${task.design_context || 'None'}

## Task Output

\`\`\`
${truncatedOutput}
\`\`\`

## Analysis Required

Analyze this task output and provide:

1. **Alignment Check** (0-100 score)
   - Does this work align with the intent?
   - Does it follow the design approach?
   - Any scope creep or wrong direction?

2. **Quality Assessment** (good | needs_work | off_rails)
   - Is the work well-executed?
   - Any obvious issues or shortcuts?

3. **Drift Detection**
   - Look for: scope_creep, wrong_direction, missed_requirement, contradicts_design
   - Include evidence (quote from output)

4. **Discovery Extraction**
   - What did this task learn that other tasks should know?
   - Types: constraint, dependency, pattern, decision, blocker
   - Which tasks would benefit? (use task IDs or '*' for all)

5. **Ambiguity Detection**
   - Does the output show uncertainty?
   - Are there unresolved decisions?
   - Would a human want to know about something before continuing?
   - Types: unclear_requirement, multiple_approaches, blocking_decision, contradicting_info

## Response Format

Respond with a JSON object (no markdown code block):

{
  "onTrack": boolean,
  "alignmentScore": number,
  "quality": "good" | "needs_work" | "off_rails",
  "drift": [
    {
      "type": "scope_creep" | "wrong_direction" | "missed_requirement" | "contradicts_design",
      "description": "what drifted",
      "severity": "low" | "medium" | "high",
      "evidence": "quote from output"
    }
  ],
  "discoveries": [
    {
      "type": "constraint" | "dependency" | "pattern" | "decision" | "blocker",
      "content": "what was discovered",
      "relevantTasks": ["task_ids"] or ["*"]
    }
  ],
  "issues": [
    {
      "type": "type of issue",
      "description": "description",
      "severity": "low" | "medium" | "high"
    }
  ],
  "ambiguity": {
    "detected": boolean,
    "type": "unclear_requirement" | "multiple_approaches" | "blocking_decision" | "contradicting_info",
    "description": "what is ambiguous",
    "evidence": ["quotes from output"],
    "suggestedQuestion": "question for human"
  } | null,
  "summary": "Brief 1-2 sentence summary of the observation"
}`;
}

/**
 * Build the prompt for generating escalation questions
 */
export function buildEscalationQuestionPrompt(
  ambiguity: HomrAmbiguitySignal,
  task: Task,
  intent: Intent | null
): string {
  const intentSummary = intent?.summary || 'No specific intent defined.';

  return `# Escalation Question Generation

You are HOMЯ, helping to formulate a clear question for a human when ambiguity is detected.

## Context

**Task:** ${task.title}
**Task Description:** ${task.description || 'No description'}

**Outcome Intent:** ${intentSummary}

## Detected Ambiguity

**Type:** ${ambiguity.type}
**Description:** ${ambiguity.description}

**Evidence from task output:**
${ambiguity.evidence.map(e => `- "${e}"`).join('\n')}

## Requirements

Generate a clear, actionable question with 2-4 concrete options. Each option should:
- Have a short, clear label
- Include a description of what it means
- Explain the implications of choosing it

The question should be specific enough that the answer directly resolves the ambiguity.

## Response Format

Respond with a JSON object (no markdown code block):

{
  "questionText": "The main question to ask",
  "questionContext": "Brief context about why this needs to be decided",
  "options": [
    {
      "id": "option_a",
      "label": "Short Label",
      "description": "What this option means",
      "implications": "What happens if this is chosen"
    }
  ]
}`;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract a summary from the design document
 */
function extractDesignSummary(designDoc: string): string {
  try {
    const parsed = JSON.parse(designDoc);
    if (parsed.summary) {
      return parsed.summary;
    }
    if (parsed.architecture) {
      return `Architecture: ${parsed.architecture}`;
    }
    // Return first 500 chars
    return designDoc.substring(0, 500) + (designDoc.length > 500 ? '...' : '');
  } catch {
    // If not JSON, return truncated text
    return designDoc.substring(0, 500) + (designDoc.length > 500 ? '...' : '');
  }
}

/**
 * Build a summary of the context store for the prompt
 */
function buildContextSummary(context: ParsedContextStore): string {
  const parts: string[] = [];

  if (context.discoveries.length > 0) {
    const recentDiscoveries = context.discoveries.slice(-5);
    parts.push('**Recent Discoveries:**');
    for (const d of recentDiscoveries) {
      parts.push(`- [${d.type}] ${d.content} (from: ${d.source})`);
    }
  }

  if (context.decisions.length > 0) {
    const recentDecisions = context.decisions.slice(-3);
    parts.push('\n**Recent Decisions:**');
    for (const d of recentDecisions) {
      parts.push(`- ${d.content} (by: ${d.madeBy})`);
    }
  }

  if (context.constraints.length > 0) {
    const activeConstraints = context.constraints.filter(c => c.active);
    if (activeConstraints.length > 0) {
      parts.push('\n**Active Constraints:**');
      for (const c of activeConstraints) {
        parts.push(`- [${c.type}] ${c.content}`);
      }
    }
  }

  if (parts.length === 0) {
    return 'No prior context from other tasks.';
  }

  return parts.join('\n');
}

/**
 * Build context section for a task's CLAUDE.md
 */
export function buildTaskContextSection(
  discoveries: HomrDiscovery[],
  decisions: HomrDecision[],
  constraints: HomrConstraint[]
): string {
  if (discoveries.length === 0 && decisions.length === 0 && constraints.length === 0) {
    return '';
  }

  const parts: string[] = ['## HOMЯ Context (Cross-Task Learnings)', ''];

  // Sort discoveries by priority (blockers first)
  const sortedDiscoveries = [...discoveries].sort((a, b) => {
    const priority: Record<string, number> = {
      blocker: 0,
      constraint: 1,
      dependency: 2,
      decision: 3,
      pattern: 4,
    };
    return (priority[a.type] || 5) - (priority[b.type] || 5);
  });

  if (sortedDiscoveries.length > 0) {
    parts.push('### Discoveries from Prior Tasks', '');
    for (const d of sortedDiscoveries) {
      const icon = d.type === 'blocker' ? '!!!' : d.type === 'constraint' ? '!!' : '!';
      parts.push(`**[${d.type.toUpperCase()}]** ${d.content}`);
      parts.push(`_Discovered by: ${d.source}_`);
      parts.push('');
    }
  }

  if (decisions.length > 0) {
    parts.push('### Decisions Made', '');
    for (const d of decisions) {
      parts.push(`- **${d.content}**`);
      if (d.context) {
        parts.push(`  _Context: ${d.context}_`);
      }
    }
    parts.push('');
  }

  const activeConstraints = constraints.filter(c => c.active);
  if (activeConstraints.length > 0) {
    parts.push('### Active Constraints', '');
    for (const c of activeConstraints) {
      parts.push(`- [${c.type}] ${c.content}`);
    }
    parts.push('');
  }

  parts.push('---', '');

  return parts.join('\n');
}

/**
 * Parse Claude's observation response JSON
 */
export function parseObservationResponse(response: string): {
  onTrack: boolean;
  alignmentScore: number;
  quality: 'good' | 'needs_work' | 'off_rails';
  drift: Array<{
    type: 'scope_creep' | 'wrong_direction' | 'missed_requirement' | 'contradicts_design';
    description: string;
    severity: 'low' | 'medium' | 'high';
    evidence: string;
  }>;
  discoveries: Array<{
    type: 'constraint' | 'dependency' | 'pattern' | 'decision' | 'blocker';
    content: string;
    relevantTasks: string[];
  }>;
  issues: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  ambiguity: {
    detected: boolean;
    type?: 'unclear_requirement' | 'multiple_approaches' | 'blocking_decision' | 'contradicting_info';
    description?: string;
    evidence?: string[];
    suggestedQuestion?: string;
  } | null;
  summary: string;
} | null {
  try {
    // Try to extract JSON from the response
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }

    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (typeof parsed.onTrack !== 'boolean' ||
        typeof parsed.alignmentScore !== 'number' ||
        !['good', 'needs_work', 'off_rails'].includes(parsed.quality) ||
        typeof parsed.summary !== 'string') {
      console.error('[HOMЯ] Invalid observation response - missing required fields');
      return null;
    }

    return {
      onTrack: parsed.onTrack,
      alignmentScore: Math.max(0, Math.min(100, parsed.alignmentScore)),
      quality: parsed.quality,
      drift: Array.isArray(parsed.drift) ? parsed.drift : [],
      discoveries: Array.isArray(parsed.discoveries) ? parsed.discoveries : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      ambiguity: parsed.ambiguity?.detected ? parsed.ambiguity : null,
      summary: parsed.summary,
    };
  } catch (err) {
    console.error('[HOMЯ] Failed to parse observation response:', err);
    return null;
  }
}

/**
 * Parse Claude's escalation question response JSON
 */
export function parseEscalationQuestionResponse(response: string): {
  questionText: string;
  questionContext: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    implications: string;
  }>;
} | null {
  try {
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }

    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (typeof parsed.questionText !== 'string' ||
        typeof parsed.questionContext !== 'string' ||
        !Array.isArray(parsed.options) ||
        parsed.options.length < 2) {
      console.error('[HOMЯ] Invalid escalation question response');
      return null;
    }

    return {
      questionText: parsed.questionText,
      questionContext: parsed.questionContext,
      options: parsed.options.map((opt: Record<string, unknown>, index: number) => ({
        id: String(opt.id || `option_${index}`),
        label: String(opt.label || `Option ${index + 1}`),
        description: String(opt.description || ''),
        implications: String(opt.implications || ''),
      })),
    };
  } catch (err) {
    console.error('[HOMЯ] Failed to parse escalation question response:', err);
    return null;
  }
}
