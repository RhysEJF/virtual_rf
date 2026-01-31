'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';
import type { SaveTarget } from '@/lib/db/schema';

interface Repository {
  id: string;
  name: string;
  type: 'private' | 'team';
  content_type: string;
}

interface SaveTargetsConfig {
  output_target: SaveTarget;
  skill_target: SaveTarget;
  tool_target: SaveTarget;
  file_target: SaveTarget;
  auto_save: boolean;
}

interface SaveTargetsSectionProps {
  outcomeId: string;
  config: SaveTargetsConfig;
  onUpdate?: () => void;
}

const TARGET_LABELS: Record<SaveTarget, string> = {
  local: 'Local',
  private: 'Private',
  team: 'Team',
};

const TARGET_DESCRIPTIONS: Record<SaveTarget, string> = {
  local: 'Stays in workspace only',
  private: 'Saved to your private repo',
  team: 'Saved to team shared repo',
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
      localConfig.auto_save !== config.auto_save;
    setHasChanges(changed);
  }, [localConfig, config]);

  // Check if a target is available (has a configured repo)
  const hasPrivateRepo = repositories.some(r => r.type === 'private');
  const hasTeamRepo = repositories.some(r => r.type === 'team');

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

  const handleAutoSaveChange = (value: boolean) => {
    setLocalConfig(prev => ({ ...prev, auto_save: value }));
  };

  // Check if repos are configured
  const needsRepoConfig = !hasPrivateRepo && !hasTeamRepo;

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
        ) : needsRepoConfig ? (
          <div className="p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
            <p className="text-text-primary font-medium">No repositories configured</p>
            <p className="text-text-secondary text-sm mt-1">
              Configure repositories in Settings before setting up save targets.
            </p>
            <a
              href="/settings"
              className="inline-block mt-3 text-sm text-accent hover:underline"
            >
              Go to Settings →
            </a>
          </div>
        ) : (
          <div className="space-y-4">
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
                    {(['local', 'private', 'team'] as SaveTarget[]).map((target) => {
                      const isDisabled =
                        (target === 'private' && !hasPrivateRepo) ||
                        (target === 'team' && !hasTeamRepo);
                      const isSelected = localConfig[key] === target;

                      return (
                        <label
                          key={target}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                            isDisabled
                              ? 'opacity-50 cursor-not-allowed'
                              : isSelected
                              ? 'bg-accent/10 border border-accent/30'
                              : 'hover:bg-bg-secondary'
                          }`}
                        >
                          <input
                            type="radio"
                            name={key}
                            value={target}
                            checked={isSelected}
                            disabled={isDisabled}
                            onChange={() => handleTargetChange(key, target)}
                            className="text-accent focus:ring-accent"
                          />
                          <span className={`text-sm ${isSelected ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                            {TARGET_LABELS[target]}
                          </span>
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
                    Automatically sync items to configured repositories during work
                  </p>
                </div>
              </label>
            </div>

            {/* Repository info */}
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-text-tertiary mb-2">Configured Repositories:</p>
              <div className="flex flex-wrap gap-2">
                {hasPrivateRepo && (
                  <Badge variant="info">
                    Private: {repositories.find(r => r.type === 'private')?.name}
                  </Badge>
                )}
                {hasTeamRepo && (
                  <Badge variant="info">
                    Team: {repositories.find(r => r.type === 'team')?.name}
                  </Badge>
                )}
                {!hasPrivateRepo && (
                  <Badge variant="warning">No private repo</Badge>
                )}
                {!hasTeamRepo && (
                  <Badge variant="warning">No team repo</Badge>
                )}
              </div>
            </div>

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
