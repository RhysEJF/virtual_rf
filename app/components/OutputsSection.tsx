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

interface ServerStatus {
  outcomeId: string;
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
  server: ServerStatus | null;
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
  const [loading, setLoading] = useState(true);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [serverLoading, setServerLoading] = useState(false);

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

  useEffect(() => {
    fetchOutputs();
    // Poll for updates (especially for server status)
    const interval = setInterval(fetchOutputs, 10000);
    return () => clearInterval(interval);
  }, [fetchOutputs]);

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

  // Handle run server
  const handleRunServer = async () => {
    setServerLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/server`, {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        toast({ type: 'success', message: result.message });
        fetchOutputs();
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
  const handleStopServer = async () => {
    setServerLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/server`, {
        method: 'DELETE',
      });
      const result = await response.json();

      if (result.success) {
        toast({ type: 'info', message: 'Server stopped' });
        fetchOutputs();
      }
    } catch {
      toast({ type: 'error', message: 'Failed to stop server' });
    } finally {
      setServerLoading(false);
    }
  };

  // Handle open in finder (using a workaround since we can't directly open folders)
  const handleOpenFolder = () => {
    if (data?.workspace.path) {
      // Copy path to clipboard as a fallback
      navigator.clipboard.writeText(data.workspace.path);
      toast({ type: 'info', message: `Path copied: ${data.workspace.path}` });
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
          <button
            onClick={handleOpenFolder}
            className="text-xs text-text-tertiary hover:text-text-secondary"
            title="Copy workspace path"
          >
            [copy path]
          </button>
        </CardHeader>
        <CardContent>
          {/* Server Status */}
          {data?.server && (
            <div className="mb-4 p-3 bg-bg-secondary rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <Badge
                    variant={data.server.status === 'running' ? 'success' : data.server.status === 'starting' ? 'warning' : 'default'}
                    className="text-xs"
                  >
                    {data.server.status}
                  </Badge>
                  {data.server.status === 'running' && (
                    <a
                      href={data.server.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-sm text-accent hover:text-accent-hover"
                    >
                      {data.server.url}
                    </a>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStopServer}
                  disabled={serverLoading}
                >
                  Stop
                </Button>
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
                  {output.type === 'app' && !data.server && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleRunServer}
                      disabled={serverLoading}
                    >
                      {serverLoading ? 'Starting...' : 'Run'}
                    </Button>
                  )}
                  {output.actions.find(a => a.type === 'view') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleView(output)}
                    >
                      View
                    </Button>
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
              <button
                onClick={() => setViewingFile(null)}
                className="text-text-tertiary hover:text-text-primary"
              >
                Close
              </button>
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
