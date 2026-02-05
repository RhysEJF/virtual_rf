/**
 * Converse Agent
 *
 * The main orchestrator for the agentic conversational interface.
 * Uses a two-pass architecture:
 * - Pass 1: Claude decides which tools to call based on user message
 * - Pass 2: Claude formats the tool results into a natural response
 *
 * This approach removes the need for hardcoded formatters and lets Claude
 * adapt responses naturally based on context and the skill file guidelines.
 */

import { claudeComplete } from '../claude/client';
import { buildAgentSystemPrompt, buildFormattingPrompt, type ToolResultSummary } from '../converse/prompt-builder';
import { executeTool, type ToolCall, type ToolResult } from '../converse/tool-executor';
import { getToolNames } from '../converse/tools';
import {
  buildEnrichedContext,
  createSession,
  getSessionByIdParsed,
  isSessionValid,
  updateSessionOutcome,
  trackReferencedEntity,
  setPendingAction,
  clearPendingAction,
  getPendingAction,
  type EnrichedContext,
  type PendingAction,
} from '../db/sessions';
import { getPendingEscalations } from '../db/homr';
import * as workerTools from '../converse/tools/workers';

// ============================================================================
// Types
// ============================================================================

export interface ConverseAgentRequest {
  message: string;
  sessionId?: string;
}

export interface ToolCallResult {
  name: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ConverseAgentResponse {
  success: boolean;
  message: string;
  sessionId: string;
  toolCalls: ToolCallResult[];
  data?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Main Agent Function
// ============================================================================

/**
 * Run the conversational agent with the given message.
 *
 * Two-pass architecture:
 * 1. Pass 1 - Tool Execution: Claude analyzes the message and outputs TOOL_CALL statements
 * 2. Pass 2 - Formatting: If tools were called, Claude formats the results naturally
 *
 * If no tools are called, Pass 1 response is returned directly.
 */
export async function runConverseAgent(
  request: ConverseAgentRequest
): Promise<ConverseAgentResponse> {
  const { message, sessionId } = request;

  // Get or create session
  let session;
  if (sessionId && isSessionValid(sessionId)) {
    session = getSessionByIdParsed(sessionId);
  }

  if (!session) {
    const newSession = createSession({});
    session = {
      ...newSession,
      context: JSON.parse(newSession.context) as Record<string, unknown>,
    };
  }

  // Check for Yes/No response to pending action
  const pendingActionResult = await handlePendingActionResponse(message, session.id);
  if (pendingActionResult) {
    return pendingActionResult;
  }

  // Build enriched context for the prompt
  const pendingEscalations = session.current_outcome_id
    ? getPendingEscalations(session.current_outcome_id).map((e) => ({
        id: e.id,
        question_text: e.question_text,
      }))
    : [];

  const enrichedContext = buildEnrichedContext(session.id, {
    pendingEscalations,
    recentMessageCount: 5,
  });

  try {
    // =========================================================================
    // PASS 1: Tool Execution
    // =========================================================================
    const systemPrompt = buildAgentSystemPrompt(session.id, enrichedContext);

    const pass1Response = await claudeComplete({
      prompt: message,
      systemPrompt,
      maxTurns: 5, // Safety cap - Claude stops naturally when done, this just prevents runaway
      timeout: 60000,
      disableNativeTools: true, // No native tools, so no risk of tool-use loops
      description: 'Converse agent - Pass 1 (tool execution)',
    });

    if (!pass1Response.success) {
      return {
        success: false,
        message: 'Sorry, I encountered an error processing your request.',
        sessionId: session.id,
        toolCalls: [],
        error: pass1Response.error,
      };
    }

    // Parse tool calls from response
    const toolCalls = parseToolCalls(pass1Response.text);

    // If no tools were called, return Pass 1 response directly
    if (toolCalls.length === 0) {
      // Strip any stray tool-call-like text that might confuse the user
      const cleanedResponse = cleanResponseText(pass1Response.text);
      return {
        success: true,
        message: cleanedResponse,
        sessionId: session.id,
        toolCalls: [],
      };
    }

    // =========================================================================
    // Execute Tools
    // =========================================================================
    const toolResults = new Map<string, ToolResult>();
    for (const call of toolCalls) {
      const result = await executeTool(call);
      toolResults.set(call.name, result);
    }

    // Check for errors
    const hasErrors = Array.from(toolResults.values()).some((r) => !r.success);
    if (hasErrors) {
      // Find first error and return it
      for (const [name, result] of Array.from(toolResults.entries())) {
        if (!result.success) {
          return {
            success: false,
            message: `I couldn't complete that request: ${result.error}`,
            sessionId: session.id,
            toolCalls: toolCalls.map((tc) => ({
              name: tc.name,
              success: toolResults.get(tc.name)?.success ?? false,
              data: toolResults.get(tc.name)?.data,
              error: toolResults.get(tc.name)?.error,
            })),
          };
        }
      }
    }

    // Update session context based on tool calls/results
    updateSessionFromResponse(session.id, toolCalls, toolResults);

    // =========================================================================
    // PASS 2: Formatting
    // =========================================================================
    const toolResultSummaries: ToolResultSummary[] = toolCalls.map((tc) => ({
      toolName: tc.name,
      success: toolResults.get(tc.name)?.success ?? false,
      data: toolResults.get(tc.name)?.data,
      error: toolResults.get(tc.name)?.error,
    }));

    const formattingPrompt = buildFormattingPrompt(
      message,
      toolResultSummaries,
      enrichedContext
    );

    const pass2Response = await claudeComplete({
      prompt: formattingPrompt,
      maxTurns: 3, // Formatting is simple, but allow some room for thinking
      timeout: 30000,
      disableNativeTools: true, // Pure text formatting, no tools needed
      description: 'Converse agent - Pass 2 (formatting)',
    });

    if (!pass2Response.success) {
      // Fall back to raw data display if formatting fails
      const fallbackMessage = buildFallbackResponse(toolCalls, toolResults);
      return {
        success: true,
        message: fallbackMessage,
        sessionId: session.id,
        toolCalls: toolResultSummaries.map((tr) => ({
          name: tr.toolName,
          success: tr.success,
          data: tr.data,
          error: tr.error,
        })),
        data: extractDataFromResults(toolResults),
      };
    }

    // Clean up Pass 2 response
    const formattedResponse = cleanResponseText(pass2Response.text);

    return {
      success: true,
      message: formattedResponse,
      sessionId: session.id,
      toolCalls: toolResultSummaries.map((tr) => ({
        name: tr.toolName,
        success: tr.success,
        data: tr.data,
        error: tr.error,
      })),
      data: extractDataFromResults(toolResults),
    };
  } catch (error) {
    return {
      success: false,
      message: 'Sorry, something went wrong. Please try again.',
      sessionId: session.id,
      toolCalls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Pending Action Handling
// ============================================================================

/**
 * Check if the message is a Yes/No response to a pending action.
 * If yes, execute the pending action and return a response.
 * If no, clear the pending action and return null to continue normal processing.
 */
async function handlePendingActionResponse(
  message: string,
  sessionId: string
): Promise<ConverseAgentResponse | null> {
  const pendingAction = getPendingAction(sessionId);
  if (!pendingAction) return null;

  const lowerMessage = message.toLowerCase().trim();

  // Check for affirmative responses
  const affirmativePatterns = [
    /^yes$/i,
    /^yeah$/i,
    /^yep$/i,
    /^sure$/i,
    /^ok$/i,
    /^okay$/i,
    /^do it$/i,
    /^go ahead$/i,
    /^please$/i,
    /^yes please$/i,
    /^let'?s do it$/i,
    /^start$/i,
    /^y$/i,
  ];

  // Check for negative responses
  const negativePatterns = [
    /^no$/i,
    /^nope$/i,
    /^nah$/i,
    /^don'?t$/i,
    /^cancel$/i,
    /^never ?mind$/i,
    /^skip$/i,
    /^n$/i,
  ];

  const isAffirmative = affirmativePatterns.some((p) => p.test(lowerMessage));
  const isNegative = negativePatterns.some((p) => p.test(lowerMessage));

  if (!isAffirmative && !isNegative) {
    // Not a clear Yes/No response, continue with normal processing
    // but keep the pending action for now
    return null;
  }

  // Clear the pending action regardless of response
  clearPendingAction(sessionId);

  if (isNegative) {
    return {
      success: true,
      message: 'Okay, no problem. Let me know if you need anything else.',
      sessionId,
      toolCalls: [],
    };
  }

  // Execute the pending action
  return await executePendingAction(pendingAction, sessionId);
}

/**
 * Execute a pending action and return the response
 */
async function executePendingAction(
  action: PendingAction,
  sessionId: string
): Promise<ConverseAgentResponse> {
  try {
    switch (action.type) {
      case 'start_worker': {
        const outcomeId = action.params.outcome_id as string;
        if (!outcomeId) {
          return {
            success: false,
            message: 'Sorry, I lost track of which outcome to start. Could you specify it again?',
            sessionId,
            toolCalls: [],
          };
        }

        const result = await workerTools.startWorker(outcomeId);
        if (!result.success) {
          return {
            success: false,
            message: `Couldn't start worker: ${result.error}`,
            sessionId,
            toolCalls: [{ name: 'startWorker', success: false, error: result.error }],
          };
        }

        // Track the worker reference
        if (result.workerId) {
          trackReferencedEntity(sessionId, {
            type: 'worker',
            id: result.workerId,
          });
        }

        return {
          success: true,
          message: `Started worker for **${result.outcomeName}**. It will work through ${result.pendingTasks} pending task(s).`,
          sessionId,
          toolCalls: [{ name: 'startWorker', success: true, data: result }],
          data: {
            worker_id: result.workerId,
            outcome_id: outcomeId,
          },
        };
      }

      case 'stop_worker': {
        const workerId = action.params.worker_id as string | undefined;
        const outcomeId = action.params.outcome_id as string | undefined;

        const result = workerTools.stopWorker(workerId, outcomeId);
        if (!result.success) {
          return {
            success: false,
            message: `Couldn't stop worker: ${result.error}`,
            sessionId,
            toolCalls: [{ name: 'stopWorker', success: false, error: result.error }],
          };
        }

        return {
          success: true,
          message: `Stopped ${result.stoppedCount} worker(s).`,
          sessionId,
          toolCalls: [{ name: 'stopWorker', success: true, data: result }],
        };
      }

      default:
        return {
          success: false,
          message: 'Sorry, I encountered an error executing that action.',
          sessionId,
          toolCalls: [],
        };
    }
  } catch (error) {
    return {
      success: false,
      message: `Sorry, something went wrong: ${error instanceof Error ? error.message : 'Unknown error'}`,
      sessionId,
      toolCalls: [],
    };
  }
}

// ============================================================================
// Tool Call Parsing
// ============================================================================

/**
 * Parse tool calls from the agent's response.
 * Looks for patterns like:
 * - TOOL_CALL: toolName(arg1="value", arg2="value")
 * - JSON blocks with tool calls
 */
function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const validToolNames = getToolNames();

  // Pattern 1: TOOL_CALL: toolName(args)
  const pattern1 = /TOOL_CALL:\s*(\w+)\((.*?)\)/g;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    const name = match[1];
    const argsStr = match[2];
    const args = parseArgString(argsStr);
    if (validToolNames.includes(name)) {
      calls.push({ name, arguments: args });
    }
  }

  // Pattern 2: Look for JSON tool calls
  const jsonPattern = /\{[\s]*"tool"[\s]*:[\s]*"(\w+)"[\s]*,[\s]*"arguments"[\s]*:[\s]*(\{[^}]+\})[\s]*\}/g;
  while ((match = jsonPattern.exec(text)) !== null) {
    const name = match[1];
    try {
      const args = JSON.parse(match[2]);
      if (validToolNames.includes(name) && !calls.some((c) => c.name === name)) {
        calls.push({ name, arguments: args });
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return calls;
}

/**
 * Parse argument string like 'arg1="value", arg2=123'
 */
function parseArgString(argsStr: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!argsStr.trim()) return args;

  // Split by comma, but respect quotes
  const parts = argsStr.match(/(\w+)\s*=\s*("[^"]*"|'[^']*'|\d+|true|false)/g);
  if (!parts) return args;

  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    let value: unknown = valueParts.join('=').trim();

    // Parse the value
    if (typeof value === 'string') {
      if (value.startsWith('"') || value.startsWith("'")) {
        value = value.slice(1, -1);
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (!isNaN(Number(value))) {
        value = Number(value);
      }
    }

    args[key.trim()] = value;
  }

  return args;
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Clean up response text, removing any stray tool call markers
 */
function cleanResponseText(text: string): string {
  // Remove TOOL_CALL statements
  let cleaned = text.replace(/TOOL_CALL:\s*\w+\([^)]*\)/g, '');
  // Remove JSON tool objects
  cleaned = cleaned.replace(/\{[\s]*"tool"[\s]*:.*?\}/g, '');
  // Remove code blocks containing TOOL_CALL (multiline safe)
  cleaned = cleaned.replace(/```(?:json)?[\s\S]*?TOOL_CALL[\s\S]*?```/g, '');
  return cleaned.trim();
}

/**
 * Build a fallback response when Pass 2 formatting fails
 */
function buildFallbackResponse(
  toolCalls: ToolCall[],
  toolResults: Map<string, ToolResult>
): string {
  const lines: string[] = [];

  for (const call of toolCalls) {
    const result = toolResults.get(call.name);
    if (!result?.success || !result.data) continue;

    lines.push(`**${call.name}**:`);
    lines.push('```json');
    lines.push(JSON.stringify(result.data, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n') || 'No data to display.';
}

// ============================================================================
// Session Update Helpers
// ============================================================================

/**
 * Update session context based on the agent's response
 */
function updateSessionFromResponse(
  sessionId: string,
  toolCalls: ToolCall[],
  toolResults: Map<string, ToolResult>
): void {
  // Track entities mentioned in tool calls/results
  for (const call of toolCalls) {
    const result = toolResults.get(call.name);
    if (!result?.success || !result.data) continue;

    // Track outcome references and set pending actions for follow-ups
    if (call.name === 'createOutcome') {
      const data = result.data as { id?: string; name?: string };
      if (data.id) {
        trackReferencedEntity(sessionId, {
          type: 'outcome',
          id: data.id,
          name: data.name,
        });
        updateSessionOutcome(sessionId, data.id);

        // Set pending action for "Would you like me to start a worker?"
        setPendingAction(sessionId, {
          type: 'start_worker',
          params: { outcome_id: data.id },
          prompt: 'Would you like me to start a worker?',
        });
      }
    }

    if (call.name === 'getOutcome') {
      const data = result.data as { id?: string; name?: string };
      if (data.id) {
        trackReferencedEntity(sessionId, {
          type: 'outcome',
          id: data.id,
          name: data.name,
        });
        updateSessionOutcome(sessionId, data.id);
      }
    }

    // Track worker references
    if (call.name === 'startWorker') {
      const data = result.data as { workerId?: string };
      if (data.workerId) {
        trackReferencedEntity(sessionId, {
          type: 'worker',
          id: data.workerId,
        });
      }
    }

    // Set pending action for iterate feedback
    if (call.name === 'iterateOnOutcome') {
      const outcomeId = call.arguments.outcome_id as string;
      if (outcomeId) {
        // Set pending action for "Would you like me to start a worker?"
        setPendingAction(sessionId, {
          type: 'start_worker',
          params: { outcome_id: outcomeId },
          prompt: 'Would you like me to start a worker to implement these changes?',
        });
      }
    }
  }
}

/**
 * Extract relevant data from tool results for the response
 */
function extractDataFromResults(
  toolResults: Map<string, ToolResult>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [name, result] of Array.from(toolResults.entries())) {
    if (result.success && result.data) {
      // Extract key identifiers
      const resultData = result.data as Record<string, unknown>;
      if (resultData.id) data.outcome_id = resultData.id;
      if (resultData.workerId) data.worker_id = resultData.workerId;
      if (resultData.outcomeId) data.outcome_id = resultData.outcomeId;
    }
  }

  return data;
}
