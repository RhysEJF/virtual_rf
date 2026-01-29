/**
 * Single Project API Route (Legacy)
 *
 * GET /api/projects/[id] - Get project details
 *
 * @deprecated Use /api/outcomes/[id] instead. This route is kept for backwards compatibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProjectById } from '@/lib/db/projects';
import { getWorkersByProject } from '@/lib/db/workers';
import type { LegacyWorker } from '@/lib/db/schema';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const project = getProjectById(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const workers = getWorkersByProject(id);

    // Try to read workspace files
    const workspacePath = join(process.cwd(), 'workspaces', id);
    let progressContent = '';
    let workerLog = '';
    let claudeMd = '';

    if (existsSync(join(workspacePath, 'progress.txt'))) {
      progressContent = readFileSync(join(workspacePath, 'progress.txt'), 'utf-8');
    }
    if (existsSync(join(workspacePath, 'worker.log'))) {
      workerLog = readFileSync(join(workspacePath, 'worker.log'), 'utf-8');
    }
    if (existsSync(join(workspacePath, 'CLAUDE.md'))) {
      claudeMd = readFileSync(join(workspacePath, 'CLAUDE.md'), 'utf-8');
    }

    // Parse PRD
    let prd = null;
    if (project.prd) {
      try {
        prd = JSON.parse(project.prd);
      } catch {
        // PRD might not be valid JSON
      }
    }

    return NextResponse.json({
      project: {
        ...project,
        prdParsed: prd,
      },
      workers: workers.map((w) => {
        // Handle both new and legacy worker formats
        const legacyWorker = w as unknown as LegacyWorker;
        let progress = null;
        if (legacyWorker.progress) {
          try {
            progress = JSON.parse(legacyWorker.progress);
          } catch {
            progress = null;
          }
        }
        return {
          ...w,
          progress,
        };
      }),
      workspace: {
        progress: progressContent,
        log: workerLog,
        instructions: claudeMd,
      },
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}
