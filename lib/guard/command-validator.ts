/**
 * Command Validator Core Logic
 *
 * Validates commands before execution by Ralph workers, blocking dangerous
 * operations and allowing safe ones. Uses pattern matching to detect
 * destructive commands and path-aware validation to ensure commands
 * stay within workspace boundaries.
 */

import { resolve, relative, isAbsolute, dirname } from 'path';
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
  /** Paths that were analyzed during validation */
  analyzedPaths?: PathAnalysis[];
}

export interface ValidationContext {
  /** Working directory where the command would execute */
  workspacePath: string;
  /** Worker ID executing the command (optional, for logging) */
  workerId?: string;
  /** Outcome ID (optional, for logging) */
  outcomeId?: string;
}

/**
 * Classification of a path based on its location
 */
export type PathClassification =
  | 'workspace'      // Within the allowed workspace directory
  | 'safe_binary'    // Safe system binary directories (/usr/bin, /bin, etc.)
  | 'system'         // System directories (/etc, /var, /usr, /opt, /Library, etc.)
  | 'user_home'      // User home directory but outside workspace
  | 'protected'      // Critical system paths (/, /System, /private, etc.)
  | 'relative'       // Relative path (needs context to resolve)
  | 'unknown';       // Could not classify

/**
 * Result of analyzing a path
 */
export interface PathAnalysis {
  /** Original path as found in command */
  original: string;
  /** Resolved absolute path */
  resolved: string;
  /** Classification of the path */
  classification: PathClassification;
  /** Whether write operations to this path should be blocked */
  blockWrites: boolean;
  /** Whether read operations to this path should be blocked */
  blockReads: boolean;
}

// ============================================================================
// Path Classification Constants
// ============================================================================

/**
 * System binary directories that are safe to reference (for executing programs)
 */
const SAFE_BINARY_DIRECTORIES = [
  '/usr/bin',
  '/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/sbin',
  '/sbin',
  '/opt/homebrew/sbin',
];

/**
 * Protected system paths that should never be written to
 */
const PROTECTED_PATHS = [
  '/',
  '/System',
  '/private',
  '/private/etc',
  '/private/var',
  '/cores',
  '/dev',
  '/Volumes',
];

/**
 * System directories that require careful handling
 */
const SYSTEM_DIRECTORIES = [
  '/etc',
  '/var',
  '/usr',
  '/opt',
  '/Library',
  '/Applications',
  '/tmp',  // While writable, can affect system stability
];

/**
 * User-specific directories within home that may contain sensitive data
 */
const SENSITIVE_HOME_PATHS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.config',
  '.local',
  '.bash_history',
  '.zsh_history',
  '.env',
  '.npmrc',
  '.gitconfig',
  '.netrc',
];

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
 * Classify a path based on its location in the filesystem
 */
export function classifyPath(
  targetPath: string,
  workspacePath: string,
  cwd?: string
): PathAnalysis {
  const home = process.env.HOME || '/home/user';

  // Handle relative paths by resolving against current working directory
  let resolvedPath: string;
  if (isAbsolute(targetPath)) {
    resolvedPath = resolve(targetPath);
  } else if (targetPath.startsWith('~')) {
    resolvedPath = resolve(targetPath.replace(/^~/, home));
  } else {
    // Relative path - resolve against workspace or cwd
    resolvedPath = resolve(cwd || workspacePath, targetPath);
  }

  // Check if path is in workspace first
  if (isPathInWorkspace(resolvedPath, workspacePath)) {
    return {
      original: targetPath,
      resolved: resolvedPath,
      classification: 'workspace',
      blockWrites: false,
      blockReads: false,
    };
  }

  // Check protected paths (root and critical system directories)
  for (const protectedPath of PROTECTED_PATHS) {
    if (resolvedPath === protectedPath ||
        resolvedPath.startsWith(protectedPath + '/')) {
      // Allow /private/tmp as a special case (macOS temp directory)
      if (resolvedPath.startsWith('/private/tmp')) {
        return {
          original: targetPath,
          resolved: resolvedPath,
          classification: 'system',
          blockWrites: false, // Allow writes to temp directories
          blockReads: false,
        };
      }
      return {
        original: targetPath,
        resolved: resolvedPath,
        classification: 'protected',
        blockWrites: true,
        blockReads: true, // Block even reads from highly protected paths
      };
    }
  }

  // Check safe binary directories (allow execution references)
  for (const binDir of SAFE_BINARY_DIRECTORIES) {
    if (resolvedPath.startsWith(binDir + '/') || resolvedPath === binDir) {
      return {
        original: targetPath,
        resolved: resolvedPath,
        classification: 'safe_binary',
        blockWrites: true, // Never allow writes to binary dirs
        blockReads: false, // Allow reads (e.g., checking if binary exists)
      };
    }
  }

  // Check system directories
  for (const sysDir of SYSTEM_DIRECTORIES) {
    if (resolvedPath.startsWith(sysDir + '/') || resolvedPath === sysDir) {
      // /tmp is a special case - allow writes
      if (resolvedPath.startsWith('/tmp')) {
        return {
          original: targetPath,
          resolved: resolvedPath,
          classification: 'system',
          blockWrites: false,
          blockReads: false,
        };
      }
      return {
        original: targetPath,
        resolved: resolvedPath,
        classification: 'system',
        blockWrites: true,
        blockReads: false, // Allow reads from most system directories
      };
    }
  }

  // Check user home directory
  if (resolvedPath.startsWith(home)) {
    // Check if it's in a sensitive location within home
    const relativToHome = relative(home, resolvedPath);
    const firstComponent = relativToHome.split('/')[0];

    if (SENSITIVE_HOME_PATHS.includes(firstComponent) ||
        SENSITIVE_HOME_PATHS.includes('.' + firstComponent)) {
      return {
        original: targetPath,
        resolved: resolvedPath,
        classification: 'user_home',
        blockWrites: true,
        blockReads: true, // Block reads from sensitive home paths
      };
    }

    return {
      original: targetPath,
      resolved: resolvedPath,
      classification: 'user_home',
      blockWrites: true, // Block writes to arbitrary home locations
      blockReads: false,
    };
  }

  // Check if it's a relative path that couldn't be resolved properly
  if (!isAbsolute(targetPath)) {
    return {
      original: targetPath,
      resolved: resolvedPath,
      classification: 'relative',
      blockWrites: false, // Relative paths within workspace context should be OK
      blockReads: false,
    };
  }

  // Unknown path classification - be conservative
  return {
    original: targetPath,
    resolved: resolvedPath,
    classification: 'unknown',
    blockWrites: true,
    blockReads: false,
  };
}

/**
 * Extract paths from a command for workspace boundary checking.
 * Enhanced to handle quoted paths, environment variables, and various formats.
 */
export function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  const addPath = (p: string): void => {
    // Clean up the path
    const cleaned = p.trim().replace(/['"`]$/g, '').replace(/^['"`]/g, '');
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      paths.push(cleaned);
    }
  };

  // Match absolute paths (not preceded by = which might be an assignment like PATH=/foo)
  const absolutePathRegex = /(?:^|[\s:,])(?!.*=\s*)(\/[^\s;|&><'"`,\)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = absolutePathRegex.exec(command)) !== null) {
    addPath(match[1]);
  }

  // Match quoted absolute paths (single or double quotes)
  const quotedAbsolutePathRegex = /["'](\/[^"']+)["']/g;
  while ((match = quotedAbsolutePathRegex.exec(command)) !== null) {
    addPath(match[1]);
  }

  // Match home directory paths (~ expansion)
  const homePathRegex = /(?:^|[\s:,])(~[^\s;|&><'"`,\)]*)/g;
  while ((match = homePathRegex.exec(command)) !== null) {
    const home = process.env.HOME || '/home/user';
    addPath(match[1].replace(/^~/, home));
  }

  // Match quoted home paths
  const quotedHomePathRegex = /["'](~[^"']+)["']/g;
  while ((match = quotedHomePathRegex.exec(command)) !== null) {
    const home = process.env.HOME || '/home/user';
    addPath(match[1].replace(/^~/, home));
  }

  // Match relative paths that look like directory traversal
  const traversalRegex = /(?:^|[\s])(\.\.(?:\/[^\s;|&><'"`,\)]*)?)/g;
  while ((match = traversalRegex.exec(command)) !== null) {
    addPath(match[1]);
  }

  // Match relative paths starting with ./
  const dotSlashRegex = /(?:^|[\s])(\.\/[^\s;|&><'"`,\)]*)/g;
  while ((match = dotSlashRegex.exec(command)) !== null) {
    addPath(match[1]);
  }

  return paths;
}

/**
 * Determine if a command is a write operation based on the command structure
 */
function isWriteOperation(command: string): boolean {
  // Commands that definitely write/modify
  const writeCommands = [
    /\brm\b/,           // Remove
    /\bmv\b/,           // Move (modifies source and dest)
    /\bcp\b/,           // Copy (creates new files)
    /\bchmod\b/,        // Change permissions
    /\bchown\b/,        // Change ownership
    /\bmkdir\b/,        // Create directory
    /\btouch\b/,        // Create/update file
    /\bln\b/,           // Create link
    /\bunlink\b/,       // Remove file
    /\btruncate\b/,     // Truncate file
    /\bdd\b/,           // Direct disk operations
    /\binstall\b/,      // Install command
    /\brename\b/,       // Rename
  ];

  // Check for output redirection
  if (/>\s*[^>]|>>\s*[^>]/.test(command)) {
    return true;
  }

  // Check for tee command (writes to files)
  if (/\btee\b/.test(command)) {
    return true;
  }

  // Check command verbs
  for (const pattern of writeCommands) {
    if (pattern.test(command)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if a command is a read operation that might access sensitive data
 */
function isReadOperation(command: string): boolean {
  const readCommands = [
    /\bcat\b/,
    /\bless\b/,
    /\bmore\b/,
    /\bhead\b/,
    /\btail\b/,
    /\bgrep\b/,
    /\bawk\b/,
    /\bsed\b/,
    /\bxargs\b.*cat/,
    /\bfind\b.*-exec.*cat/,
  ];

  for (const pattern of readCommands) {
    if (pattern.test(command)) {
      return true;
    }
  }

  return false;
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
 * 3. Perform path-aware validation to check workspace boundaries
 * 4. If no patterns match and paths are safe, allow
 *
 * @param command - The shell command to validate
 * @param workspacePath - The workspace directory where the command runs
 * @param cwd - Optional current working directory for resolving relative paths
 * @returns ValidationResult indicating if the command is allowed
 */
export function validateCommand(
  command: string,
  workspacePath: string,
  cwd?: string
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

  // Perform path-aware validation
  const pathValidation = validatePathsInCommand(normalizedCommand, workspacePath, cwd);
  if (!pathValidation.allowed) {
    return pathValidation;
  }

  // No dangerous patterns matched, allow the command
  return {
    allowed: true,
    reason: 'No dangerous patterns detected',
    analyzedPaths: pathValidation.analyzedPaths,
  };
}

/**
 * Validate all paths in a command to ensure they're within allowed boundaries.
 * Returns a detailed result including path analysis.
 */
export function validatePathsInCommand(
  command: string,
  workspacePath: string,
  cwd?: string
): ValidationResult {
  const paths = extractPathsFromCommand(command);
  const analyzedPaths: PathAnalysis[] = [];

  const isWrite = isWriteOperation(command);
  const isRead = isReadOperation(command);

  for (const path of paths) {
    const analysis = classifyPath(path, workspacePath, cwd);
    analyzedPaths.push(analysis);

    // Check for blocked operations based on path classification
    if (isWrite && analysis.blockWrites) {
      const classificationMessage = getClassificationMessage(analysis.classification);
      return {
        allowed: false,
        reason: `Blocked: Write operation to ${classificationMessage}: ${analysis.resolved}`,
        pattern: `path_${analysis.classification}`,
        analyzedPaths,
      };
    }

    if (isRead && analysis.blockReads) {
      const classificationMessage = getClassificationMessage(analysis.classification);
      return {
        allowed: false,
        reason: `Blocked: Read operation from ${classificationMessage}: ${analysis.resolved}`,
        pattern: `path_${analysis.classification}`,
        analyzedPaths,
      };
    }

    // Special handling for protected paths - block even non-write operations
    // that could be destructive (like rm without -r)
    if (analysis.classification === 'protected') {
      // Check for any destructive command, not just writes
      if (/\b(rm|unlink|shred|wipe)\b/.test(command)) {
        return {
          allowed: false,
          reason: `Blocked: Destructive operation on protected path: ${analysis.resolved}`,
          pattern: 'path_protected',
          analyzedPaths,
        };
      }
    }
  }

  return {
    allowed: true,
    reason: 'All paths within allowed boundaries',
    analyzedPaths,
  };
}

/**
 * Get a human-readable message for a path classification
 */
function getClassificationMessage(classification: PathClassification): string {
  switch (classification) {
    case 'workspace':
      return 'workspace directory';
    case 'safe_binary':
      return 'system binary directory';
    case 'system':
      return 'system directory';
    case 'user_home':
      return 'user home directory';
    case 'protected':
      return 'protected system path';
    case 'relative':
      return 'relative path';
    case 'unknown':
      return 'unknown location';
    default:
      return 'unclassified path';
  }
}

/**
 * Validate a command with additional context.
 * Provides the same validation as validateCommand but accepts a context object.
 */
export function validateCommandWithContext(
  command: string,
  context: ValidationContext & { cwd?: string }
): ValidationResult {
  return validateCommand(command, context.workspacePath, context.cwd);
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

// Export path classification constants for external use
export {
  SAFE_BINARY_DIRECTORIES,
  PROTECTED_PATHS,
  SYSTEM_DIRECTORIES,
  SENSITIVE_HOME_PATHS,
};
