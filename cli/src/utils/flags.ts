/**
 * Shared Flag Utilities
 *
 * Common output flags (--json, --quiet) and utilities for consistent command behavior.
 */

import { Command } from 'commander';

/**
 * Options added by addOutputFlags
 */
export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

/**
 * Adds standard output flags to a command:
 * - --json: Output as JSON
 * - --quiet: Minimal output (just IDs)
 */
export function addOutputFlags<T extends Command>(command: T): T {
  return command
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Minimal output (IDs only)');
}

/**
 * Handles output based on flags:
 * - --json: Outputs data as JSON
 * - --quiet: Outputs just the ID
 * - Returns true if output was handled (caller should return early)
 * - Returns false if normal output should proceed
 */
export function handleOutput(
  data: unknown,
  options: OutputOptions,
  id?: string
): boolean {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return true;
  }

  if (options.quiet) {
    if (id) {
      console.log(id);
    }
    return true;
  }

  return false;
}
