'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';
import type { SaveTarget } from '@/lib/db/schema';

interface OutcomeTool {
  id: string;
  name: string;
  type: string;
  outcomeId: string;
  outcomeName: string;
  description?: string;
  path: string;
}

interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: string;
  filename: string;
  file_path: string;
  target_override: SaveTarget | null;
  synced_to: SaveTarget | null;
  last_synced_at: number | null;
}

interface ToolsSectionProps {
  outcomeId: string;
}

const TARGET_LABELS: Record<SaveTarget, string> = {
  local: 'Local',
  private: 'Private',
  team: 'Team',
};

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
  const [selectedTool, setSelectedTool] = useState<OutcomeTool | null>(null);
  const [toolContent, setToolContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [promotingTool, setPromotingTool] = useState<string | null>(null);

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
      const response = await fetch(`/api/outcomes/${outcomeId}/items?type=tool`);
      const data = await response.json();
      const itemMap = new Map<string, OutcomeItem>();
      (data.items || []).forEach((item: OutcomeItem) => {
        itemMap.set(item.filename, item);
      });
      setItems(itemMap);
    } catch (error) {
      console.error('Failed to fetch tool items:', error);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchTools();
    fetchItems();
  }, [fetchTools, fetchItems]);

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

  const handlePromote = async (tool: OutcomeTool, target: SaveTarget) => {
    // Extract filename from path (e.g., "workspaces/out_xxx/tools/my-tool.ts" -> "my-tool.ts")
    const filename = tool.path.split('/').pop() || '';
    setPromotingTool(tool.id);

    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type: 'tool',
          filename,
          action: 'promote',
          target,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        toast({ type: 'success', message: `Tool ${target === 'local' ? 'unsynced' : `synced to ${target}`}` });
        fetchItems();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to promote tool' });
      }
    } catch (error) {
      console.error('Failed to promote tool:', error);
      toast({ type: 'error', message: 'Failed to promote tool' });
    } finally {
      setPromotingTool(null);
    }
  };

  const getItemForTool = (tool: OutcomeTool): OutcomeItem | undefined => {
    const filename = tool.path.split('/').pop() || '';
    return items.get(filename);
  };

  const getSyncBadge = (item: OutcomeItem | undefined): JSX.Element | null => {
    if (!item || !item.synced_to) {
      return <Badge variant="default">Local</Badge>;
    }
    if (item.synced_to === 'private') {
      return <Badge variant="info">Private</Badge>;
    }
    if (item.synced_to === 'team') {
      return <Badge variant="success">Team</Badge>;
    }
    return null;
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
            const isPromoting = promotingTool === tool.id;

            return (
              <div
                key={tool.id}
                className={`p-2 rounded cursor-pointer transition-colors border ${
                  selectedTool?.id === tool.id
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
                    {getSyncBadge(item)}
                  </div>
                </div>
                {tool.description && (
                  <p className="text-text-tertiary text-xs mt-1 ml-6 truncate">
                    {tool.description}
                  </p>
                )}

                {/* Promotion dropdown - shown when tool is selected */}
                {selectedTool?.id === tool.id && (
                  <div
                    className="mt-2 pt-2 border-t border-border/50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-tertiary">Save to:</span>
                      {(['local', 'private', 'team'] as SaveTarget[]).map((target) => (
                        <button
                          key={target}
                          disabled={isPromoting}
                          onClick={() => handlePromote(tool, target)}
                          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                            item?.synced_to === target || (!item?.synced_to && target === 'local')
                              ? 'bg-accent text-white'
                              : 'bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                          } ${isPromoting ? 'opacity-50' : ''}`}
                        >
                          {TARGET_LABELS[target]}
                        </button>
                      ))}
                    </div>
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
