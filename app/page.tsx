'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommandBar } from './components/CommandBar';
import { SystemStatus } from './components/SystemStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { ProjectCard } from './components/ProjectCard';
import { Card, CardContent } from './components/ui/Card';
import type { ProjectWithWorkers } from './api/projects/route';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  projectId?: string;
}

export default function Dashboard(): JSX.Element {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [projects, setProjects] = useState<ProjectWithWorkers[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Fetch projects on mount and after new project created
  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const handleSubmit = useCallback(async (input: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setLoading(true);

    try {
      const response = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.response || data.error || 'No response',
          projectId: data.projectId,
        },
      ]);

      // Refresh projects if a new one was created
      if (data.projectId) {
        fetchProjects();
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [fetchProjects]);

  const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'briefing');
  const completedProjects = projects.filter((p) => p.status === 'completed');
  const activeWorkerCount = projects.reduce((sum, p) =>
    sum + p.workers.filter((w) => w.status === 'running').length, 0
  );

  return (
    <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full p-6 pb-20">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">@virtual_rf</h1>
          <p className="text-text-secondary mt-1">Your personal AI workforce</p>
        </div>
        <ThemeToggle />
      </header>

      {/* Command Bar */}
      <div className="mb-6">
        <CommandBar onSubmit={handleSubmit} loading={loading} />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Column: Conversation */}
        <div className="lg:col-span-2 space-y-4">
          {messages.length > 0 ? (
            <>
              <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
                Conversation
              </h2>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {messages.map((msg, i) => (
                  <Card key={i} padding="md" className={msg.role === 'user' ? 'ml-8' : 'mr-8'}>
                    <CardContent>
                      <div className="text-xs text-text-tertiary mb-1">
                        {msg.role === 'user' ? 'You' : '@virtual_rf'}
                      </div>
                      <div className="text-text-primary whitespace-pre-wrap text-sm">
                        {msg.content}
                      </div>
                      {msg.projectId && (
                        <button
                          onClick={() => router.push(`/project/${msg.projectId}`)}
                          className="mt-2 text-xs text-accent hover:text-accent-hover underline"
                        >
                          View Project →
                        </button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">No conversations yet.</p>
                <p className="text-text-tertiary text-sm">
                  Start by describing what you want to work on. I can help with research, building
                  tools, strategy, and more.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Projects */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            Projects
          </h2>

          {projectsLoading ? (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary text-sm">Loading projects...</p>
              </CardContent>
            </Card>
          ) : projects.length === 0 ? (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary text-sm">
                  No projects yet. Ask me to build something!
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Active Projects */}
              {activeProjects.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs text-text-tertiary font-medium">Active</h3>
                  {activeProjects.map((project) => {
                    const workerProgress = project.workers[0]?.progress;
                    return (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        workerCount={project.workers.length}
                        progress={workerProgress || undefined}
                        onClick={() => router.push(`/project/${project.id}`)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Completed Projects */}
              {completedProjects.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs text-text-tertiary font-medium">Completed</h3>
                  {completedProjects.slice(0, 5).map((project) => {
                    const workerProgress = project.workers[0]?.progress;
                    return (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        workerCount={project.workers.length}
                        progress={workerProgress || undefined}
                        onClick={() => router.push(`/project/${project.id}`)}
                      />
                    );
                  })}
                  {completedProjects.length > 5 && (
                    <p className="text-xs text-text-tertiary">
                      +{completedProjects.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* System Status */}
      <SystemStatus
        activeAgents={activeWorkerCount}
        todayCost={0}
        skillsLoaded={0}
      />
    </main>
  );
}
