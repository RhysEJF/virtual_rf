/**
 * Git Worktree Manager
 *
 * Manages git worktrees for parallel workers.
 * Each worker gets its own isolated worktree with a unique branch.
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

// ============================================================================
// Configuration
// ============================================================================

const WORKTREE_BASE_DIR = 'worktrees';

// ============================================================================
// Utilities
// ============================================================================

/**
 * Execute a git command and return the output
 */
function git(command: string, cwd?: string): string {
  try {
    return execSync(`git ${command}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const err = error as { stderr?: Buffer; message: string };
    throw new Error(err.stderr?.toString() || err.message);
  }
}

/**
 * Check if we're in a git repository
 */
export function isGitRepo(path?: string): boolean {
  try {
    git('rev-parse --git-dir', path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root of the git repository
 */
export function getRepoRoot(path?: string): string {
  return git('rev-parse --show-toplevel', path);
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(path?: string): string {
  return git('rev-parse --abbrev-ref HEAD', path);
}

// ============================================================================
// Worktree Operations
// ============================================================================

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
}

/**
 * List all worktrees in the repository
 */
export function listWorktrees(repoPath?: string): WorktreeInfo[] {
  const output = git('worktree list --porcelain', repoPath);
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = { path: line.slice(9) };
    } else if (line.startsWith('HEAD ')) {
      current.commit = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    }
  }

  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }

  return worktrees;
}

/**
 * Create a worktree for a worker
 */
export function createWorktree(
  outcomeId: string,
  workerId: string,
  baseBranch?: string
): { path: string; branch: string } {
  const repoRoot = getRepoRoot();
  const worktreePath = resolve(repoRoot, WORKTREE_BASE_DIR, outcomeId, workerId);
  const branchName = `worker-${workerId}`;

  // Ensure the parent directory exists
  const parentDir = resolve(repoRoot, WORKTREE_BASE_DIR, outcomeId);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Get the base branch (default to current branch)
  const base = baseBranch || getCurrentBranch();

  // Check if worktree already exists
  if (existsSync(worktreePath)) {
    console.log(`[Worktree] Worktree already exists at ${worktreePath}`);
    return { path: worktreePath, branch: branchName };
  }

  // Check if branch already exists
  let branchExists = false;
  try {
    git(`rev-parse --verify ${branchName}`);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  // Create worktree with new or existing branch
  if (branchExists) {
    git(`worktree add ${worktreePath} ${branchName}`);
  } else {
    git(`worktree add -b ${branchName} ${worktreePath} ${base}`);
  }

  console.log(`[Worktree] Created worktree at ${worktreePath} on branch ${branchName}`);
  return { path: worktreePath, branch: branchName };
}

/**
 * Remove a worktree
 */
export function removeWorktree(worktreePath: string, force: boolean = false): boolean {
  try {
    // Remove the worktree
    git(`worktree remove ${force ? '--force' : ''} ${worktreePath}`);
    console.log(`[Worktree] Removed worktree at ${worktreePath}`);
    return true;
  } catch (error) {
    console.error(`[Worktree] Failed to remove worktree: ${error}`);

    // If normal removal fails and force is requested, try manual cleanup
    if (force && existsSync(worktreePath)) {
      try {
        rmSync(worktreePath, { recursive: true, force: true });
        git('worktree prune');
        console.log(`[Worktree] Force removed worktree at ${worktreePath}`);
        return true;
      } catch (cleanupError) {
        console.error(`[Worktree] Force cleanup failed: ${cleanupError}`);
      }
    }

    return false;
  }
}

/**
 * Clean up all worktrees for an outcome
 */
export function cleanupOutcomeWorktrees(outcomeId: string): number {
  const repoRoot = getRepoRoot();
  const outcomeDir = resolve(repoRoot, WORKTREE_BASE_DIR, outcomeId);

  if (!existsSync(outcomeDir)) {
    return 0;
  }

  const worktrees = listWorktrees();
  let removed = 0;

  for (const wt of worktrees) {
    if (wt.path.includes(`/${outcomeId}/`)) {
      if (removeWorktree(wt.path, true)) {
        removed++;
      }
    }
  }

  // Clean up the outcome directory if empty
  try {
    rmSync(outcomeDir, { recursive: true, force: true });
  } catch {
    // Ignore if not empty
  }

  return removed;
}

/**
 * Get worktree path for a worker
 */
export function getWorktreePath(outcomeId: string, workerId: string): string {
  const repoRoot = getRepoRoot();
  return resolve(repoRoot, WORKTREE_BASE_DIR, outcomeId, workerId);
}

/**
 * Check if a worktree exists
 */
export function worktreeExists(outcomeId: string, workerId: string): boolean {
  const path = getWorktreePath(outcomeId, workerId);
  return existsSync(path);
}

/**
 * Prune stale worktree references
 */
export function pruneWorktrees(): void {
  git('worktree prune');
}
