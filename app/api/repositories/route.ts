/**
 * Repositories API Route
 *
 * GET /api/repositories - List all configured repositories
 * POST /api/repositories - Create a new repository configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllRepositories,
  createRepository,
  type CreateRepositoryInput,
} from '@/lib/db/repositories';
import type { RepositoryType, ContentType } from '@/lib/db/schema';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Validate that a path exists and is a directory
 */
function validateLocalPath(localPath: string): { valid: boolean; error?: string } {
  try {
    const expandedPath = localPath.startsWith('~')
      ? path.join(process.env.HOME || '', localPath.slice(1))
      : localPath;

    if (!fs.existsSync(expandedPath)) {
      return { valid: false, error: 'Path does not exist' };
    }

    const stats = fs.statSync(expandedPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid path' };
  }
}

/**
 * Check if a directory is a git repository
 */
function isGitRepo(localPath: string): boolean {
  try {
    const expandedPath = localPath.startsWith('~')
      ? path.join(process.env.HOME || '', localPath.slice(1))
      : localPath;

    const gitDir = path.join(expandedPath, '.git');
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

/**
 * Get the remote URL of a git repository
 */
function getGitRemoteUrl(localPath: string): string | null {
  try {
    const expandedPath = localPath.startsWith('~')
      ? path.join(process.env.HOME || '', localPath.slice(1))
      : localPath;

    const result = execSync('git config --get remote.origin.url', {
      cwd: expandedPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get the current branch of a git repository
 */
function getGitBranch(localPath: string): string {
  try {
    const expandedPath = localPath.startsWith('~')
      ? path.join(process.env.HOME || '', localPath.slice(1))
      : localPath;

    const result = execSync('git branch --show-current', {
      cwd: expandedPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() || 'main';
  } catch {
    return 'main';
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const repositories = getAllRepositories();

    // Enrich with git status
    const enrichedRepos = repositories.map(repo => {
      const expandedPath = repo.local_path.startsWith('~')
        ? path.join(process.env.HOME || '', repo.local_path.slice(1))
        : repo.local_path;

      const pathExists = fs.existsSync(expandedPath);
      const isGit = pathExists && isGitRepo(repo.local_path);
      const detectedRemote = isGit ? getGitRemoteUrl(repo.local_path) : null;
      const currentBranch = isGit ? getGitBranch(repo.local_path) : repo.branch;

      return {
        ...repo,
        status: {
          pathExists,
          isGitRepo: isGit,
          detectedRemote,
          currentBranch,
          hasRemote: !!repo.repo_url || !!detectedRemote,
        },
      };
    });

    return NextResponse.json({ repositories: enrichedRepos });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch repositories' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, type, content_type, repo_url, local_path, branch, auto_push, require_pr } = body;

    // Validate required fields
    if (!name || !type || !content_type || !local_path) {
      return NextResponse.json(
        { error: 'Missing required fields: name, type, content_type, local_path' },
        { status: 400 }
      );
    }

    // Validate type
    if (type !== 'private' && type !== 'team') {
      return NextResponse.json(
        { error: 'Invalid type. Must be "private" or "team"' },
        { status: 400 }
      );
    }

    // Validate content_type
    const validContentTypes: ContentType[] = ['outputs', 'skills', 'tools', 'files', 'all'];
    if (!validContentTypes.includes(content_type)) {
      return NextResponse.json(
        { error: `Invalid content_type. Must be one of: ${validContentTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate local path
    const pathValidation = validateLocalPath(local_path);
    if (!pathValidation.valid) {
      return NextResponse.json(
        { error: pathValidation.error },
        { status: 400 }
      );
    }

    // Create the repository
    const input: CreateRepositoryInput = {
      name,
      type: type as RepositoryType,
      content_type: content_type as ContentType,
      repo_url: repo_url || undefined,
      local_path,
      branch: branch || 'main',
      auto_push: auto_push !== false,
      require_pr: require_pr === true,
    };

    const repository = createRepository(input);

    return NextResponse.json({
      success: true,
      repository,
    });
  } catch (error) {
    console.error('Error creating repository:', error);
    return NextResponse.json(
      { error: 'Failed to create repository' },
      { status: 500 }
    );
  }
}
