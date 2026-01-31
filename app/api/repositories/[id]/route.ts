/**
 * Individual Repository API Route
 *
 * GET /api/repositories/[id] - Get repository details
 * PUT /api/repositories/[id] - Update repository configuration
 * DELETE /api/repositories/[id] - Delete repository configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRepositoryById,
  updateRepository,
  deleteRepository,
  type UpdateRepositoryInput,
} from '@/lib/db/repositories';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const repository = getRepositoryById(id);

    if (!repository) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    // Enrich with git status
    const expandedPath = repository.local_path.startsWith('~')
      ? path.join(process.env.HOME || '', repository.local_path.slice(1))
      : repository.local_path;

    const pathExists = fs.existsSync(expandedPath);
    const isGit = pathExists && isGitRepo(repository.local_path);
    const detectedRemote = isGit ? getGitRemoteUrl(repository.local_path) : null;
    const currentBranch = isGit ? getGitBranch(repository.local_path) : repository.branch;

    return NextResponse.json({
      repository: {
        ...repository,
        status: {
          pathExists,
          isGitRepo: isGit,
          detectedRemote,
          currentBranch,
          hasRemote: !!repository.repo_url || !!detectedRemote,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching repository:', error);
    return NextResponse.json(
      { error: 'Failed to fetch repository' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = getRepositoryById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    const { name, repo_url, local_path, branch, auto_push, require_pr } = body;

    // Validate local path if provided
    if (local_path) {
      const expandedPath = local_path.startsWith('~')
        ? path.join(process.env.HOME || '', local_path.slice(1))
        : local_path;

      if (!fs.existsSync(expandedPath)) {
        return NextResponse.json(
          { error: 'Path does not exist' },
          { status: 400 }
        );
      }
    }

    const input: UpdateRepositoryInput = {};
    if (name !== undefined) input.name = name;
    if (repo_url !== undefined) input.repo_url = repo_url;
    if (local_path !== undefined) input.local_path = local_path;
    if (branch !== undefined) input.branch = branch;
    if (auto_push !== undefined) input.auto_push = auto_push;
    if (require_pr !== undefined) input.require_pr = require_pr;

    const repository = updateRepository(id, input);

    return NextResponse.json({
      success: true,
      repository,
    });
  } catch (error) {
    console.error('Error updating repository:', error);
    return NextResponse.json(
      { error: 'Failed to update repository' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const existing = getRepositoryById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    const deleted = deleteRepository(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete repository' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Repository deleted',
    });
  } catch (error) {
    console.error('Error deleting repository:', error);
    return NextResponse.json(
      { error: 'Failed to delete repository' },
      { status: 500 }
    );
  }
}
