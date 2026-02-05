'use client';

import { useState } from 'react';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import type { IsolationMode } from '@/lib/db/schema';

interface IsolationModeSectionProps {
  outcomeId: string;
  isolationMode: IsolationMode;
  onUpdate: (mode: IsolationMode) => void;
  workingDirectory?: string | null;
}

export function IsolationModeSection({
  outcomeId,
  isolationMode,
  onUpdate,
  workingDirectory,
}: IsolationModeSectionProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedMode, setSelectedMode] = useState<IsolationMode>(isolationMode);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isolation_mode: selectedMode }),
      });

      if (response.ok) {
        onUpdate(selectedMode);
        setIsEditing(false);
      }
    } catch (error) {
      console.error('Failed to update isolation mode:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSelectedMode(isolationMode);
    setIsEditing(false);
  };

  // Determine workspace path for display
  const workspacePath = workingDirectory || `workspaces/${outcomeId.split('_')[1] || outcomeId}`;

  return (
    <div className="p-4 bg-bg-secondary rounded-lg border border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text-primary">Workspace Isolation</h3>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      {!isEditing ? (
        // Display mode
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge
              variant={isolationMode === 'workspace' ? 'success' : 'warning'}
              className="text-xs"
            >
              {isolationMode === 'workspace' ? 'Isolated' : 'Codebase Access'}
            </Badge>
          </div>
          <p className="text-xs text-text-tertiary">
            {isolationMode === 'workspace' ? (
              <>
                Workers can only modify files within{' '}
                <code className="text-accent">{workspacePath}/</code>
              </>
            ) : (
              <>
                Workers can modify files in the main codebase.
                <span className="text-status-warning ml-1">Use with caution.</span>
              </>
            )}
          </p>
        </div>
      ) : (
        // Edit mode
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-bg-tertiary transition-colors">
              <input
                type="radio"
                name="isolationMode"
                value="workspace"
                checked={selectedMode === 'workspace'}
                onChange={() => setSelectedMode('workspace')}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    Isolated Workspace
                  </span>
                  <Badge variant="success" className="text-[10px]">Recommended</Badge>
                </div>
                <p className="text-xs text-text-tertiary mt-1">
                  Workers can only create/modify files within{' '}
                  <code className="text-accent">{workspacePath}/</code>.
                  Safe for building external projects.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-bg-tertiary transition-colors">
              <input
                type="radio"
                name="isolationMode"
                value="codebase"
                checked={selectedMode === 'codebase'}
                onChange={() => setSelectedMode('codebase')}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    Codebase Access
                  </span>
                  <Badge variant="warning" className="text-[10px]">Advanced</Badge>
                </div>
                <p className="text-xs text-text-tertiary mt-1">
                  Workers can modify files in the main codebase (app/, lib/, etc.).
                  Use for self-improvement or internal features.
                </p>
              </div>
            </label>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
