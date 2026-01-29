/**
 * Claude Code CLI wrapper
 *
 * Uses the `claude` CLI instead of the API, leveraging your existing Claude Max subscription.
 */

import { spawn } from 'child_process';

export interface ClaudeResponse {
  text: string;
  success: boolean;
  error?: string;
}

export interface ClaudeOptions {
  prompt: string;
  systemPrompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
  outputFormat?: 'text' | 'json' | 'stream-json';
  timeout?: number; // milliseconds
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
    outputFormat = 'text',
    timeout = 120000, // 2 minutes default
  } = options;

  return new Promise((resolve) => {
    const args: string[] = [
      '-p', prompt, // -p makes it non-interactive (print mode)
      '--output-format', outputFormat,
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
      stdio: ['pipe', 'pipe', 'pipe'],
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
        console.log('[Claude CLI] Success, response length:', stdout.length);
        resolve({
          text: stdout.trim(),
          success: true,
        });
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
}): Promise<{ text: string; success: boolean; error?: string }> {
  return claudeComplete({
    prompt: options.prompt,
    systemPrompt: options.system,
    maxTurns: 1,
    timeout: options.timeout,
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
