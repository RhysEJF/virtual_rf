/**
 * Repositories API
 *
 * GET /api/repositories - List all repositories
 * POST /api/repositories - Create a new repository
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllRepositories,
  createRepository,
  isRepositoryInUse,
  getOutcomesUsingRepository,
} from '@/lib/db/repositories';
import fs from 'fs';
import path from 'path';

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
 * GET /api/repositories
 * List all repositories with git status
 */
export async function GET(): Promise<NextResponse> {
  try {
    const repositories = getAllRepositories();

    // Enrich with git status
    const enriched = repositories.map((repo) => {
      const expandedPath = expandPath(repo.local_path);
      const exists = fs.existsSync(expandedPath);
      const isGit = exists && isGitRepo(repo.local_path);
      const detectedRemote = isGit ? getRemoteUrl(repo.local_path) : null;

      // Get outcomes using this repo
      const usedBy = getOutcomesUsingRepository(repo.id);

      return {
        ...repo,
        status: {
          exists,
          isGitRepo: isGit,
          detectedRemoteUrl: detectedRemote,
          matchesConfiguredRemote: detectedRemote === repo.remote_url,
        },
        usedBy,
        inUse: usedBy.length > 0,
      };
    });

    return NextResponse.json({ repositories: enriched });
  } catch (error) {
    console.error('[Repositories API] Error listing:', error);
    return NextResponse.json(
      { error: 'Failed to list repositories' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/repositories
 * Create a new repository
 *
 * Body: {
 *   name: string,
 *   local_path: string,
 *   remote_url?: string,
 *   auto_push?: boolean
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, local_path, remote_url, auto_push } = body;

    // Validate required fields
    if (!name || !local_path) {
      return NextResponse.json(
        { error: 'name and local_path are required' },
        { status: 400 }
      );
    }

    // Check if path exists
    const expandedPath = expandPath(local_path);
    if (!fs.existsSync(expandedPath)) {
      return NextResponse.json(
        { error: `Path does not exist: ${local_path}` },
        { status: 400 }
      );
    }

    // Check if it's a git repo
    if (!isGitRepo(local_path)) {
      return NextResponse.json(
        { error: `Path is not a git repository: ${local_path}` },
        { status: 400 }
      );
    }

    // Create the repository
    const repo = createRepository({
      name,
      local_path,
      remote_url: remote_url || undefined,
      auto_push: auto_push !== false,
    });

    return NextResponse.json({ repository: repo }, { status: 201 });
  } catch (error) {
    console.error('[Repositories API] Error creating:', error);
    return NextResponse.json(
      { error: 'Failed to create repository' },
      { status: 500 }
    );
  }
}
