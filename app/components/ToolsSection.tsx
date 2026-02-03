'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';

interface OutcomeTool {
  id: string;
  name: string;
  type: string;
  outcomeId: string;
  outcomeName: string;
  description?: string;
  path: string;
}

interface ItemSync {
  repo_id: string;
  repo_name: string;
  synced_at: number;
  sync_status: 'synced' | 'failed' | 'stale';
  commit_hash: string | null;
}

interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: string;
  filename: string;
  file_path: string;
  synced_to: string | null;
  last_synced_at: number | null;
  syncs?: ItemSync[];
}

interface Repository {
  id: string;
  name: string;
  local_path: string;
}

interface ToolsSectionProps {
  outcomeId: string;
}

const TYPE_COLORS: Record<string, string> = {
  typescript: 'text-blue-500',
  python: 'text-yellow-500',
  shell: 'text-green-500',
  unknown: 'text-text-tertiary',
};

export function ToolsSection({ outcomeId }: ToolsSectionProps): JSX.Element {
  const { toast } = useToast();
  const [tools, setTools] = useState<OutcomeTool[]>([]);
  const [items, setItems] = useState<Map<string, OutcomeItem>>(new Map());
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedTool, setSelectedTool] = useState<OutcomeTool | null>(null);
  const [toolContent, setToolContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [syncingRepos, setSyncingRepos] = useState<Set<string>>(new Set());

  const fetchTools = useCallback(async () => {
    try {
      const response = await fetch(`/api/tools/outcome?outcomeId=${outcomeId}`);
      const data = await response.json();
      setTools(data.tools || []);
    } catch (error) {
      console.error('Failed to fetch tools:', error);
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  const fetchItems = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/items?type=tool&include_syncs=true`);
      const data = await response.json();
      const itemMap = new Map<string, OutcomeItem>();
      (data.items || []).forEach((item: OutcomeItem) => {
        itemMap.set(item.filename, item);
      });
      setItems(itemMap);
      if (data.available_repos) {
        setRepositories(data.available_repos);
      }
    } catch (error) {
      console.error('Failed to fetch tool items:', error);
    }
  }, [outcomeId]);

  const fetchRepos = useCallback(async () => {
    try {
      const response = await fetch('/api/repositories');
      const data = await response.json();
      setRepositories(data.repositories || []);
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
    }
  }, []);

  useEffect(() => {
    fetchTools();
    fetchItems();
    fetchRepos();
  }, [fetchTools, fetchItems, fetchRepos]);

  const handleSelectTool = async (tool: OutcomeTool) => {
    setSelectedTool(tool);
    setLoadingContent(true);
    setToolContent(null);

    try {
      const response = await fetch(`/api/tools/outcome?outcomeId=${outcomeId}&includeContent=true`);
      const data = await response.json();
      const fullTool = data.tools?.find((t: OutcomeTool & { content?: string }) => t.id === tool.id);
      setToolContent(fullTool?.content || 'No content available');
    } catch (error) {
      console.error('Failed to fetch tool content:', error);
      setToolContent('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleSyncToggle = async (tool: OutcomeTool, repoId: string, currentlySynced: boolean) => {
    const filename = tool.path.split('/').pop() || '';
    setSyncingRepos(prev => new Set(prev).add(repoId));

    try {
      if (currentlySynced) {
        const response = await fetch(`/api/outcomes/${outcomeId}/items`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_type: 'tool',
            filename,
            action: 'unsync',
            repo_id: repoId,
          }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
          toast({ type: 'success', message: 'Removed from repository' });
          fetchItems();
        } else {
          toast({ type: 'error', message: data.error || 'Failed to unsync' });
        }
      } else {
        const response = await fetch(`/api/outcomes/${outcomeId}/items`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_type: 'tool',
            filename,
            action: 'sync',
            repo_ids: [repoId],
          }),
        });

        const data = await response.json();
        if (response.ok && data.success) {
          toast({ type: 'success', message: 'Synced to repository' });
          fetchItems();
        } else {
          toast({ type: 'error', message: data.error || 'Failed to sync' });
        }
      }
    } catch (error) {
      console.error('Failed to toggle sync:', error);
      toast({ type: 'error', message: 'Failed to update sync' });
    } finally {
      setSyncingRepos(prev => {
        const next = new Set(prev);
        next.delete(repoId);
        return next;
      });
    }
  };

  const getItemForTool = (tool: OutcomeTool): OutcomeItem | undefined => {
    const filename = tool.path.split('/').pop() || '';
    return items.get(filename);
  };

  const getSyncBadges = (item: OutcomeItem | undefined): JSX.Element => {
    if (item?.syncs && item.syncs.length > 0) {
      return (
        <div className="flex flex-wrap gap-1">
          {item.syncs.map(sync => (
            <Badge
              key={sync.repo_id}
              variant={sync.sync_status === 'synced' ? 'success' : sync.sync_status === 'stale' ? 'warning' : 'error'}
              title={`${sync.repo_name} - ${sync.sync_status}`}
            >
              {sync.repo_name.length > 8 ? sync.repo_name.slice(0, 8) + '…' : sync.repo_name}
            </Badge>
          ))}
        </div>
      );
    }

    if (item?.synced_to) {
      return <Badge variant="success">Synced</Badge>;
    }

    return <Badge variant="default">Local</Badge>;
  };

  const isRepoSynced = (item: OutcomeItem | undefined, repoId: string): boolean => {
    if (!item?.syncs) return false;
    return item.syncs.some(s => s.repo_id === repoId && s.sync_status === 'synced');
  };

  if (loading) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-sm">Loading tools...</p>
        </CardContent>
      </Card>
    );
  }

  if (tools.length === 0) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <Badge variant="default">0</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-sm text-center py-2">
            No tools built yet
          </p>
          <p className="text-text-tertiary text-xs text-center">
            Tools are created during the capability phase
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <Badge variant="success">{tools.length}</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {tools.map((tool) => {
            const item = getItemForTool(tool);
            const isSelected = selectedTool?.id === tool.id;

            return (
              <div
                key={tool.id}
                className={`p-2 rounded cursor-pointer transition-colors border ${
                  isSelected
                    ? 'bg-accent/10 border-accent'
                    : 'bg-bg-secondary border-transparent hover:border-border'
                }`}
                onClick={() => handleSelectTool(tool)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono ${TYPE_COLORS[tool.type] || TYPE_COLORS.unknown}`}>
                      {tool.type === 'typescript' ? 'TS' :
                       tool.type === 'python' ? 'PY' :
                       tool.type === 'shell' ? 'SH' : '?'}
                    </span>
                    <span className="text-text-primary text-sm font-medium">{tool.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getSyncBadges(item)}
                  </div>
                </div>
                {tool.description && (
                  <p className="text-text-tertiary text-xs mt-1 ml-6 truncate">
                    {tool.description}
                  </p>
                )}

                {/* Repo sync checkboxes - shown when tool is selected */}
                {isSelected && repositories.length > 0 && (
                  <div
                    className="mt-2 pt-2 border-t border-border/50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[10px] text-text-tertiary mb-1.5">Sync to:</div>
                    <div className="flex flex-wrap gap-2">
                      {repositories.map((repo) => {
                        const synced = isRepoSynced(item, repo.id);
                        const isSyncing = syncingRepos.has(repo.id);

                        return (
                          <label
                            key={repo.id}
                            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                              synced
                                ? 'bg-accent/10 text-accent border border-accent/30'
                                : 'bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-transparent'
                            } ${isSyncing ? 'opacity-50' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={synced}
                              disabled={isSyncing}
                              onChange={() => handleSyncToggle(tool, repo.id, synced)}
                              className="w-3 h-3 rounded border-border text-accent focus:ring-accent"
                            />
                            <span>{repo.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isSelected && repositories.length === 0 && (
                  <div
                    className="mt-2 pt-2 border-t border-border/50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[10px] text-text-tertiary">
                      No repositories configured. Add one in "Where Your Work Goes" above.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Tool Content Preview */}
        {selectedTool && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs text-text-secondary uppercase tracking-wide">
                {selectedTool.name}
              </h4>
              <button
                className="text-xs text-text-tertiary hover:text-text-secondary"
                onClick={() => setSelectedTool(null)}
              >
                Close
              </button>
            </div>
            {loadingContent ? (
              <p className="text-text-tertiary text-sm">Loading...</p>
            ) : (
              <pre className="text-text-primary text-xs bg-bg-secondary p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                {toolContent}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
