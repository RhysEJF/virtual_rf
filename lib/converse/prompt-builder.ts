/**
 * Prompt Builder
 *
 * Builds context-aware system prompts for the conversational agent.
 * Uses the skill file as the single source of truth for role, tools, and guidelines.
 *
 * Two-pass architecture:
 * - Pass 1: buildAgentSystemPrompt() - includes role, tools, and context for tool calling
 * - Pass 2: buildFormattingPrompt() - includes formatting guidelines for response generation
 */

import {
  type EnrichedContext,
  type ReferencedEntitiesMap,
} from '../db/sessions';
import { getOutcomeById } from '../db/outcomes';
import { getPendingEscalations } from '../db/homr';
import { loadConverseSkill } from './skill-loader';
import type { ToolResult } from './tool-executor';

// ============================================================================
// Types
// ============================================================================

export interface ToolResultSummary {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================================================
// Pass 1: Tool Execution Prompt
// ============================================================================

/**
 * Build the system prompt for Pass 1 (tool execution).
 * Includes role, tool definitions, and current context.
 */
export function buildAgentSystemPrompt(
  sessionId: string,
  enrichedContext?: EnrichedContext | null
): string {
  const skill = loadConverseSkill();
  const parts: string[] = [];

  // Role section from skill file
  parts.push('# Flow Conversational Agent\n\n' + skill.role);

  // Current context
  if (enrichedContext) {
    parts.push(buildContextSection(enrichedContext));
  }

  // Recent messages for continuity
  if (enrichedContext?.recentMessages && enrichedContext.recentMessages.length > 0) {
    parts.push(buildRecentMessagesSection(enrichedContext.recentMessages));
  }

  // Tools section from skill file
  parts.push(skill.toolSection);

  return parts.join('\n\n');
}

// ============================================================================
// Pass 2: Formatting Prompt
// ============================================================================

/**
 * Build the prompt for Pass 2 (response formatting).
 * Includes the user's question, tool results, and formatting guidelines.
 */
export function buildFormattingPrompt(
  userMessage: string,
  toolResults: ToolResultSummary[],
  context: EnrichedContext | null
): string {
  const skill = loadConverseSkill();

  const parts: string[] = [];

  // Instructions
  parts.push(`# Format Response

You are formatting a response for the Flow CLI. The user asked a question and tools were called to get data. Now format a helpful response.

## User's Question
${userMessage}`);

  // Context summary (brief)
  if (context?.currentOutcomeId) {
    const outcome = getOutcomeById(context.currentOutcomeId);
    if (outcome) {
      parts.push(`## Current Context
- Current outcome: ${outcome.name} (${context.currentOutcomeId})`);
    }
  }

  // Tool results
  parts.push(`## Tool Results
\`\`\`json
${JSON.stringify(toolResults, null, 2)}
\`\`\``);

  // Formatting guidelines from skill file
  parts.push(skill.formatGuidelines);

  // Final instruction
  parts.push(`## Your Task
Format the tool results into a helpful response following the guidelines above. Be concise and use markdown formatting. Don't include any TOOL_CALL statements - just provide the formatted response.`);

  return parts.join('\n\n');
}

// ============================================================================
// Context Building Helpers
// ============================================================================

/**
 * Build the context section showing current state
 */
function buildContextSection(context: EnrichedContext): string {
  const lines: string[] = ['## Current Context'];

  // Current outcome
  if (context.currentOutcomeId) {
    const outcome = getOutcomeById(context.currentOutcomeId);
    if (outcome) {
      lines.push(`**Current Outcome:** ${outcome.name} (${context.currentOutcomeId})`);
      lines.push(`- Status: ${outcome.status}`);

      // Check for escalations
      const escalations = getPendingEscalations(outcome.id);
      if (escalations.length > 0) {
        lines.push(`- **${escalations.length} pending escalation(s)** need attention`);
      }
    }
  } else {
    lines.push('**Current Outcome:** None (global context)');
  }

  // Referenced entities for pronoun resolution
  if (context.referencedEntities) {
    const refs = buildReferencedEntitiesText(context.referencedEntities);
    if (refs) {
      lines.push('\n**Recently Mentioned:**');
      lines.push(refs);
    }
  }

  // Conversation topic
  if (context.conversationTopic && context.conversationTopic !== 'general') {
    lines.push(`\n**Current Topic:** ${formatTopic(context.conversationTopic)}`);
  }

  return lines.join('\n');
}

/**
 * Format referenced entities for the prompt
 */
function buildReferencedEntitiesText(entities: ReferencedEntitiesMap): string {
  const parts: string[] = [];

  if (entities.outcome?.id) {
    const outcome = getOutcomeById(entities.outcome.id);
    if (outcome) {
      parts.push(`- Outcome: "${outcome.name}" (${entities.outcome.id})`);
    }
  }

  if (entities.worker?.id) {
    parts.push(`- Worker: ${entities.worker.id}`);
  }

  if (entities.task?.id) {
    parts.push(`- Task: ${entities.task.id}`);
  }

  if (entities.escalation?.id) {
    parts.push(`- Escalation: ${entities.escalation.id}`);
  }

  return parts.join('\n');
}

/**
 * Build recent messages section for conversation continuity
 */
function buildRecentMessagesSection(
  messages: Array<{ role: string; content: string; timestamp: number }>
): string {
  if (messages.length === 0) return '';

  const lines: string[] = ['## Recent Conversation'];

  // Show last 3 messages for context
  const recentMessages = messages.slice(-3);
  for (const msg of recentMessages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    // Truncate long messages
    const content =
      msg.content.length > 200
        ? msg.content.substring(0, 200) + '...'
        : msg.content;
    lines.push(`**${role}:** ${content}`);
  }

  return lines.join('\n');
}

/**
 * Format conversation topic for display
 */
function formatTopic(topic: string): string {
  const topicMap: Record<string, string> = {
    outcome_management: 'Managing outcomes',
    task_management: 'Working with tasks',
    worker_management: 'Managing workers',
    escalation_handling: 'Handling escalations',
    status_check: 'Checking status',
    iteration: 'Providing feedback',
    general: 'General',
  };
  return topicMap[topic] || topic;
}

// ============================================================================
// Legacy Exports (for backwards compatibility)
// ============================================================================

/**
 * Build a minimal prompt for simple queries
 * @deprecated Use buildAgentSystemPrompt instead
 */
export function buildMinimalPrompt(): string {
  return `You are a helpful assistant for the Flow system. Use the available tools to help the user with their request. Be concise and direct.`;
}
