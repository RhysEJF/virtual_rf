/**
 * Git Utilities
 *
 * Common git operations for outcome git integration.
 * Uses the user's existing git authentication (SSH keys, credential helpers).
 */

import { execSync } from 'child_process';

// ============================================================================
// Core Git Execution
// ============================================================================

export interface GitResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Execute a git command and return the result
 */
export function git(command: string, cwd?: string): GitResult {
  try {
    const output = execSync(`git ${command}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { success: true, output };
  } catch (error) {
    const err = error as { stderr?: Buffer; stdout?: Buffer; message: string };
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}

/**
 * Execute a git command, throwing on error
 */
export function gitOrThrow(command: string, cwd?: string): string {
  const result = git(command, cwd);
  if (!result.success) {
    throw new Error(result.error || 'Git command failed');
  }
  return result.output;
}

// ============================================================================
// Repository Detection
// ============================================================================

/**
 * Check if a path is inside a git repository
 */
export function isGitRepo(path?: string): boolean {
  const result = git('rev-parse --git-dir', path);
  return result.success;
}

/**
 * Get the root directory of the git repository
 */
export function getRepoRoot(path?: string): string | null {
  const result = git('rev-parse --show-toplevel', path);
  return result.success ? result.output : null;
}

/**
 * Get the remote URL (origin)
 */
export function getRemoteUrl(path?: string): string | null {
  const result = git('remote get-url origin', path);
  return result.success ? result.output : null;
}

/**
 * Check if the repo has a remote configured
 */
export function hasRemote(path?: string): boolean {
  const result = git('remote', path);
  return result.success && result.output.length > 0;
}

// ============================================================================
// Branch Operations
// ============================================================================

/**
 * Get the current branch name
 */
export function getCurrentBranch(path?: string): string | null {
  const result = git('rev-parse --abbrev-ref HEAD', path);
  return result.success ? result.output : null;
}

/**
 * Get the default branch (main or master)
 */
export function getDefaultBranch(path?: string): string {
  // Try to get from remote
  const result = git('symbolic-ref refs/remotes/origin/HEAD --short', path);
  if (result.success) {
    return result.output.replace('origin/', '');
  }

  // Fall back to checking if main or master exists
  const mainResult = git('rev-parse --verify main', path);
  if (mainResult.success) return 'main';

  const masterResult = git('rev-parse --verify master', path);
  if (masterResult.success) return 'master';

  return 'main'; // Default assumption
}

/**
 * List all local branches
 */
export function listBranches(path?: string): string[] {
  const result = git('branch --format="%(refname:short)"', path);
  if (!result.success) return [];
  return result.output.split('\n').filter(b => b.length > 0);
}

/**
 * Check if a branch exists
 */
export function branchExists(branchName: string, path?: string): boolean {
  const result = git(`rev-parse --verify ${branchName}`, path);
  return result.success;
}

/**
 * Create a new branch from a base
 */
export function createBranch(
  branchName: string,
  baseBranch?: string,
  path?: string
): GitResult {
  const base = baseBranch || getDefaultBranch(path);
  return git(`checkout -b ${branchName} ${base}`, path);
}

/**
 * Switch to an existing branch
 */
export function switchBranch(branchName: string, path?: string): GitResult {
  return git(`checkout ${branchName}`, path);
}

/**
 * Delete a branch
 */
export function deleteBranch(
  branchName: string,
  force: boolean = false,
  path?: string
): GitResult {
  const flag = force ? '-D' : '-d';
  return git(`branch ${flag} ${branchName}`, path);
}

// ============================================================================
// Commit Operations
// ============================================================================

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  filesChanged: number;
}

/**
 * Get commits on current branch not pushed to remote
 */
export function getUnpushedCommits(path?: string): CommitInfo[] {
  const branch = getCurrentBranch(path);
  if (!branch) return [];

  // Check if upstream exists
  const upstreamResult = git(`rev-parse --abbrev-ref ${branch}@{upstream}`, path);
  if (!upstreamResult.success) {
    // No upstream, get all commits on this branch
    const defaultBranch = getDefaultBranch(path);
    if (branch === defaultBranch) return [];

    // Get commits since branching from default
    const result = git(
      `log ${defaultBranch}..HEAD --format="%H|%h|%s|%an|%ad" --date=short`,
      path
    );
    if (!result.success) return [];
    return parseCommitLog(result.output);
  }

  // Get commits ahead of upstream
  const result = git(
    `log @{upstream}..HEAD --format="%H|%h|%s|%an|%ad" --date=short`,
    path
  );
  if (!result.success) return [];
  return parseCommitLog(result.output);
}

/**
 * Get recent commits
 */
export function getRecentCommits(limit: number = 10, path?: string): CommitInfo[] {
  const result = git(
    `log -${limit} --format="%H|%h|%s|%an|%ad" --date=short`,
    path
  );
  if (!result.success) return [];
  return parseCommitLog(result.output);
}

function parseCommitLog(output: string): CommitInfo[] {
  if (!output.trim()) return [];

  return output.split('\n').filter(line => line.trim()).map(line => {
    const [hash, shortHash, subject, author, date] = line.split('|');
    return {
      hash,
      shortHash,
      subject,
      author,
      date,
      filesChanged: 0, // Would need another call to get this
    };
  });
}

// ============================================================================
// Status Operations
// ============================================================================

export interface RepoStatus {
  isRepo: boolean;
  branch: string | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  isClean: boolean;
  hasUncommittedChanges: boolean;
  untrackedFiles: number;
  modifiedFiles: number;
  stagedFiles: number;
  unpushedCommits: number;
  behindRemote: number;
  aheadOfRemote: number;
}

/**
 * Get comprehensive repository status
 */
export function getRepoStatus(path?: string): RepoStatus {
  if (!isGitRepo(path)) {
    return {
      isRepo: false,
      branch: null,
      hasRemote: false,
      remoteUrl: null,
      isClean: true,
      hasUncommittedChanges: false,
      untrackedFiles: 0,
      modifiedFiles: 0,
      stagedFiles: 0,
      unpushedCommits: 0,
      behindRemote: 0,
      aheadOfRemote: 0,
    };
  }

  const branch = getCurrentBranch(path);
  const remote = getRemoteUrl(path);

  // Get status counts
  const statusResult = git('status --porcelain', path);
  const statusLines = statusResult.success ? statusResult.output.split('\n').filter(l => l) : [];

  const untrackedFiles = statusLines.filter(l => l.startsWith('??')).length;
  const modifiedFiles = statusLines.filter(l => l[1] === 'M' || l[0] === 'M').length;
  const stagedFiles = statusLines.filter(l => l[0] !== ' ' && l[0] !== '?').length;

  // Get ahead/behind counts
  let behindRemote = 0;
  let aheadOfRemote = 0;

  if (branch && hasRemote(path)) {
    // Fetch to get latest remote state (non-blocking)
    git('fetch --quiet', path);

    const aheadBehindResult = git(`rev-list --left-right --count ${branch}...@{upstream}`, path);
    if (aheadBehindResult.success) {
      const [ahead, behind] = aheadBehindResult.output.split('\t').map(Number);
      aheadOfRemote = ahead || 0;
      behindRemote = behind || 0;
    }
  }

  const unpushedCommits = getUnpushedCommits(path).length;

  return {
    isRepo: true,
    branch,
    hasRemote: hasRemote(path),
    remoteUrl: remote,
    isClean: statusLines.length === 0,
    hasUncommittedChanges: statusLines.length > 0,
    untrackedFiles,
    modifiedFiles,
    stagedFiles,
    unpushedCommits,
    behindRemote,
    aheadOfRemote,
  };
}

// ============================================================================
// Push Operations
// ============================================================================

/**
 * Push current branch to remote
 */
export function push(
  setUpstream: boolean = false,
  path?: string
): GitResult {
  const branch = getCurrentBranch(path);
  if (!branch) {
    return { success: false, output: '', error: 'Not on a branch' };
  }

  const args = setUpstream ? `-u origin ${branch}` : '';
  return git(`push ${args}`, path);
}

/**
 * Push specific branch to remote
 */
export function pushBranch(
  branchName: string,
  setUpstream: boolean = false,
  path?: string
): GitResult {
  const args = setUpstream ? `-u origin ${branchName}` : `origin ${branchName}`;
  return git(`push ${args}`, path);
}

// ============================================================================
// PR Operations (via GitHub CLI)
// ============================================================================

/**
 * Check if GitHub CLI is available
 */
export function hasGitHubCLI(): boolean {
  try {
    execSync('gh --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if authenticated with GitHub CLI
 */
export function isGitHubCLIAuthenticated(): boolean {
  try {
    execSync('gh auth status', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export interface CreatePROptions {
  title: string;
  body: string;
  baseBranch?: string;
  draft?: boolean;
}

export interface PRResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Create a pull request using GitHub CLI
 */
export function createPullRequest(
  options: CreatePROptions,
  path?: string
): PRResult {
  if (!hasGitHubCLI()) {
    return { success: false, error: 'GitHub CLI (gh) not installed' };
  }

  if (!isGitHubCLIAuthenticated()) {
    return { success: false, error: 'Not authenticated with GitHub CLI. Run: gh auth login' };
  }

  const { title, body, baseBranch, draft } = options;
  const args = [
    'pr', 'create',
    '--title', `"${title.replace(/"/g, '\\"')}"`,
    '--body', `"${body.replace(/"/g, '\\"')}"`,
  ];

  if (baseBranch) {
    args.push('--base', baseBranch);
  }

  if (draft) {
    args.push('--draft');
  }

  try {
    const output = execSync(`gh ${args.join(' ')}`, {
      cwd: path || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // The output should be the PR URL
    const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
    return {
      success: true,
      url: urlMatch ? urlMatch[0] : output,
    };
  } catch (error) {
    const err = error as { stderr?: Buffer; message: string };
    return {
      success: false,
      error: err.stderr?.toString() || err.message,
    };
  }
}

// ============================================================================
// Merge Operations
// ============================================================================

/**
 * Merge a branch into the current branch
 */
export function mergeBranch(
  branchName: string,
  noFastForward: boolean = false,
  path?: string
): GitResult {
  const args = noFastForward ? `--no-ff ${branchName}` : branchName;
  return git(`merge ${args}`, path);
}

/**
 * Rebase current branch onto another branch
 */
export function rebase(baseBranch: string, path?: string): GitResult {
  return git(`rebase ${baseBranch}`, path);
}

/**
 * Abort an in-progress rebase
 */
export function rebaseAbort(path?: string): GitResult {
  return git('rebase --abort', path);
}
