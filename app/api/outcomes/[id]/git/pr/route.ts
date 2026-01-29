/**
 * Manual PR Creation API
 *
 * POST /api/outcomes/[id]/git/pr - Create a pull request
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { createPullRequest, hasGitHubCLI, isGitHubCLIAuthenticated, git } from '@/lib/git/utils';
import path from 'path';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const outcome = getOutcomeById(id);

    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    if (!outcome.working_directory) {
      return NextResponse.json(
        { error: 'Working directory not configured' },
        { status: 400 }
      );
    }

    if (outcome.git_mode !== 'branch' && outcome.git_mode !== 'worktree') {
      return NextResponse.json(
        { error: 'PR creation requires Branch or Worktree mode' },
        { status: 400 }
      );
    }

    if (!hasGitHubCLI()) {
      return NextResponse.json(
        { error: 'GitHub CLI not installed. Install from https://cli.github.com/' },
        { status: 400 }
      );
    }

    if (!isGitHubCLIAuthenticated()) {
      return NextResponse.json(
        { error: 'Not authenticated with GitHub. Go to Settings to connect.' },
        { status: 400 }
      );
    }

    // Resolve working directory
    const workDir = outcome.working_directory.startsWith('/')
      ? outcome.working_directory
      : path.join(process.cwd(), outcome.working_directory);

    // Make sure we're on the work branch and it's pushed
    if (outcome.work_branch) {
      git(`checkout ${outcome.work_branch}`, workDir);
      git(`push -u origin ${outcome.work_branch}`, workDir);
    }

    // Create the PR
    const result = createPullRequest(
      {
        title: outcome.name,
        body: `## Outcome: ${outcome.name}\n\n${outcome.brief || 'No description provided.'}\n\n---\n*Created by Digital Twin*`,
        baseBranch: outcome.base_branch || 'main',
      },
      workDir
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create PR' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      message: 'Pull request created',
    });
  } catch (error) {
    console.error('[Git PR] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create pull request' },
      { status: 500 }
    );
  }
}
