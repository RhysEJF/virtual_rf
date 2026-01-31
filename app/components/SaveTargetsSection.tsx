'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';
import type { SaveTarget } from '@/lib/db/schema';

interface Repository {
  id: string;
  name: string;
  local_path: string;
  remote_url: string | null;
  auto_push: boolean;
}

interface SaveTargetsConfig {
  output_target: SaveTarget;
  skill_target: SaveTarget;
  tool_target: SaveTarget;
  file_target: SaveTarget;
  auto_save: boolean;
  repository_id: string | null;
  parent_id: string | null;
}

interface SaveTargetsSectionProps {
  outcomeId: string;
  config: SaveTargetsConfig;
  onUpdate?: () => void;
}

const TARGET_LABELS: Record<SaveTarget, string> = {
  local: 'Local',
  repo: 'Repository',
  inherit: 'Inherit',
};

const TARGET_DESCRIPTIONS: Record<SaveTarget, string> = {
  local: 'Stays in workspace only',
  repo: 'Saved to configured repository',
  inherit: 'Inherits from parent outcome',
};

const CONTENT_TYPES = [
  { key: 'output_target', label: 'Outputs', description: 'Outcome work product' },
  { key: 'skill_target', label: 'Skills', description: 'Reusable instructions' },
  { key: 'tool_target', label: 'Tools', description: 'Reusable scripts' },
  { key: 'file_target', label: 'Files', description: 'Uploaded data' },
] as const;

export function SaveTargetsSection({
  outcomeId,
  config,
  onUpdate,
}: SaveTargetsSectionProps): JSX.Element {
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState<SaveTargetsConfig>(config);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);

  // Fetch available repositories
  useEffect(() => {
    async function fetchRepos() {
      try {
        const response = await fetch('/api/repositories');
        const data = await response.json();
        setRepositories(data.repositories || []);
      } catch (error) {
        console.error('Failed to fetch repositories:', error);
      } finally {
        setLoadingRepos(false);
      }
    }
    fetchRepos();
  }, []);

  // Track changes
  useEffect(() => {
    const changed =
      localConfig.output_target !== config.output_target ||
      localConfig.skill_target !== config.skill_target ||
      localConfig.tool_target !== config.tool_target ||
      localConfig.file_target !== config.file_target ||
      localConfig.auto_save !== config.auto_save ||
      localConfig.repository_id !== config.repository_id;
    setHasChanges(changed);
  }, [localConfig, config]);

  // Get current repository
  const currentRepo = repositories.find(r => r.id === localConfig.repository_id);
  const hasParent = !!config.parent_id;

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          output_target: localConfig.output_target,
          skill_target: localConfig.skill_target,
          tool_target: localConfig.tool_target,
          file_target: localConfig.file_target,
          auto_save: localConfig.auto_save,
          repository_id: localConfig.repository_id,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        toast({ type: 'success', message: 'Save targets updated' });
        setHasChanges(false);
        onUpdate?.();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to update' });
      }
    } catch (error) {
      console.error('Failed to save:', error);
      toast({ type: 'error', message: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleTargetChange = (key: keyof SaveTargetsConfig, value: SaveTarget) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleRepoChange = (repoId: string | null) => {
    setLocalConfig(prev => ({ ...prev, repository_id: repoId }));
  };

  const handleAutoSaveChange = (value: boolean) => {
    setLocalConfig(prev => ({ ...prev, auto_save: value }));
  };

  // Available targets depend on context
  const getAvailableTargets = (): SaveTarget[] => {
    const targets: SaveTarget[] = ['local'];
    if (currentRepo || hasParent) {
      targets.push('repo');
    }
    if (hasParent) {
      targets.push('inherit');
    }
    return targets;
  };

  const availableTargets = getAvailableTargets();

  return (
    <Card padding="md">
      <CardHeader>
        <div>
          <CardTitle>Save Targets</CardTitle>
          <p className="text-text-tertiary text-sm mt-1">
            Where to save outputs, skills, tools, and files
          </p>
        </div>
        {hasChanges && (
          <Badge variant="warning">Unsaved</Badge>
        )}
      </CardHeader>
      <CardContent>
        {loadingRepos ? (
          <p className="text-text-tertiary text-sm">Loading...</p>
        ) : (
          <div className="space-y-4">
            {/* Repository Selection */}
            <div className="p-3 bg-bg-secondary rounded-lg">
              <label className="block text-sm font-medium text-text-primary mb-2">
                Repository
              </label>
              <select
                value={localConfig.repository_id || ''}
                onChange={(e) => handleRepoChange(e.target.value || null)}
                className="w-full p-2 bg-bg-primary border border-border rounded text-text-primary text-sm"
              >
                <option value="">
                  {hasParent ? 'Inherit from parent' : 'No repository (local only)'}
                </option>
                {repositories.map(repo => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name} ({repo.local_path})
                  </option>
                ))}
              </select>
              {currentRepo && (
                <p className="text-xs text-text-tertiary mt-1">
                  {currentRepo.remote_url || 'No remote URL'}
                  {currentRepo.auto_push && ' (auto-push enabled)'}
                </p>
              )}
              {!currentRepo && hasParent && (
                <p className="text-xs text-text-tertiary mt-1">
                  Will use repository from parent outcome
                </p>
              )}
            </div>

            {/* Target Grid */}
            <div className="grid grid-cols-4 gap-4">
              {CONTENT_TYPES.map(({ key, label, description }) => (
                <div key={key} className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium text-text-primary">
                      {label}
                    </label>
                    <p className="text-xs text-text-tertiary">{description}</p>
                  </div>
                  <div className="space-y-1">
                    {availableTargets.map((target) => {
                      const isSelected = localConfig[key] === target;

                      return (
                        <label
                          key={target}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-accent/10 border border-accent/30'
                              : 'hover:bg-bg-secondary'
                          }`}
                        >
                          <input
                            type="radio"
                            name={key}
                            value={target}
                            checked={isSelected}
                            onChange={() => handleTargetChange(key, target)}
                            className="text-accent focus:ring-accent"
                          />
                          <div>
                            <span className={`text-sm ${isSelected ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                              {TARGET_LABELS[target]}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Auto-save toggle */}
            <div className="pt-4 border-t border-border">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.auto_save}
                  onChange={(e) => handleAutoSaveChange(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <div>
                  <span className="text-sm text-text-primary font-medium">
                    Auto-save as workers build
                  </span>
                  <p className="text-xs text-text-tertiary">
                    Automatically sync items to repository during work
                  </p>
                </div>
              </label>
            </div>

            {/* Repository info */}
            {repositories.length > 0 && (
              <div className="pt-4 border-t border-border">
                <p className="text-xs text-text-tertiary mb-2">Available Repositories:</p>
                <div className="flex flex-wrap gap-2">
                  {repositories.map(repo => (
                    <Badge
                      key={repo.id}
                      variant={repo.id === localConfig.repository_id ? 'success' : 'default'}
                    >
                      {repo.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {repositories.length === 0 && !hasParent && (
              <div className="p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
                <p className="text-text-primary font-medium">No repositories configured</p>
                <p className="text-text-secondary text-sm mt-1">
                  Configure repositories in Settings to enable syncing to external repos.
                </p>
                <a
                  href="/settings"
                  className="inline-block mt-3 text-sm text-accent hover:underline"
                >
                  Go to Settings
                </a>
              </div>
            )}

            {/* Save button */}
            {hasChanges && (
              <div className="pt-4 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
