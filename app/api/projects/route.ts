/**
 * Projects API Route
 *
 * GET /api/projects - List all projects
 * POST /api/projects - Create a new project (handled by dispatch)
 */

import { NextResponse } from 'next/server';
import { getAllProjects, getActiveProjects } from '@/lib/db/projects';
import { getWorkersByProject } from '@/lib/db/workers';
import type { ProjectStatus, WorkerStatus } from '@/lib/db/schema';

export interface ProjectWithWorkers {
  id: string;
  name: string;
  status: ProjectStatus;
  brief: string | null;
  prd: string | null;
  created_at: number;
  updated_at: number;
  workers: {
    id: string;
    name: string;
    status: WorkerStatus;
    progress: { completed: number; total: number } | null;
  }[];
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter'); // 'active' or 'all'

    const projects = filter === 'active' ? getActiveProjects() : getAllProjects();

    // Enrich with worker info
    const projectsWithWorkers: ProjectWithWorkers[] = projects.map((project) => {
      const workers = getWorkersByProject(project.id);
      return {
        ...project,
        workers: workers.map((w) => ({
          id: w.id,
          name: w.name,
          status: w.status,
          progress: w.progress ? JSON.parse(w.progress) : null,
        })),
      };
    });

    return NextResponse.json({ projects: projectsWithWorkers });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
