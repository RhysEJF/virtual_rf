'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { AddRepositoryModal } from './AddRepositoryModal';

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

interface ConfigureDestinationsModalProps {
  outcomeId: string;
  repositories: Repository[];
  contentTargets: ContentTargets;
  autoSave: boolean;
  workingDirectory: string;
  onClose: () => void;
  onSave: (targets: ContentTargets, autoSave: boolean) => Promise<void>;
  onRepoAdded: (repo: Repository) => void;
}

const CONTENT_TYPES = [
  { key: 'skill' as const, label: 'Skills', targetKey: 'skill_repo_id' as const },
  { key: 'tool' as const, label: 'Tools', targetKey: 'tool_repo_id' as const },
  { key: 'output' as const, label: 'Outputs', targetKey: 'output_repo_id' as const },
  { key: 'file' as const, label: 'Files', targetKey: 'file_repo_id' as const },
];

const SUBFOLDERS: Record<string, string> = {
  skill: 'skills',
  tool: 'tools',
  output: 'outputs',
  file: 'files',
};

export function ConfigureDestinationsModal({
  outcomeId,
  repositories,
  contentTargets: initialTargets,
  autoSave: initialAutoSave,
  workingDirectory,
  onClose,
  onSave,
  onRepoAdded,
}: ConfigureDestinationsModalProps): JSX.Element {
  const [contentTargets, setContentTargets] = useState<ContentTargets>(initialTargets);
  const [autoSave, setAutoSave] = useState(initialAutoSave);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingContentType, setPendingContentType] = useState<string | null>(null);

  const basePath = workingDirectory || `workspaces/out_${outcomeId.slice(-12)}`;

  const getDisplayPath = (contentType: string, repoId: string | null): string => {
    const subfolder = SUBFOLDERS[contentType];
    if (!repoId) {
      return `${basePath}/${subfolder}/`;
    }
    const repo = repositories.find(r => r.id === repoId);
    if (repo) {
      return `${repo.local_path}/${subfolder}/`;
    }
    return `${basePath}/${subfolder}/`;
  };

  const handleTargetChange = (contentType: string, value: string) => {
    if (value === '__add__') {
      setPendingContentType(contentType);
      setShowAddModal(true);
      return;
    }

    const repoId = value === '__local__' ? null : value;
    setContentTargets(prev => ({
      ...prev,
      [`${contentType}_repo_id`]: repoId,
    }));
  };

  const handleAddRepoSuccess = (repo: { id: string; name: string; local_path: string }) => {
    onRepoAdded(repo as Repository);

    if (pendingContentType) {
      setContentTargets(prev => ({
        ...prev,
        [`${pendingContentType}_repo_id`]: repo.id,
      }));
    }

    setShowAddModal(false);
    setPendingContentType(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(contentTargets, autoSave);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const hasAnyRepoEnabled = Object.values(contentTargets).some(v => v !== null);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <Card padding="lg" className="w-full max-w-lg mx-4 shadow-xl">
          <CardHeader>
            <CardTitle>Configure Destinations</CardTitle>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
            >
              ×
            </button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-text-tertiary text-sm">
                Choose where each content type gets saved.
              </p>

              {/* Content-Type Destinations */}
              <div className="space-y-3">
                {CONTENT_TYPES.map(({ key, label, targetKey }) => {
                  const repoId = contentTargets[targetKey];
                  const displayPath = getDisplayPath(key, repoId);

                  return (
                    <div key={key} className="space-y-1">
                      <label className="block text-sm text-text-secondary font-medium">
                        {label}
                      </label>
                      <select
                        value={repoId || '__local__'}
                        onChange={(e) => handleTargetChange(key, e.target.value)}
                        className="w-full p-2 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary"
                      >
                        <option value="__local__">Local workspace</option>
                        {repositories.map(repo => (
                          <option key={repo.id} value={repo.id}>
                            {repo.name}
                          </option>
                        ))}
                        <option value="__add__">+ Add repository...</option>
                      </select>
                      <p className="text-[10px] text-text-tertiary truncate" title={displayPath}>
                        {displayPath}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Auto-sync toggle */}
              {hasAnyRepoEnabled && (
                <label className="flex items-center gap-3 cursor-pointer p-3 bg-bg-secondary rounded-lg">
                  <input
                    type="checkbox"
                    checked={autoSave}
                    onChange={(e) => setAutoSave(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent w-4 h-4"
                  />
                  <div>
                    <span className="text-sm text-text-primary">Auto-sync as workers build</span>
                    <p className="text-xs text-text-tertiary">
                      Automatically commit to repos during capability phase
                    </p>
                  </div>
                </label>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Nested Add Repository Modal */}
      {showAddModal && (
        <AddRepositoryModal
          onClose={() => {
            setShowAddModal(false);
            setPendingContentType(null);
          }}
          onSuccess={handleAddRepoSuccess}
        />
      )}
    </>
  );
}
