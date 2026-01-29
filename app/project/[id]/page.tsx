'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { Progress } from '@/app/components/ui/Progress';

interface PRDItem {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
}

interface Worker {
  id: string;
  name: string;
  status: string;
  progress: { completed: number; total: number } | null;
}

interface ProjectData {
  project: {
    id: string;
    name: string;
    status: string;
    brief: string | null;
    prd: string | null;
    prdParsed: PRDItem[] | null;
    created_at: number;
    updated_at: number;
  };
  workers: Worker[];
  workspace: {
    progress: string;
    log: string;
    instructions: string;
  };
}

const statusVariants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'default',
  briefing: 'info',
  active: 'success',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
};

export default function ProjectDetailPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [data, setData] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        throw new Error('Project not found');
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
    // Poll for updates every 3 seconds
    const interval = setInterval(fetchProject, 3000);
    return () => clearInterval(interval);
  }, [fetchProject]);

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <p className="text-text-secondary">Loading project...</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <Card padding="lg">
          <CardContent>
            <p className="text-status-error">{error || 'Project not found'}</p>
            <Button variant="secondary" className="mt-4" onClick={() => router.push('/')}>
              ← Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { project, workers, workspace } = data;
  const worker = workers[0]; // Currently supporting single worker
  const progressPercent = worker?.progress
    ? (worker.progress.completed / Math.max(worker.progress.total, 1)) * 100
    : 0;

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-text-tertiary hover:text-text-secondary mb-2"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-semibold text-text-primary">{project.name}</h1>
          <p className="text-text-secondary mt-1">{project.brief}</p>
        </div>
        <Badge variant={statusVariants[project.status] || 'default'}>
          {project.status}
        </Badge>
      </div>

      {/* Progress */}
      {worker && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Worker Progress</CardTitle>
            <Badge variant={statusVariants[worker.status] || 'default'}>
              {worker.status}
            </Badge>
          </CardHeader>
          <CardContent>
            {worker.progress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">
                    {worker.progress.completed} of {worker.progress.total} tasks
                  </span>
                  <span className="text-text-primary font-medium">
                    {Math.round(progressPercent)}%
                  </span>
                </div>
                <Progress value={progressPercent} variant={project.status === 'completed' ? 'success' : 'default'} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* PRD Checklist */}
      {project.prdParsed && Array.isArray(project.prdParsed) && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>PRD Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {project.prdParsed.map((item: PRDItem, index: number) => (
                <li key={item.id || index} className="flex items-start gap-3">
                  <span className={`mt-0.5 ${index < (worker?.progress?.completed || 0) ? 'text-status-success' : 'text-text-tertiary'}`}>
                    {index < (worker?.progress?.completed || 0) ? '✓' : '○'}
                  </span>
                  <div>
                    <p className={`text-sm ${index < (worker?.progress?.completed || 0) ? 'text-text-secondary line-through' : 'text-text-primary'}`}>
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-xs text-text-tertiary mt-0.5">{item.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Workspace Progress */}
      {workspace.progress && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Progress File</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-bg-tertiary p-3 rounded font-mono whitespace-pre-wrap">
              {workspace.progress}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Worker Log */}
      {workspace.log && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Worker Log</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-bg-tertiary p-3 rounded font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
              {workspace.log}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => router.push('/')}>
          ← Back
        </Button>
        {project.status === 'completed' && (
          <Button
            variant="primary"
            onClick={() => {
              // Open workspace folder
              alert(`Check workspace at: workspaces/${project.id}/`);
            }}
          >
            View Output
          </Button>
        )}
      </div>
    </main>
  );
}
