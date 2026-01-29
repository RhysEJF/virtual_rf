/**
 * Git Status API
 *
 * GET /api/git/status - Get repository status for a path
 * GET /api/git/status?path=/some/path - Get status for specific path
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getRepoStatus,
  getUnpushedCommits,
  listBranches,
  getDefaultBranch,
  hasGitHubCLI,
  isGitHubCLIAuthenticated,
} from '@/lib/git/utils';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || process.cwd();

    const status = getRepoStatus(path);

    if (!status.isRepo) {
      return NextResponse.json({
        isRepo: false,
        message: 'Not a git repository',
      });
    }

    const branches = listBranches(path);
    const defaultBranch = getDefaultBranch(path);
    const unpushedCommits = getUnpushedCommits(path);
    const ghCliAvailable = hasGitHubCLI();
    const ghCliAuthenticated = ghCliAvailable ? isGitHubCLIAuthenticated() : false;

    return NextResponse.json({
      ...status,
      branches,
      defaultBranch,
      unpushedCommits,
      githubCli: {
        available: ghCliAvailable,
        authenticated: ghCliAuthenticated,
      },
    });
  } catch (error) {
    console.error('[Git Status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get git status' },
      { status: 500 }
    );
  }
}
