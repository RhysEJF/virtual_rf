/**
 * Command Validator Core Logic
 *
 * Validates commands before execution by Ralph workers, blocking dangerous
 * operations and allowing safe ones. Uses pattern matching to detect
 * destructive commands.
 */

import { resolve, relative, isAbsolute } from 'path';
import {
  DANGEROUS_PATTERNS,
  SAFE_PATTERNS,
  matchDangerousPattern,
  matchSafePattern,
  CommandPattern,
  SafePattern,
} from './patterns';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  /** Whether the command is allowed to execute */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Pattern ID that matched (if applicable) */
  pattern?: string;
}

export interface ValidationContext {
  /** Working directory where the command would execute */
  workspacePath: string;
  /** Worker ID executing the command (optional, for logging) */
  workerId?: string;
  /** Outcome ID (optional, for logging) */
  outcomeId?: string;
}

// ============================================================================
// Workspace Path Validation
// ============================================================================

/**
 * Check if a path is within the allowed workspace boundaries.
 * Commands should generally only operate within workspaces.
 */
function isPathInWorkspace(targetPath: string, workspacePath: string): boolean {
  // Normalize paths
  const normalizedTarget = resolve(targetPath);
  const normalizedWorkspace = resolve(workspacePath);

  // Check if target is within or equal to workspace
  const relativePath = relative(normalizedWorkspace, normalizedTarget);

  // If relative path starts with '..' it's outside the workspace
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return false;
  }

  return true;
}

/**
 * Extract paths from a command for workspace boundary checking.
 * This is a best-effort extraction - not all paths can be detected.
 */
function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];

  // Common patterns for file paths in commands
  // Match absolute paths
  const absolutePathRegex = /(?:^|\s)(\/[^\s;|&><]+)/g;
  let match: RegExpExecArray | null;
  while ((match = absolutePathRegex.exec(command)) !== null) {
    paths.push(match[1]);
  }

  // Match home directory paths
  const homePathRegex = /(?:^|\s)(~[^\s;|&><]*)/g;
  while ((match = homePathRegex.exec(command)) !== null) {
    paths.push(match[1].replace('~', process.env.HOME || '/home/user'));
  }

  return paths;
}

// ============================================================================
// Core Validation Logic
// ============================================================================

/**
 * Validate a command for safe execution.
 *
 * The validation follows this priority order:
 * 1. Check against SAFE_PATTERNS - if match, allow (unless also dangerous)
 * 2. Check against DANGEROUS_PATTERNS - if match, block
 * 3. If no patterns match, allow (permissive by default for development work)
 *
 * @param command - The shell command to validate
 * @param workspacePath - The workspace directory where the command runs
 * @returns ValidationResult indicating if the command is allowed
 */
export function validateCommand(
  command: string,
  workspacePath: string
): ValidationResult {
  // Normalize the command (trim whitespace, collapse multiple spaces)
  const normalizedCommand = command.trim().replace(/\s+/g, ' ');

  if (!normalizedCommand) {
    return {
      allowed: true,
      reason: 'Empty command',
    };
  }

  // Check for dangerous patterns first
  const dangerousMatch = matchDangerousPattern(normalizedCommand);
  const safeMatch = matchSafePattern(normalizedCommand);

  // If command matches a safe pattern and NOT a dangerous pattern, allow it
  if (safeMatch && !dangerousMatch) {
    return {
      allowed: true,
      reason: `Safe pattern: ${safeMatch.name}`,
      pattern: safeMatch.id,
    };
  }

  // If command matches a dangerous pattern
  if (dangerousMatch) {
    // If it also matches a safe pattern, this is a conflict - need review
    // For now, we block and require explicit allowlisting
    if (safeMatch) {
      return {
        allowed: false,
        reason: `Blocked: ${dangerousMatch.name} (conflicts with safe pattern: ${safeMatch.name}, manual review needed)`,
        pattern: dangerousMatch.id,
      };
    }

    // Pure dangerous match - block it
    return {
      allowed: false,
      reason: `Blocked: ${dangerousMatch.name} - ${dangerousMatch.description}`,
      pattern: dangerousMatch.id,
    };
  }

  // Check for paths that escape the workspace
  const paths = extractPathsFromCommand(normalizedCommand);
  for (const path of paths) {
    // Skip well-known safe system paths
    if (path.startsWith('/usr/bin/') ||
        path.startsWith('/bin/') ||
        path.startsWith('/usr/local/bin/') ||
        path.startsWith('/opt/homebrew/')) {
      continue;
    }

    // Check if path is outside workspace
    if (!isPathInWorkspace(path, workspacePath)) {
      // Only block write operations to paths outside workspace
      const writeCommands = /\b(rm|mv|cp|chmod|chown|mkdir|touch|cat\s*>|echo\s*>|tee)\b/;
      if (writeCommands.test(normalizedCommand)) {
        return {
          allowed: false,
          reason: `Blocked: Command targets path outside workspace: ${path}`,
          pattern: 'workspace_boundary',
        };
      }
    }
  }

  // No dangerous patterns matched, allow the command
  return {
    allowed: true,
    reason: 'No dangerous patterns detected',
  };
}

/**
 * Validate a command with additional context.
 * Provides the same validation as validateCommand but accepts a context object.
 */
export function validateCommandWithContext(
  command: string,
  context: ValidationContext
): ValidationResult {
  return validateCommand(command, context.workspacePath);
}

/**
 * Batch validate multiple commands.
 * Returns results for all commands, stopping at the first blocked command
 * if stopOnBlock is true.
 */
export function validateCommands(
  commands: string[],
  workspacePath: string,
  options: { stopOnBlock?: boolean } = {}
): { command: string; result: ValidationResult }[] {
  const results: { command: string; result: ValidationResult }[] = [];

  for (const command of commands) {
    const result = validateCommand(command, workspacePath);
    results.push({ command, result });

    if (options.stopOnBlock && !result.allowed) {
      break;
    }
  }

  return results;
}

/**
 * Quick check if a command is likely safe without full analysis.
 * Useful for filtering before more expensive operations.
 */
export function isCommandLikelySafe(command: string): boolean {
  const normalizedCommand = command.trim().replace(/\s+/g, ' ');

  // Quick check against known dangerous keywords
  const dangerousKeywords = [
    'rm -rf', 'rm -fr',
    'sudo', 'su ',
    'dd if=', 'dd of=',
    '--force', '-f ',
    'DROP TABLE', 'DROP DATABASE', 'TRUNCATE',
    'mkfs',
    '| sh', '| bash',
  ];

  for (const keyword of dangerousKeywords) {
    if (normalizedCommand.includes(keyword)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Exports
// ============================================================================

// Re-export pattern types and helpers for convenience
export { DANGEROUS_PATTERNS, SAFE_PATTERNS };
export type { CommandPattern, SafePattern };
