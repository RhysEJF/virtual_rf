/**
 * Claude Code CLI wrapper
 *
 * Uses the `claude` CLI instead of the API, leveraging your existing Claude Max subscription.
 * Tracks costs from each CLI call.
 */

import { spawn } from 'child_process';
import { logCost } from '../db/logs';

export interface ClaudeResponse {
  text: string;
  success: boolean;
  error?: string;
  cost?: number; // USD cost of this call
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ClaudeOptions {
  prompt: string;
  systemPrompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
  timeout?: number; // milliseconds
  /** If true, Claude won't have access to native tools (file read, bash, etc.) */
  disableNativeTools?: boolean;
  // Cost tracking context
  outcomeId?: string;
  workerId?: string;
  taskId?: string;
  description?: string; // Description for cost log
}

interface ClaudeJSONResponse {
  type: string;
  subtype: string; // 'success' | 'error_max_turns' | etc.
  is_error: boolean;
  duration_ms: number;
  result?: string; // May be undefined on error_max_turns
  total_cost_usd: number;
  num_turns?: number;
  session_id?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Execute a prompt using Claude Code CLI
 */
export async function claudeComplete(options: ClaudeOptions): Promise<ClaudeResponse> {
  const {
    prompt,
    systemPrompt,
    maxTurns = 5, // Default to 5 turns for clarifications and tool use
    allowedTools,
    timeout = 120000, // 2 minutes default
    disableNativeTools = false,
    outcomeId,
    workerId,
    taskId,
    description,
  } = options;

  return new Promise((resolve) => {
    const args: string[] = [
      '-p', prompt, // -p makes it non-interactive (print mode)
      '--output-format', 'json', // Always use JSON to get cost info
      '--max-turns', maxTurns.toString(),
    ];

    // Only add --dangerously-skip-permissions if we want native tool access
    // For pure text generation (like converse agent), we skip this to prevent
    // Claude from using file/bash/web tools and wasting turns
    if (!disableNativeTools) {
      args.push('--dangerously-skip-permissions');
    }

    // Add system prompt if provided
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add allowed tools if specified
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(' '));
    }

    const claude = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, pipe stdout/stderr
    });

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      claude.kill('SIGTERM');
      resolve({
        text: '',
        success: false,
        error: `Claude CLI timed out after ${timeout / 1000}s`,
      });
    }, timeout);

    claude.on('close', (code) => {
      clearTimeout(timeoutId);

      if (code === 0) {
        try {
          // The CLI may output multiple JSON lines (streaming), find the result message
          let jsonResponse: ClaudeJSONResponse | null = null;
          const lines = stdout.trim().split('\n').filter(l => l.trim());

          if (lines.length > 1) {
            // Multiple JSON lines - find the final result
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const parsed = JSON.parse(lines[i]);
                if (parsed.type === 'result') {
                  jsonResponse = parsed;
                  break;
                }
              } catch {
                // Skip non-JSON lines
              }
            }
            if (!jsonResponse) {
              // Fallback to last line
              jsonResponse = JSON.parse(lines[lines.length - 1]);
            }
          } else {
            jsonResponse = JSON.parse(stdout) as ClaudeJSONResponse;
          }

          if (!jsonResponse) {
            throw new Error('Failed to parse JSON response');
          }

          const cost = jsonResponse.total_cost_usd || 0;
          // Try different possible field names for the response text
          const responseAny = jsonResponse as unknown as Record<string, unknown>;
          const text = (
            jsonResponse.result ||
            responseAny.content ||
            responseAny.text ||
            responseAny.message ||
            responseAny.response ||
            ''
          ) as string;

          const durationMs = jsonResponse.duration_ms;
          const inputTokens = jsonResponse.usage?.input_tokens;
          const outputTokens = jsonResponse.usage?.output_tokens;

          // Log cost to database
          if (cost > 0) {
            try {
              logCost({
                outcome_id: outcomeId,
                worker_id: workerId,
                amount: cost,
                description: description || `Claude CLI call (${inputTokens || 0} in, ${outputTokens || 0} out)`,
              });
            } catch {
              // Cost logging failed - non-critical, continue
            }
          }

          resolve({
            text,
            success: !jsonResponse.is_error,
            cost,
            durationMs,
            inputTokens,
            outputTokens,
          });
        } catch {
          // If JSON parsing fails, treat stdout as plain text
          resolve({
            text: stdout.trim(),
            success: true,
          });
        }
      } else {
        resolve({
          text: stdout.trim(),
          success: false,
          error: stderr.trim() || `Claude CLI exited with code ${code}`,
        });
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        text: '',
        success: false,
        error: `Failed to spawn Claude CLI: ${err.message}`,
      });
    });
  });
}

/**
 * Simple completion helper for quick tasks
 * Default maxTurns is 5 to allow for clarifying questions and tool use
 */
export async function complete(options: {
  system?: string;
  prompt: string;
  timeout?: number;
  maxTurns?: number;
  outcomeId?: string;
  workerId?: string;
  description?: string;
}): Promise<{ text: string; success: boolean; error?: string; cost?: number }> {
  return claudeComplete({
    prompt: options.prompt,
    systemPrompt: options.system,
    maxTurns: options.maxTurns ?? 5, // Allow multi-turn for clarifications/tools
    timeout: options.timeout,
    outcomeId: options.outcomeId,
    workerId: options.workerId,
    description: options.description,
  });
}

/**
 * Check if Claude CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const claude = spawn('claude', ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    claude.on('close', (code) => {
      resolve(code === 0);
    });

    claude.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      claude.kill();
      resolve(false);
    }, 5000);
  });
}
