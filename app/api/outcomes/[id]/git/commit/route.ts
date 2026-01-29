/**
 * Manual Git Commit API
 *
 * POST /api/outcomes/[id]/git/commit - Commit current changes
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { git } from '@/lib/git/utils';
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

    if (!outcome.working_directory || outcome.git_mode === 'none') {
      return NextResponse.json(
        { error: 'Git integration not configured for this outcome' },
        { status: 400 }
      );
    }

    // Resolve working directory (handle relative paths)
    const workDir = outcome.working_directory.startsWith('/')
      ? outcome.working_directory
      : path.join(process.cwd(), outcome.working_directory);

    // Check for changes
    const statusResult = git('status --porcelain', workDir);
    if (!statusResult.success) {
      return NextResponse.json(
        { error: 'Failed to check git status: ' + statusResult.error },
        { status: 500 }
      );
    }

    if (!statusResult.output.trim()) {
      return NextResponse.json({
        success: true,
        message: 'No changes to commit',
        committed: false,
      });
    }

    // Stage all changes
    const addResult = git('add -A', workDir);
    if (!addResult.success) {
      return NextResponse.json(
        { error: 'Failed to stage changes: ' + addResult.error },
        { status: 500 }
      );
    }

    // Commit with a message
    const timestamp = new Date().toISOString().split('T')[0];
    const commitMessage = `[${outcome.name}] Manual commit - ${timestamp}`;
    const commitResult = git(`commit -m "${commitMessage}"`, workDir);

    if (!commitResult.success) {
      return NextResponse.json(
        { error: 'Failed to commit: ' + commitResult.error },
        { status: 500 }
      );
    }

    // Push if in branch mode
    if (outcome.git_mode === 'branch' || outcome.git_mode === 'worktree') {
      const pushResult = git('push', workDir);
      if (!pushResult.success) {
        // Try with upstream set
        const pushUpstreamResult = git(`push -u origin ${outcome.work_branch || 'HEAD'}`, workDir);
        if (!pushUpstreamResult.success) {
          return NextResponse.json({
            success: true,
            message: 'Committed locally. Push failed: ' + pushUpstreamResult.error,
            committed: true,
            pushed: false,
          });
        }
      }
      return NextResponse.json({
        success: true,
        message: 'Changes committed and pushed',
        committed: true,
        pushed: true,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Changes committed locally',
      committed: true,
      pushed: false,
    });
  } catch (error) {
    console.error('[Git Commit] Error:', error);
    return NextResponse.json(
      { error: 'Failed to commit changes' },
      { status: 500 }
    );
  }
}
