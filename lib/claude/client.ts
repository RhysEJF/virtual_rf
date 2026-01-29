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
  // Cost tracking context
  outcomeId?: string;
  workerId?: string;
  taskId?: string;
  description?: string; // Description for cost log
}

interface ClaudeJSONResponse {
  type: string;
  subtype: string;
  is_error: boolean;
  duration_ms: number;
  result: string;
  total_cost_usd: number;
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
    maxTurns = 1,
    allowedTools,
    timeout = 120000, // 2 minutes default
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

    // Add system prompt if provided
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add allowed tools if specified
    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(' '));
    }

    // Log the command for debugging
    console.log('[Claude CLI] Running:', 'claude', args.join(' ').substring(0, 100) + '...');

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
          // Parse JSON response
          const jsonResponse = JSON.parse(stdout) as ClaudeJSONResponse;

          const cost = jsonResponse.total_cost_usd || 0;
          const text = jsonResponse.result || '';
          const durationMs = jsonResponse.duration_ms;
          const inputTokens = jsonResponse.usage?.input_tokens;
          const outputTokens = jsonResponse.usage?.output_tokens;

          console.log('[Claude CLI] Success, cost: $' + cost.toFixed(4) + ', duration: ' + durationMs + 'ms');

          // Log cost to database
          if (cost > 0) {
            try {
              logCost({
                project_id: outcomeId,
                worker_id: workerId,
                amount: cost,
                description: description || `Claude CLI call (${inputTokens || 0} in, ${outputTokens || 0} out)`,
              });
            } catch (logError) {
              console.error('[Claude CLI] Failed to log cost:', logError);
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
        } catch (parseError) {
          // If JSON parsing fails, treat stdout as plain text
          console.log('[Claude CLI] Success (non-JSON response), length:', stdout.length);
          resolve({
            text: stdout.trim(),
            success: true,
          });
        }
      } else {
        console.error('[Claude CLI] Failed with code:', code);
        console.error('[Claude CLI] stderr:', stderr.substring(0, 500));
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
 */
export async function complete(options: {
  system?: string;
  prompt: string;
  timeout?: number;
  outcomeId?: string;
  workerId?: string;
  description?: string;
}): Promise<{ text: string; success: boolean; error?: string; cost?: number }> {
  return claudeComplete({
    prompt: options.prompt,
    systemPrompt: options.system,
    maxTurns: 1,
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
