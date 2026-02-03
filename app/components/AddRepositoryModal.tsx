'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';

interface AddRepositoryModalProps {
  onClose: () => void;
  onSuccess: (repo: { id: string; name: string; local_path: string }) => void;
}

/**
 * Inline modal for adding a new repository without leaving the page.
 * Saves to global repositories table so it's available everywhere.
 */
export function AddRepositoryModal({
  onClose,
  onSuccess,
}: AddRepositoryModalProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [autoPush, setAutoPush] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!localPath.trim()) {
      setError('Local path is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          local_path: localPath.trim(),
          remote_url: remoteUrl.trim() || null,
          auto_push: autoPush,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create repository');
      }

      const data = await response.json();
      onSuccess(data.repository);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repository');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card padding="lg" className="w-full max-w-md mx-4 shadow-xl">
        <CardHeader>
          <CardTitle>Add Repository</CardTitle>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
          >
            ×
          </button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-text-tertiary text-sm">
              Add a git repository for syncing skills, tools, and outputs.
            </p>

            <div>
              <label className="block text-sm text-text-secondary mb-1">
                Name <span className="text-status-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., shared-skills, client-acme"
                className="w-full p-3 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">
                Local Path <span className="text-status-error">*</span>
              </label>
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="e.g., ~/repos/shared-skills"
                className="w-full p-3 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
              />
              <p className="text-text-tertiary text-xs mt-1">
                Path to the local git repository clone
              </p>
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">
                Remote URL <span className="text-text-tertiary">(optional)</span>
              </label>
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="e.g., git@github.com:user/repo.git"
                className="w-full p-3 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer p-2 hover:bg-bg-secondary rounded transition-colors">
              <input
                type="checkbox"
                checked={autoPush}
                onChange={(e) => setAutoPush(e.target.checked)}
                className="rounded border-border text-accent focus:ring-accent w-4 h-4"
              />
              <div>
                <span className="text-sm text-text-primary">Auto-push on sync</span>
                <p className="text-xs text-text-tertiary">
                  Automatically push to remote after committing
                </p>
              </div>
            </label>

            {error && (
              <p className="text-status-error text-sm">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={loading || !name.trim() || !localPath.trim()}
              >
                {loading ? 'Adding...' : 'Add Repository'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
