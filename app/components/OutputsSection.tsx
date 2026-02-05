'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from '../hooks/useToast';

// ============================================================================
// Types
// ============================================================================

interface OutputAction {
  id: string;
  label: string;
  type: 'view' | 'run' | 'open' | 'download';
  endpoint?: string;
  url?: string;
}

interface DetectedOutput {
  id: string;
  type: 'app' | 'research' | 'document' | 'data' | 'asset' | 'unknown';
  name: string;
  path: string;
  description: string;
  actions: OutputAction[];
  metadata: Record<string, unknown>;
}

interface DetectedApp {
  id: string;
  type: 'node' | 'static';
  name: string;
  path: string;
  absolutePath: string;
  framework?: string;
  entryPoint: string;
  scripts?: {
    dev?: boolean;
    start?: boolean;
    build?: boolean;
  };
}

interface RunningServer {
  id: string;
  outcomeId: string;
  appId: string;
  type: 'node' | 'static';
  pid: number;
  port: number;
  url: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
}

interface OutputsData {
  outputs: DetectedOutput[];
  summary: {
    apps: number;
    documents: number;
    research: number;
    total: number;
  };
  workspace: {
    path: string;
    exists: boolean;
  };
  server: RunningServer | null; // Legacy
}

interface AppServerData {
  apps: DetectedApp[];
  servers: RunningServer[];
  hasRunningServers: boolean;
}

// ============================================================================
// Component
// ============================================================================

interface OutputsSectionProps {
  outcomeId: string;
}

export function OutputsSection({ outcomeId }: OutputsSectionProps): JSX.Element | null {
  const { toast } = useToast();
  const [data, setData] = useState<OutputsData | null>(null);
  const [appData, setAppData] = useState<AppServerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [serverLoading, setServerLoading] = useState<string | boolean>(false);

  // Fetch outputs
  const fetchOutputs = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/outputs`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch outputs:', error);
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  // Fetch apps and servers
  const fetchApps = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/server`);
      if (response.ok) {
        const result = await response.json();
        setAppData(result);
      }
    } catch (error) {
      console.error('Failed to fetch apps:', error);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchOutputs();
    fetchApps();
    // Poll for updates (especially for server status)
    const interval = setInterval(() => {
      fetchOutputs();
      fetchApps();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchOutputs, fetchApps]);

  // Handle view action
  const handleView = async (output: DetectedOutput) => {
    const viewAction = output.actions.find(a => a.type === 'view');
    if (!viewAction?.endpoint) return;

    try {
      const response = await fetch(viewAction.endpoint);
      if (response.ok) {
        const result = await response.json();
        setViewingFile({ name: output.name, content: result.content });
      } else {
        toast({ type: 'error', message: 'Failed to load file' });
      }
    } catch {
      toast({ type: 'error', message: 'Failed to load file' });
    }
  };

  // Handle run server for a specific app
  const handleRunServer = async (appId?: string) => {
    setServerLoading(appId || true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: appId ? JSON.stringify({ appId }) : undefined,
      });
      const result = await response.json();

      if (result.success) {
        toast({ type: 'success', message: result.message });
        fetchApps();
      } else {
        toast({ type: 'error', message: result.error || 'Failed to start server' });
      }
    } catch {
      toast({ type: 'error', message: 'Failed to start server' });
    } finally {
      setServerLoading(false);
    }
  };

  // Handle stop server
  const handleStopServer = async (serverId?: string) => {
    setServerLoading(serverId || true);
    try {
      const url = serverId
        ? `/api/outcomes/${outcomeId}/server?appId=${encodeURIComponent(serverId)}`
        : `/api/outcomes/${outcomeId}/server`;
      const response = await fetch(url, { method: 'DELETE' });
      const result = await response.json();

      if (result.success) {
        toast({ type: 'info', message: result.message || 'Server stopped' });
        fetchApps();
      }
    } catch {
      toast({ type: 'error', message: 'Failed to stop server' });
    } finally {
      setServerLoading(false);
    }
  };

  // Get server for a specific app
  const getServerForApp = (appId: string): RunningServer | undefined => {
    return appData?.servers.find(s => s.id === appId && (s.status === 'running' || s.status === 'starting'));
  };

  // Handle open in finder (using a workaround since we can't directly open folders)
  const handleOpenFolder = () => {
    if (data?.workspace.path) {
      // Copy path to clipboard as a fallback
      navigator.clipboard.writeText(data.workspace.path);
      toast({ type: 'info', message: `Path copied: ${data.workspace.path}` });
    }
  };

  // Copy single output content
  const handleCopyOutput = async (output: DetectedOutput) => {
    const viewAction = output.actions.find(a => a.type === 'view');
    if (!viewAction?.endpoint) {
      toast({ type: 'error', message: 'Cannot copy this file' });
      return;
    }

    try {
      const response = await fetch(viewAction.endpoint);
      if (response.ok) {
        const result = await response.json();
        await navigator.clipboard.writeText(result.content);
        toast({ type: 'success', message: `Copied: ${output.name}` });
      } else {
        toast({ type: 'error', message: 'Failed to copy' });
      }
    } catch {
      toast({ type: 'error', message: 'Failed to copy' });
    }
  };

  // Copy all outputs content
  const handleCopyAll = async () => {
    if (!data?.outputs || data.outputs.length === 0) {
      toast({ type: 'warning', message: 'No outputs to copy' });
      return;
    }

    const viewableOutputs = data.outputs.filter(o => o.actions.some(a => a.type === 'view'));
    if (viewableOutputs.length === 0) {
      toast({ type: 'warning', message: 'No viewable outputs to copy' });
      return;
    }

    try {
      const contents: string[] = [];

      for (const output of viewableOutputs) {
        const viewAction = output.actions.find(a => a.type === 'view');
        if (!viewAction?.endpoint) continue;

        const response = await fetch(viewAction.endpoint);
        if (response.ok) {
          const result = await response.json();
          contents.push(`${'='.repeat(60)}\n${output.name} (${output.type})\n${'='.repeat(60)}\n\n${result.content}\n`);
        }
      }

      if (contents.length > 0) {
        await navigator.clipboard.writeText(contents.join('\n\n'));
        toast({ type: 'success', message: `Copied ${contents.length} outputs to clipboard` });
      } else {
        toast({ type: 'error', message: 'Failed to copy outputs' });
      }
    } catch {
      toast({ type: 'error', message: 'Failed to copy outputs' });
    }
  };

  // Copy currently viewing file
  const handleCopyViewing = async () => {
    if (!viewingFile) return;
    try {
      await navigator.clipboard.writeText(viewingFile.content);
      toast({ type: 'success', message: 'Copied to clipboard' });
    } catch {
      toast({ type: 'error', message: 'Failed to copy' });
    }
  };

  // Don't render if no outputs and workspace doesn't exist
  if (!loading && (!data || !data.workspace.exists || data.summary.total === 0)) {
    return null;
  }

  if (loading) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Outputs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-sm">Scanning workspace...</p>
        </CardContent>
      </Card>
    );
  }

  const typeIcons: Record<string, string> = {
    app: '~',
    research: '@',
    document: '#',
    data: '%',
    asset: '*',
    unknown: '?',
  };

  const typeVariants: Record<string, 'default' | 'success' | 'warning' | 'info'> = {
    app: 'success',
    research: 'info',
    document: 'default',
    data: 'warning',
    asset: 'default',
    unknown: 'default',
  };

  return (
    <>
      <Card padding="md" id="outputs">
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Outputs</CardTitle>
            <Badge variant="default" className="text-xs">{data?.summary.total || 0}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopyAll}
              className="text-xs"
              title="Copy all outputs to clipboard"
            >
              Copy All
            </Button>
            <button
              onClick={handleOpenFolder}
              className="text-xs text-text-tertiary hover:text-text-secondary"
              title="Copy workspace path"
            >
              [path]
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Detected Apps */}
          {appData && appData.apps.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Apps ({appData.apps.length})
              </h4>
              <div className="space-y-2">
                {appData.apps.map((app) => {
                  const server = getServerForApp(app.id);
                  const isLoading = serverLoading === app.id || serverLoading === true;

                  return (
                    <div key={app.id} className="p-3 bg-bg-secondary rounded-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-text-primary text-sm font-medium">
                              {app.name}
                            </span>
                            <Badge
                              variant={app.type === 'node' ? 'info' : 'default'}
                              className="text-[10px]"
                            >
                              {app.framework || app.type}
                            </Badge>
                            {server && (
                              <Badge
                                variant={server.status === 'running' ? 'success' : 'warning'}
                                className="text-[10px]"
                              >
                                {server.status}
                              </Badge>
                            )}
                          </div>
                          <p className="text-text-tertiary text-xs mt-1">
                            {app.path === '.' ? 'Root app' : app.path}
                          </p>
                          {server?.status === 'running' && (
                            <a
                              href={server.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block mt-1 text-sm text-accent hover:text-accent-hover font-medium"
                            >
                              {server.url} &rarr;
                            </a>
                          )}
                        </div>
                        <div className="flex-shrink-0">
                          {server ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStopServer(server.id)}
                              disabled={isLoading}
                            >
                              {isLoading ? 'Stopping...' : 'Stop'}
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleRunServer(app.id)}
                              disabled={isLoading}
                            >
                              {isLoading ? 'Starting...' : 'Run'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Output List */}
          <div className="space-y-2">
            {data?.outputs.map((output) => (
              <div
                key={output.id}
                className="flex items-center justify-between p-2 hover:bg-bg-secondary rounded"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-text-tertiary font-mono text-sm">
                    {typeIcons[output.type] || '?'}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary text-sm font-medium truncate">
                        {output.name}
                      </span>
                      <Badge variant={typeVariants[output.type]} className="text-[10px]">
                        {output.type}
                      </Badge>
                    </div>
                    <p className="text-text-tertiary text-xs truncate">{output.description}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {output.actions.find(a => a.type === 'view') && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyOutput(output)}
                        title="Copy to clipboard"
                      >
                        Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleView(output)}
                      >
                        View
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {(!data?.outputs || data.outputs.length === 0) && (
            <p className="text-text-tertiary text-sm text-center py-4">
              No outputs detected yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* File Viewer Modal */}
      {viewingFile && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingFile(null)}
        >
          <div
            className="bg-bg-primary rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-medium text-text-primary">{viewingFile.name}</h3>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyViewing}
                >
                  Copy
                </Button>
                <button
                  onClick={() => setViewingFile(null)}
                  className="text-text-tertiary hover:text-text-primary"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono">
                {viewingFile.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
