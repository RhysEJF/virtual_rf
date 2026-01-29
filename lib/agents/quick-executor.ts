/**
 * Quick Executor
 *
 * Handles simple, one-shot requests with immediate responses.
 * Uses Claude Code CLI (your existing subscription).
 */

import { complete } from '../claude/client';

export interface QuickResult {
  response: string;
  success: boolean;
  error?: string;
}

/**
 * Execute a quick, one-shot request
 */
export async function executeQuick(input: string): Promise<QuickResult> {
  const result = await complete({
    system: 'You are a helpful AI assistant. Respond directly and concisely. Use markdown formatting when appropriate.',
    prompt: input,
    timeout: 60000, // 1 minute for quick tasks
  });

  if (!result.success) {
    return {
      response: '',
      success: false,
      error: result.error,
    };
  }

  return {
    response: result.text,
    success: true,
  };
}
