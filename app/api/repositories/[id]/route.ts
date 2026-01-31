/**
 * Repository Detail API
 *
 * GET /api/repositories/[id] - Get repository details
 * PUT /api/repositories/[id] - Update repository
 * DELETE /api/repositories/[id] - Delete repository
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRepositoryById,
  updateRepository,
  deleteRepository,
  isRepositoryInUse,
  getOutcomesUsingRepository,
} from '@/lib/db/repositories';
import fs from 'fs';
import path from 'path';

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
 * Get remote URL from a git repository
 */
function getRemoteUrl(repoPath: string): string | null {
  try {
    const { execSync } = require('child_process');
    const cwd = expandPath(repoPath);
    const result = execSync('git remote get-url origin 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/repositories/[id]
 * Get repository details with git status
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const repo = getRepositoryById(id);

    if (!repo) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    // Enrich with git status
    const expandedPath = expandPath(repo.local_path);
    const exists = fs.existsSync(expandedPath);
    const isGit = exists && isGitRepo(repo.local_path);
    const detectedRemote = isGit ? getRemoteUrl(repo.local_path) : null;

    // Get outcomes using this repo
    const usedBy = getOutcomesUsingRepository(repo.id);

    return NextResponse.json({
      repository: {
        ...repo,
        status: {
          exists,
          isGitRepo: isGit,
          detectedRemoteUrl: detectedRemote,
          matchesConfiguredRemote: detectedRemote === repo.remote_url,
        },
        usedBy,
        inUse: usedBy.length > 0,
      },
    });
  } catch (error) {
    console.error('[Repositories API] Error getting:', error);
    return NextResponse.json(
      { error: 'Failed to get repository' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/repositories/[id]
 * Update repository
 *
 * Body: {
 *   name?: string,
 *   local_path?: string,
 *   remote_url?: string,
 *   auto_push?: boolean
 * }
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const existing = getRepositoryById(id);

    if (!existing) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, local_path, remote_url, auto_push } = body;

    // If changing local_path, validate it
    if (local_path && local_path !== existing.local_path) {
      const expandedPath = expandPath(local_path);
      if (!fs.existsSync(expandedPath)) {
        return NextResponse.json(
          { error: `Path does not exist: ${local_path}` },
          { status: 400 }
        );
      }
      if (!isGitRepo(local_path)) {
        return NextResponse.json(
          { error: `Path is not a git repository: ${local_path}` },
          { status: 400 }
        );
      }
    }

    const updated = updateRepository(id, {
      name,
      local_path,
      remote_url,
      auto_push,
    });

    return NextResponse.json({ repository: updated });
  } catch (error) {
    console.error('[Repositories API] Error updating:', error);
    return NextResponse.json(
      { error: 'Failed to update repository' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/repositories/[id]
 * Delete repository
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const existing = getRepositoryById(id);

    if (!existing) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    // Check if in use
    if (isRepositoryInUse(id)) {
      const usedBy = getOutcomesUsingRepository(id);
      return NextResponse.json(
        {
          error: 'Repository is in use by outcomes',
          usedBy,
        },
        { status: 409 }
      );
    }

    deleteRepository(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Repositories API] Error deleting:', error);
    return NextResponse.json(
      { error: 'Failed to delete repository' },
      { status: 500 }
    );
  }
}
