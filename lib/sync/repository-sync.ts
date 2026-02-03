/**
 * Repository Sync Logic
 *
 * Handles syncing skills, tools, files, and outputs to configured repositories.
 * Supports inheritance - resolves effective repository through outcome hierarchy.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getOutcomeById } from '../db/outcomes';
import {
  getEffectiveRepository,
  getEffectiveRepoSettings,
  upsertOutcomeItem,
  markItemSynced,
  markItemUnsynced,
  getOutcomeItem,
  updateOutcomeItem,
  getRepositoryById,
  upsertItemRepoSync,
  deleteItemRepoSync,
  getItemRepoSyncsWithDetails,
  getAllRepositories,
  getItemRepoSyncByKey,
} from '../db/repositories';
import type { OutcomeItemType, Repository, ItemRepoSync, SyncStatus } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  target: 'local' | 'repo';
  repository?: string;
  repositoryId?: string;
  error?: string;
  commitHash?: string;
}

export interface MultiRepoSyncResult {
  repoId: string;
  repoName: string;
  success: boolean;
  error?: string;
  commitHash?: string;
}

export interface SyncOptions {
  commitMessage?: string;
  push?: boolean;
}

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Expand ~ to home directory
 */
function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(process.env.HOME || '', p.slice(1));
  }
  return p;
}

/**
 * Get the destination path for an item in a repository
 */
function getDestinationPath(
  repo: Repository,
  itemType: OutcomeItemType,
  filename: string
): string {
  const basePath = expandPath(repo.local_path);

  // Map item types to folders
  const folders: Record<OutcomeItemType, string> = {
    output: 'outputs',
    skill: 'skills',
    tool: 'tools',
    file: 'files',
  };

  const folder = folders[itemType];
  return path.join(basePath, folder, filename);
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Check if a path is a git repository
 */
function isGitRepo(repoPath: string): boolean {
  try {
    const gitDir = path.join(expandPath(repoPath), '.git');
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

/**
 * Stage a file in git
 */
function gitAdd(repoPath: string, filePath: string): void {
  const cwd = expandPath(repoPath);
  execSync(`git add "${filePath}"`, { cwd, stdio: 'pipe' });
}

/**
 * Commit staged changes and return commit hash
 */
function gitCommit(repoPath: string, message: string): { committed: boolean; hash?: string } {
  const cwd = expandPath(repoPath);
  try {
    execSync(`git commit -m "${message}"`, { cwd, stdio: 'pipe' });
    // Get the commit hash
    const hash = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();
    return { committed: true, hash };
  } catch {
    // No changes to commit or other error
    return { committed: false };
  }
}

/**
 * Get current HEAD commit hash
 */
function getHeadCommit(repoPath: string): string | null {
  const cwd = expandPath(repoPath);
  try {
    return execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Push to remote
 */
function gitPush(repoPath: string): boolean {
  const cwd = expandPath(repoPath);
  try {
    execSync('git push', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Core Sync Functions
// ============================================================================

/**
 * Sync a single item to its target repository
 */
export async function syncItem(
  outcomeId: string,
  itemType: OutcomeItemType,
  filename: string,
  sourcePath: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  try {
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return { success: false, target: 'local', error: 'Outcome not found' };
    }

    // Get or create the item record
    const item = upsertOutcomeItem({
      outcome_id: outcomeId,
      item_type: itemType,
      filename,
      file_path: sourcePath,
    });

    // Get effective settings (resolves inheritance)
    const settings = getEffectiveRepoSettings(outcomeId);

    // Determine if this content type should go to repo
    const targetKey = `${itemType}_target` as 'output_target' | 'skill_target' | 'tool_target' | 'file_target';
    const target = settings[targetKey];

    // If local, nothing to sync
    if (target === 'local' || !settings.repository) {
      return { success: true, target: 'local' };
    }

    const repo = settings.repository;

    // Check source file exists
    if (!fs.existsSync(sourcePath)) {
      return { success: false, target: 'repo', error: 'Source file not found' };
    }

    // Get destination path and ensure directory exists
    const destPath = getDestinationPath(repo, itemType, filename);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy the file
    fs.copyFileSync(sourcePath, destPath);

    // Git operations if repo is a git repo
    let commitHash: string | undefined;
    if (isGitRepo(repo.local_path)) {
      const relativePath = path.relative(expandPath(repo.local_path), destPath);
      gitAdd(repo.local_path, relativePath);

      const commitMsg = options.commitMessage || `Add ${itemType}: ${filename}`;
      const commitResult = gitCommit(repo.local_path, commitMsg);

      // Push if auto-push is enabled and we committed
      if (commitResult.committed && (options.push ?? repo.auto_push)) {
        gitPush(repo.local_path);
      }
      commitHash = commitResult.hash;
    }

    // Mark as synced (legacy - for backwards compatibility)
    markItemSynced(item.id, repo.id);

    // Also record in junction table for multi-repo support
    upsertItemRepoSync({
      item_id: item.id,
      repo_id: repo.id,
      synced_at: Date.now(),
      commit_hash: commitHash,
      sync_status: 'synced',
    });

    return {
      success: true,
      target: 'repo',
      repository: repo.name,
      repositoryId: repo.id,
      commitHash,
    };
  } catch (error) {
    console.error('[Sync] Error syncing item:', error);
    return {
      success: false,
      target: 'local',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sync a skill to its configured repository
 */
export async function syncSkill(
  outcomeId: string,
  skillPath: string
): Promise<SyncResult> {
  const filename = path.basename(skillPath);
  return syncItem(outcomeId, 'skill', filename, skillPath);
}

/**
 * Sync a tool to its configured repository
 */
export async function syncTool(
  outcomeId: string,
  toolPath: string
): Promise<SyncResult> {
  const filename = path.basename(toolPath);
  return syncItem(outcomeId, 'tool', filename, toolPath);
}

/**
 * Sync a file to its configured repository
 */
export async function syncFile(
  outcomeId: string,
  filePath: string
): Promise<SyncResult> {
  const filename = path.basename(filePath);
  return syncItem(outcomeId, 'file', filename, filePath);
}

/**
 * Sync an output to its configured repository
 */
export async function syncOutput(
  outcomeId: string,
  outputPath: string
): Promise<SyncResult> {
  const filename = path.basename(outputPath);
  return syncItem(outcomeId, 'output', filename, outputPath);
}

// ============================================================================
// Auto-Sync Hook
// ============================================================================

/**
 * Called when a skill is built by a worker
 * If auto_save is enabled, syncs to configured repository
 */
export async function onSkillBuilt(
  outcomeId: string,
  skillPath: string
): Promise<SyncResult | null> {
  const settings = getEffectiveRepoSettings(outcomeId);

  // Check if auto-save is enabled
  if (!settings.auto_save) {
    console.log('[Sync] Auto-save disabled, skipping skill sync');
    return null;
  }

  console.log(`[Sync] Auto-syncing skill: ${skillPath}`);
  return syncSkill(outcomeId, skillPath);
}

/**
 * Called when a tool is built by a worker
 * If auto_save is enabled, syncs to configured repository
 */
export async function onToolBuilt(
  outcomeId: string,
  toolPath: string
): Promise<SyncResult | null> {
  const settings = getEffectiveRepoSettings(outcomeId);

  if (!settings.auto_save) {
    console.log('[Sync] Auto-save disabled, skipping tool sync');
    return null;
  }

  console.log(`[Sync] Auto-syncing tool: ${toolPath}`);
  return syncTool(outcomeId, toolPath);
}

// ============================================================================
// Manual Promotion
// ============================================================================

/**
 * Manually promote an item to repo or demote to local
 */
export async function promoteItem(
  outcomeId: string,
  itemType: OutcomeItemType,
  filename: string,
  newTarget: 'local' | 'repo'
): Promise<SyncResult> {
  try {
    // Get the existing item
    const item = getOutcomeItem(outcomeId, itemType, filename);
    if (!item) {
      return { success: false, target: newTarget, error: 'Item not found' };
    }

    // Update the target override
    updateOutcomeItem(item.id, { target_override: newTarget });

    // If new target is local, we're done (just mark as unsynced)
    if (newTarget === 'local') {
      markItemUnsynced(item.id);
      return { success: true, target: 'local' };
    }

    // Get effective repository
    const repo = getEffectiveRepository(outcomeId);
    if (!repo) {
      return {
        success: false,
        target: 'repo',
        error: 'No repository configured for this outcome',
      };
    }

    // Sync to the repository
    return syncItem(outcomeId, itemType, filename, item.file_path, {
      commitMessage: `Promote ${itemType}: ${filename}`,
    });
  } catch (error) {
    console.error('[Sync] Error promoting item:', error);
    return {
      success: false,
      target: newTarget,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Multi-Repository Sync Functions
// ============================================================================

/**
 * Sync an item to multiple repositories
 * Used for multi-destination syncing where an item needs to go to specific repos
 */
export async function syncItemToRepos(
  outcomeId: string,
  itemType: OutcomeItemType,
  filename: string,
  repoIds: string[]
): Promise<MultiRepoSyncResult[]> {
  const results: MultiRepoSyncResult[] = [];

  // Get or create the item record
  const item = getOutcomeItem(outcomeId, itemType, filename);
  if (!item) {
    // Return failure for all repos
    for (const repoId of repoIds) {
      const repo = getRepositoryById(repoId);
      results.push({
        repoId,
        repoName: repo?.name || 'Unknown',
        success: false,
        error: 'Item not found',
      });
    }
    return results;
  }

  // Check source file exists
  if (!fs.existsSync(item.file_path)) {
    for (const repoId of repoIds) {
      const repo = getRepositoryById(repoId);
      results.push({
        repoId,
        repoName: repo?.name || 'Unknown',
        success: false,
        error: 'Source file not found',
      });
    }
    return results;
  }

  // Sync to each repository
  for (const repoId of repoIds) {
    const repo = getRepositoryById(repoId);
    if (!repo) {
      results.push({
        repoId,
        repoName: 'Unknown',
        success: false,
        error: 'Repository not found',
      });
      continue;
    }

    try {
      // Get destination path and ensure directory exists
      const destPath = getDestinationPath(repo, itemType, filename);
      const destDir = path.dirname(destPath);

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Copy the file
      fs.copyFileSync(item.file_path, destPath);

      // Git operations if repo is a git repo
      let commitHash: string | undefined;
      if (isGitRepo(repo.local_path)) {
        const relativePath = path.relative(expandPath(repo.local_path), destPath);
        gitAdd(repo.local_path, relativePath);

        const commitMsg = `Sync ${itemType}: ${filename}`;
        const commitResult = gitCommit(repo.local_path, commitMsg);

        if (commitResult.committed && repo.auto_push) {
          gitPush(repo.local_path);
        }
        commitHash = commitResult.hash;
      }

      // Record in junction table
      upsertItemRepoSync({
        item_id: item.id,
        repo_id: repo.id,
        synced_at: Date.now(),
        commit_hash: commitHash,
        sync_status: 'synced',
      });

      results.push({
        repoId: repo.id,
        repoName: repo.name,
        success: true,
        commitHash,
      });
    } catch (error) {
      // Record failure in junction table
      upsertItemRepoSync({
        item_id: item.id,
        repo_id: repo.id,
        synced_at: Date.now(),
        sync_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });

      results.push({
        repoId: repo.id,
        repoName: repo.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Remove an item's sync from a specific repository
 * Does NOT delete the file from the repo - just removes the tracking
 */
export async function unsyncItemFromRepo(
  outcomeId: string,
  itemType: OutcomeItemType,
  filename: string,
  repoId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const item = getOutcomeItem(outcomeId, itemType, filename);
    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    // Delete the junction table record
    const deleted = deleteItemRepoSync(item.id, repoId);
    if (!deleted) {
      return { success: false, error: 'Sync record not found' };
    }

    // Also update legacy synced_to if it matches
    if (item.synced_to === repoId) {
      markItemUnsynced(item.id);
    }

    return { success: true };
  } catch (error) {
    console.error('[Sync] Error unsyncing item from repo:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get complete sync status for an item
 * Returns all repos it's synced to plus available repos
 */
export function getItemSyncStatusFull(
  outcomeId: string,
  itemType: OutcomeItemType,
  filename: string
): {
  item: { id: string; filename: string; file_path: string } | null;
  syncs: { repo_id: string; repo_name: string; synced_at: number; sync_status: SyncStatus; commit_hash: string | null }[];
  available_repos: { id: string; name: string; local_path: string }[];
} {
  const item = getOutcomeItem(outcomeId, itemType, filename);
  if (!item) {
    return { item: null, syncs: [], available_repos: getAllRepositories() };
  }

  const syncDetails = getItemRepoSyncsWithDetails(item.id);
  const syncedRepoIds = new Set(syncDetails.map(s => s.repo_id));
  const allRepos = getAllRepositories();

  return {
    item: { id: item.id, filename: item.filename, file_path: item.file_path },
    syncs: syncDetails.map(s => ({
      repo_id: s.repo_id,
      repo_name: s.repo_name,
      synced_at: s.synced_at,
      sync_status: s.sync_status,
      commit_hash: s.commit_hash,
    })),
    available_repos: allRepos.filter(r => !syncedRepoIds.has(r.id)).map(r => ({
      id: r.id,
      name: r.name,
      local_path: r.local_path,
    })),
  };
}
