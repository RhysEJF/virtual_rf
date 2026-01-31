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
} from '../db/repositories';
import type { OutcomeItemType, Repository } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  target: 'local' | 'repo';
  repository?: string;
  repositoryId?: string;
  error?: string;
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
 * Commit staged changes
 */
function gitCommit(repoPath: string, message: string): boolean {
  const cwd = expandPath(repoPath);
  try {
    execSync(`git commit -m "${message}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    // No changes to commit or other error
    return false;
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
    if (isGitRepo(repo.local_path)) {
      const relativePath = path.relative(expandPath(repo.local_path), destPath);
      gitAdd(repo.local_path, relativePath);

      const commitMsg = options.commitMessage || `Add ${itemType}: ${filename}`;
      const committed = gitCommit(repo.local_path, commitMsg);

      // Push if auto-push is enabled and we committed
      if (committed && (options.push ?? repo.auto_push)) {
        gitPush(repo.local_path);
      }
    }

    // Mark as synced
    markItemSynced(item.id, repo.id);

    return {
      success: true,
      target: 'repo',
      repository: repo.name,
      repositoryId: repo.id,
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
