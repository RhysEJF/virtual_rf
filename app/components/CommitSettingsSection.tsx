'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';
import { ConfigureDestinationsModal } from './ConfigureDestinationsModal';

interface Repository {
  id: string;
  name: string;
  local_path: string;
  remote_url: string | null;
  auto_push: boolean;
}

interface ContentTargets {
  skill_repo_id: string | null;
  tool_repo_id: string | null;
  output_repo_id: string | null;
  file_repo_id: string | null;
}

interface CommitSettingsConfig {
  output_target: string;
  skill_target: string;
  tool_target: string;
  file_target: string;
  auto_save: boolean;
  repository_id: string | null;
  parent_id: string | null;
}

interface CommitSettingsSectionProps {
  outcomeId: string;
  config: CommitSettingsConfig;
  workingDirectory?: string | null;
  onUpdate?: () => void;
}

const CONTENT_TYPES = [
  { key: 'skill' as const, label: 'Skills', targetKey: 'skill_repo_id' as const, subfolder: 'skills' },
  { key: 'tool' as const, label: 'Tools', targetKey: 'tool_repo_id' as const, subfolder: 'tools' },
  { key: 'output' as const, label: 'Outputs', targetKey: 'output_repo_id' as const, subfolder: 'outputs' },
  { key: 'file' as const, label: 'Files', targetKey: 'file_repo_id' as const, subfolder: 'files' },
];

export function CommitSettingsSection({
  outcomeId,
  config,
  workingDirectory,
  onUpdate,
}: CommitSettingsSectionProps): JSX.Element {
  const { toast } = useToast();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  // Track which repo is selected for each content type
  const [contentTargets, setContentTargets] = useState<ContentTargets>(() => ({
    skill_repo_id: config.skill_target === 'repo' ? config.repository_id : null,
    tool_repo_id: config.tool_target === 'repo' ? config.repository_id : null,
    output_repo_id: config.output_target === 'repo' ? config.repository_id : null,
    file_repo_id: config.file_target === 'repo' ? config.repository_id : null,
  }));

  const [autoSave, setAutoSave] = useState(config.auto_save);

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

  const basePath = workingDirectory || `workspaces/out_${outcomeId.slice(-12)}`;

  const getDestinationDisplay = (contentType: string, repoId: string | null): { label: string; path: string; isRepo: boolean } => {
    const subfolder = CONTENT_TYPES.find(t => t.key === contentType)?.subfolder || contentType;

    if (!repoId) {
      return {
        label: 'Local',
        path: `${basePath}/${subfolder}/`,
        isRepo: false,
      };
    }

    const repo = repositories.find(r => r.id === repoId);
    if (repo) {
      return {
        label: repo.name,
        path: `${repo.local_path}/${subfolder}/`,
        isRepo: true,
      };
    }

    return {
      label: 'Local',
      path: `${basePath}/${subfolder}/`,
      isRepo: false,
    };
  };

  const handleSave = async (targets: ContentTargets, newAutoSave: boolean) => {
    try {
      const primaryRepoId = targets.skill_repo_id ||
        targets.tool_repo_id ||
        targets.output_repo_id ||
        targets.file_repo_id;

      const response = await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository_id: primaryRepoId,
          skill_target: targets.skill_repo_id ? 'repo' : 'local',
          tool_target: targets.tool_repo_id ? 'repo' : 'local',
          output_target: targets.output_repo_id ? 'repo' : 'local',
          file_target: targets.file_repo_id ? 'repo' : 'local',
          auto_save: newAutoSave,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setContentTargets(targets);
        setAutoSave(newAutoSave);
        toast({ type: 'success', message: 'Settings saved' });
        onUpdate?.();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to save' });
      }
    } catch (error) {
      console.error('Failed to save:', error);
      toast({ type: 'error', message: 'Failed to save settings' });
    }
  };

  const handleRepoAdded = (repo: Repository) => {
    setRepositories(prev => [...prev, repo]);
    toast({ type: 'success', message: `Repository "${repo.name}" added` });
  };

  // Check if any content type is set to a repo
  const hasAnyRepoEnabled = Object.values(contentTargets).some(v => v !== null);

  if (loadingRepos) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Where Your Work Goes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-sm">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card padding="md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Where Your Work Goes</CardTitle>
            {hasAnyRepoEnabled && autoSave && (
              <Badge variant="success" title="Auto-sync enabled">Auto</Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowConfigModal(true)}>
            Configure
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {CONTENT_TYPES.map(({ key, label, targetKey }) => {
              const repoId = contentTargets[targetKey];
              const { label: destLabel, path, isRepo } = getDestinationDisplay(key, repoId);

              // For future: handle multiple destinations per content type
              // For now, we just show the single destination
              const hasMultiple = false; // Placeholder for multi-repo per content type
              const additionalCount = 0;

              return (
                <div key={key} className="flex items-start gap-2 py-1.5">
                  <span className="text-text-secondary text-sm w-16 flex-shrink-0">{label}</span>
                  <span className="text-text-tertiary text-sm">→</span>
                  <div className="flex-1 min-w-0">
                    {hasMultiple ? (
                      // Multi-destination display with expandable
                      <div>
                        <button
                          onClick={() => setExpandedType(expandedType === key ? null : key)}
                          className="flex items-center gap-1 text-left"
                        >
                          <span className={`text-sm truncate ${isRepo ? 'text-accent' : 'text-text-primary'}`}>
                            {path}
                          </span>
                          {additionalCount > 0 && (
                            <span className="text-xs text-text-tertiary flex-shrink-0">
                              (+{additionalCount} more)
                            </span>
                          )}
                        </button>
                        {expandedType === key && (
                          <div className="mt-1 pl-2 border-l border-border/50 space-y-0.5">
                            {/* Additional destinations would be listed here */}
                          </div>
                        )}
                      </div>
                    ) : (
                      // Single destination display
                      <span
                        className={`text-sm truncate block ${isRepo ? 'text-accent' : 'text-text-primary'}`}
                        title={path}
                      >
                        {path}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Configure Modal */}
      {showConfigModal && (
        <ConfigureDestinationsModal
          outcomeId={outcomeId}
          repositories={repositories}
          contentTargets={contentTargets}
          autoSave={autoSave}
          workingDirectory={basePath}
          onClose={() => setShowConfigModal(false)}
          onSave={handleSave}
          onRepoAdded={handleRepoAdded}
        />
      )}
    </>
  );
}
