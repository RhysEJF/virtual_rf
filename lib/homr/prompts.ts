/**
 * HOMЯ Protocol Claude Prompts
 *
 * Prompt building functions for AI-powered observation and analysis.
 */

import type { Task, Intent, HomrDiscovery, HomrDecision, HomrConstraint, ParsedMemory } from '../db/schema';
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

// ============================================================================
// Memory Context Section
// ============================================================================

/**
 * Build a context section for cross-outcome memories to inject into CLAUDE.md
 */
export function buildMemoryContextSection(memories: ParsedMemory[]): string {
  if (memories.length === 0) {
    return '';
  }

  const parts: string[] = ['## Cross-Outcome Knowledge', ''];
  parts.push('_These memories were retrieved from previous work that may be relevant to this task._');
  parts.push('');

  // Group memories by type for better organization
  const byType: Record<string, ParsedMemory[]> = {};
  for (const memory of memories) {
    const type = memory.type;
    if (!byType[type]) {
      byType[type] = [];
    }
    byType[type].push(memory);
  }

  // Define display order and labels for memory types
  const typeOrder: Array<{ type: string; label: string; icon: string }> = [
    { type: 'lesson', label: 'Lessons Learned', icon: '💡' },
    { type: 'technique', label: 'Techniques', icon: '🔧' },
    { type: 'pattern', label: 'Patterns', icon: '🔄' },
    { type: 'constraint', label: 'Constraints', icon: '⚠️' },
    { type: 'decision', label: 'Past Decisions', icon: '✓' },
    { type: 'fact', label: 'Facts', icon: '📌' },
    { type: 'preference', label: 'Preferences', icon: '⭐' },
    { type: 'other', label: 'Other', icon: '📝' },
  ];

  for (const { type, label, icon } of typeOrder) {
    const typeMemories = byType[type];
    if (!typeMemories || typeMemories.length === 0) {
      continue;
    }

    parts.push(`### ${icon} ${label}`);
    parts.push('');

    for (const memory of typeMemories) {
      // Format based on importance
      const importanceMarker = memory.importance === 'critical' ? '**[CRITICAL]** ' :
                               memory.importance === 'high' ? '**[HIGH]** ' :
                               memory.importance === 'medium' ? '' : '';

      parts.push(`- ${importanceMarker}${memory.content}`);

      // Add tags if present
      if (memory.tags && memory.tags.length > 0) {
        const tagStr = memory.tags.map(t => `\`${t}\``).join(' ');
        parts.push(`  _Tags: ${tagStr}_`);
      }

      // Add source information if from another outcome
      if (memory.source_outcome_id) {
        parts.push(`  _Source: Outcome ${memory.source_outcome_id.substring(0, 8)}..._`);
      }

      parts.push('');
    }
  }

  parts.push('---');
  parts.push('');

  return parts.join('\n');
}

/**
 * Format a single memory for inline context injection
 */
export function formatMemoryForContext(memory: ParsedMemory): string {
  const importancePrefix = memory.importance === 'critical' ? '[CRITICAL] ' :
                           memory.importance === 'high' ? '[HIGH] ' : '';

  const tagSuffix = memory.tags && memory.tags.length > 0
    ? ` (tags: ${memory.tags.join(', ')})`
    : '';

  return `${importancePrefix}${memory.content}${tagSuffix}`;
}

// ============================================================================
// Memory Formatting for Context Injection
// ============================================================================

/**
 * Configuration options for memory formatting
 */
export interface MemoryFormatOptions {
  /** Maximum length for memory content before truncation (default: 500) */
  maxContentLength?: number;
  /** Whether to include source outcome information (default: true) */
  includeSource?: boolean;
  /** Whether to include creation dates (default: true) */
  includeDates?: boolean;
  /** Whether to include tags (default: true) */
  includeTags?: boolean;
  /** Whether to group memories by type (default: true) */
  groupByType?: boolean;
  /** Maximum number of memories to display (default: 10) */
  maxMemories?: number;
}

/**
 * Default format options
 */
const DEFAULT_FORMAT_OPTIONS: Required<MemoryFormatOptions> = {
  maxContentLength: 500,
  includeSource: true,
  includeDates: true,
  includeTags: true,
  groupByType: true,
  maxMemories: 10,
};

/**
 * Type labels and icons for display
 */
const MEMORY_TYPE_DISPLAY: Record<string, { label: string; icon: string }> = {
  fact: { label: 'Facts', icon: '📌' },
  pattern: { label: 'Patterns', icon: '🔄' },
  preference: { label: 'Preferences', icon: '⭐' },
  decision: { label: 'Past Decisions', icon: '✓' },
  lesson: { label: 'Lessons Learned', icon: '💡' },
  context: { label: 'Context', icon: '📝' },
};

/**
 * Importance markers for display
 */
const IMPORTANCE_MARKERS: Record<string, string> = {
  critical: '**[CRITICAL]** ',
  high: '**[HIGH]** ',
  medium: '',
  low: '',
};

/**
 * Format a date timestamp for display
 */
function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Unknown date';

  try {
    const date = new Date(timestamp);
    // Check for invalid date
    if (isNaN(date.getTime())) return 'Unknown date';

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown date';
  }
}

/**
 * Truncate content to maximum length with ellipsis
 */
function truncateContent(content: string, maxLength: number): string {
  if (!content) return '';
  if (content.length <= maxLength) return content;

  // Find a good break point (word boundary)
  const truncated = content.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  // If we found a space reasonably close to the end, break there
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Format a single memory entry with all metadata
 */
function formatSingleMemory(
  memory: ParsedMemory,
  options: Required<MemoryFormatOptions>
): string {
  const parts: string[] = [];

  // Build the main content line with importance marker
  const importanceMarker = IMPORTANCE_MARKERS[memory.importance] || '';
  const content = truncateContent(memory.content || '', options.maxContentLength);

  parts.push(`- ${importanceMarker}${content}`);

  // Add metadata lines
  const metadataLines: string[] = [];

  // Source outcome
  if (options.includeSource && memory.source_outcome_id) {
    const outcomeRef = `Outcome ${memory.source_outcome_id.substring(0, 12)}...`;
    metadataLines.push(`Source: ${outcomeRef}`);
  }

  // Creation date
  if (options.includeDates && memory.created_at) {
    metadataLines.push(`Date: ${formatDate(memory.created_at)}`);
  }

  // Tags
  if (options.includeTags && memory.tags && memory.tags.length > 0) {
    const tagStr = memory.tags.map(t => `\`${t}\``).join(' ');
    metadataLines.push(`Tags: ${tagStr}`);
  }

  // Confidence (only show if notably high or low)
  if (memory.confidence !== undefined && memory.confidence !== 1.0) {
    if (memory.confidence < 0.5) {
      metadataLines.push(`Confidence: Low (${Math.round(memory.confidence * 100)}%)`);
    } else if (memory.confidence >= 0.9) {
      metadataLines.push(`Confidence: High (${Math.round(memory.confidence * 100)}%)`);
    }
  }

  // Add metadata as indented lines
  if (metadataLines.length > 0) {
    parts.push(`  _${metadataLines.join(' | ')}_`);
  }

  return parts.join('\n');
}

/**
 * Format a collection of memories into markdown for CLAUDE.md context injection
 *
 * This function transforms memory records into a well-formatted markdown section
 * suitable for injection into worker context. It handles:
 * - Grouping memories by type
 * - Importance-based highlighting
 * - Source outcome attribution
 * - Date display
 * - Content truncation for long memories
 * - Edge cases (missing fields, empty array, etc.)
 *
 * @param memories Array of parsed memories to format
 * @param options Formatting options
 * @returns Formatted markdown string, or empty string if no memories
 *
 * @example
 * ```typescript
 * const memories = await getRelevantMemoriesForTask(taskId, outcomeId);
 * const markdown = formatMemoriesForContext(memories);
 * // Returns formatted markdown like:
 * // ## Cross-Outcome Knowledge
 * //
 * // ### 💡 Lessons Learned
 * // - **[HIGH]** Always validate input at API boundaries
 * //   _Source: Outcome out_abc123... | Date: Jan 15, 2026_
 * ```
 */
export function formatMemoriesForContext(
  memories: ParsedMemory[],
  options: MemoryFormatOptions = {}
): string {
  // Handle empty or invalid input
  if (!memories || !Array.isArray(memories) || memories.length === 0) {
    return '';
  }

  // Merge options with defaults
  const opts: Required<MemoryFormatOptions> = {
    ...DEFAULT_FORMAT_OPTIONS,
    ...options,
  };

  // Limit number of memories
  const limitedMemories = memories.slice(0, opts.maxMemories);

  const parts: string[] = [];

  // Header
  parts.push('## Cross-Outcome Knowledge');
  parts.push('');
  parts.push('_The following learnings from previous work may be relevant to this task._');
  parts.push('');

  if (opts.groupByType) {
    // Group memories by type
    const grouped = groupMemoriesByType(limitedMemories);

    // Define display order (most important types first)
    const typeOrder = ['lesson', 'pattern', 'decision', 'fact', 'preference', 'context'];

    for (const type of typeOrder) {
      const typeMemories = grouped[type];
      if (!typeMemories || typeMemories.length === 0) continue;

      const display = MEMORY_TYPE_DISPLAY[type] || { label: type, icon: '📝' };
      parts.push(`### ${display.icon} ${display.label}`);
      parts.push('');

      for (const memory of typeMemories) {
        parts.push(formatSingleMemory(memory, opts));
        parts.push('');
      }
    }

    // Handle any types not in the predefined order
    for (const [type, typeMemories] of Object.entries(grouped)) {
      if (typeOrder.includes(type)) continue;
      if (!typeMemories || typeMemories.length === 0) continue;

      const display = MEMORY_TYPE_DISPLAY[type] || { label: type, icon: '📝' };
      parts.push(`### ${display.icon} ${display.label}`);
      parts.push('');

      for (const memory of typeMemories) {
        parts.push(formatSingleMemory(memory, opts));
        parts.push('');
      }
    }
  } else {
    // Flat list without grouping
    for (const memory of limitedMemories) {
      const typeDisplay = MEMORY_TYPE_DISPLAY[memory.type] || { label: memory.type, icon: '📝' };
      parts.push(`**[${typeDisplay.label.toUpperCase()}]** ${formatSingleMemory(memory, opts)}`);
      parts.push('');
    }
  }

  // Add truncation notice if we limited the memories
  if (memories.length > opts.maxMemories) {
    parts.push(`_Note: ${memories.length - opts.maxMemories} additional memories were omitted for brevity._`);
    parts.push('');
  }

  parts.push('---');
  parts.push('');

  return parts.join('\n');
}

/**
 * Group memories by their type
 */
function groupMemoriesByType(memories: ParsedMemory[]): Record<string, ParsedMemory[]> {
  const grouped: Record<string, ParsedMemory[]> = {};

  for (const memory of memories) {
    const type = memory.type || 'context';
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(memory);
  }

  // Sort each group by importance (critical first) then by date (newest first)
  const importancePriority: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => {
      // First by importance
      const importanceA = importancePriority[a.importance] ?? 4;
      const importanceB = importancePriority[b.importance] ?? 4;
      if (importanceA !== importanceB) {
        return importanceA - importanceB;
      }
      // Then by date (newest first)
      return (b.created_at || 0) - (a.created_at || 0);
    });
  }

  return grouped;
}

/**
 * Format memories for a compact single-line context
 * Useful when you need a brief summary rather than full markdown
 *
 * @param memories Array of parsed memories
 * @param maxLength Maximum total length (default: 1000)
 * @returns Compact formatted string
 */
export function formatMemoriesCompact(
  memories: ParsedMemory[],
  maxLength: number = 1000
): string {
  if (!memories || memories.length === 0) {
    return '';
  }

  const items: string[] = [];
  let currentLength = 0;

  // Sort by importance
  const sorted = [...memories].sort((a, b) => {
    const importanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (importanceOrder[a.importance] ?? 4) - (importanceOrder[b.importance] ?? 4);
  });

  for (const memory of sorted) {
    const formatted = `[${memory.type}] ${truncateContent(memory.content, 100)}`;

    // Check if adding this would exceed max length
    if (currentLength + formatted.length + 3 > maxLength) { // +3 for " | " separator
      break;
    }

    items.push(formatted);
    currentLength += formatted.length + 3;
  }

  if (items.length === 0) {
    return '';
  }

  return `Relevant knowledge: ${items.join(' | ')}`;
}
