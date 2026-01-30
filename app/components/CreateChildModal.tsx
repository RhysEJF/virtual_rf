'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

type Mode = 'create' | 'adopt' | 'set-parent';

interface OutcomeOption {
  id: string;
  name: string;
  depth: number;
  status: string;
}

interface CreateChildModalProps {
  parentId: string;
  parentName: string;
  currentParentId?: string | null;
  currentParentName?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Modal for managing outcome hierarchy:
 * - Create a new child outcome
 * - Add an existing outcome as a child
 * - Set the current outcome's parent
 */
export function CreateChildModal({
  parentId,
  parentName,
  currentParentId,
  currentParentName,
  onClose,
  onSuccess,
}: CreateChildModalProps): JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('create');
  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create mode state
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');

  // Options for dropdowns
  const [validParents, setValidParents] = useState<OutcomeOption[]>([]);
  const [validChildren, setValidChildren] = useState<OutcomeOption[]>([]);

  // Selected options
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [selectedParentId, setSelectedParentId] = useState<string>('');

  // Fetch valid options on mount
  useEffect(() => {
    async function fetchOptions() {
      try {
        const response = await fetch(`/api/outcomes/${parentId}/hierarchy-options`);
        if (response.ok) {
          const data = await response.json();
          setValidParents(data.validParents || []);
          setValidChildren(data.validChildren || []);
        }
      } catch (err) {
        console.error('Failed to fetch hierarchy options:', err);
      } finally {
        setOptionsLoading(false);
      }
    }
    fetchOptions();
  }, [parentId]);

  const handleCreateChild = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          brief: brief.trim() || null,
          parent_id: parentId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create outcome');
      }

      const data = await response.json();
      onSuccess?.();
      router.push(`/outcome/${data.outcome.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create outcome');
      setLoading(false);
    }
  };

  const handleAdoptChild = async () => {
    if (!selectedChildId) {
      setError('Please select an outcome to add as a child');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/outcomes/${selectedChildId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parentId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update outcome');
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add child');
      setLoading(false);
    }
  };

  const handleSetParent = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/outcomes/${parentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: selectedParentId || null }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update outcome');
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set parent');
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      handleCreateChild();
    } else if (mode === 'adopt') {
      handleAdoptChild();
    } else {
      handleSetParent();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card padding="lg" className="w-full max-w-lg mx-4 shadow-xl">
        <CardHeader>
          <CardTitle>Manage Hierarchy</CardTitle>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary text-xl leading-none"
          >
            ×
          </button>
        </CardHeader>
        <CardContent>
          {/* Mode Tabs */}
          <div className="flex gap-1 mb-4 p-1 bg-bg-secondary rounded-lg">
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
                mode === 'create'
                  ? 'bg-bg-primary text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              Create Child
            </button>
            <button
              type="button"
              onClick={() => setMode('adopt')}
              className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
                mode === 'adopt'
                  ? 'bg-bg-primary text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              Add Existing
            </button>
            <button
              type="button"
              onClick={() => setMode('set-parent')}
              className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
                mode === 'set-parent'
                  ? 'bg-bg-primary text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              Set Parent
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Create Mode */}
            {mode === 'create' && (
              <>
                <p className="text-text-tertiary text-sm">
                  Create a new child of <span className="text-text-secondary">"{parentName}"</span>
                </p>

                <div>
                  <label className="block text-sm text-text-secondary mb-1">
                    Name <span className="text-status-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., User Authentication"
                    className="w-full p-3 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm text-text-secondary mb-1">
                    Brief Description
                  </label>
                  <textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="What is this outcome about? (optional)"
                    className="w-full h-20 p-3 text-sm bg-bg-secondary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              </>
            )}

            {/* Adopt Mode */}
            {mode === 'adopt' && (
              <>
                <p className="text-text-tertiary text-sm">
                  Add an existing outcome as a child of <span className="text-text-secondary">"{parentName}"</span>
                </p>

                {optionsLoading ? (
                  <p className="text-text-tertiary text-sm py-4">Loading options...</p>
                ) : validChildren.length === 0 ? (
                  <p className="text-text-tertiary text-sm py-4">
                    No outcomes available to add as children.
                  </p>
                ) : (
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Select Outcome
                    </label>
                    <select
                      value={selectedChildId}
                      onChange={(e) => setSelectedChildId(e.target.value)}
                      className="w-full p-3 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary"
                    >
                      <option value="">Choose an outcome...</option>
                      {validChildren.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.depth > 0 ? '  '.repeat(o.depth) + '↳ ' : ''}{o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Set Parent Mode */}
            {mode === 'set-parent' && (
              <>
                <p className="text-text-tertiary text-sm">
                  Set the parent of <span className="text-text-secondary">"{parentName}"</span>
                </p>

                {currentParentId && (
                  <div className="flex items-center gap-2 p-2 bg-bg-secondary rounded-lg">
                    <span className="text-text-tertiary text-sm">Current parent:</span>
                    <Badge variant="default">{currentParentName}</Badge>
                  </div>
                )}

                {optionsLoading ? (
                  <p className="text-text-tertiary text-sm py-4">Loading options...</p>
                ) : (
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">
                      Select Parent
                    </label>
                    <select
                      value={selectedParentId}
                      onChange={(e) => setSelectedParentId(e.target.value)}
                      className="w-full p-3 text-sm bg-bg-secondary border border-border rounded-lg focus:outline-none focus:border-accent text-text-primary"
                    >
                      <option value="">None (make root)</option>
                      {validParents.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.depth > 0 ? '  '.repeat(o.depth) + '↳ ' : ''}{o.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-text-tertiary text-xs mt-1">
                      Select "None" to make this a root-level outcome.
                    </p>
                  </div>
                )}
              </>
            )}

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
                disabled={
                  loading ||
                  (mode === 'create' && !name.trim()) ||
                  (mode === 'adopt' && !selectedChildId) ||
                  optionsLoading
                }
              >
                {loading
                  ? 'Saving...'
                  : mode === 'create'
                  ? 'Create Child'
                  : mode === 'adopt'
                  ? 'Add as Child'
                  : 'Set Parent'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
