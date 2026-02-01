'use client';

/**
 * Capability Suggestion Banner
 *
 * Displays detected capabilities after approach optimization with a button
 * to create them. Shows when new capabilities are detected that haven't
 * been built yet.
 */

import { useState } from 'react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { CapabilityNeed } from '@/lib/agents/capability-planner';

interface Props {
  capabilities: CapabilityNeed[];
  outcomeId: string;
  onCreateCapabilities: () => Promise<void>;
  onDismiss: () => void;
}

export function CapabilitySuggestionBanner({
  capabilities,
  outcomeId,
  onCreateCapabilities,
  onDismiss,
}: Props): JSX.Element | null {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (capabilities.length === 0) {
    return null;
  }

  const skillCount = capabilities.filter(c => c.type === 'skill').length;
  const toolCount = capabilities.filter(c => c.type === 'tool').length;

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      await onCreateCapabilities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create capabilities');
      setCreating(false);
    }
  }

  return (
    <Card className="border-status-info bg-status-info/5">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-status-info text-lg">+</span>
          <h3 className="font-semibold text-text-primary">New Capabilities Detected</h3>
        </div>
        <div className="flex items-center gap-2">
          {skillCount > 0 && (
            <Badge variant="info">{skillCount} skill{skillCount !== 1 ? 's' : ''}</Badge>
          )}
          {toolCount > 0 && (
            <Badge variant="info">{toolCount} tool{toolCount !== 1 ? 's' : ''}</Badge>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-text-secondary text-sm mb-3">
        Your approach mentions {capabilities.length} new {capabilities.length === 1 ? 'capability' : 'capabilities'} that
        {capabilities.length === 1 ? " hasn't" : " haven't"} been built yet. Create {capabilities.length === 1 ? 'it' : 'them'} to
        enable workers to use {capabilities.length === 1 ? 'this functionality' : 'these functionalities'}.
      </p>

      {/* Capability List (expandable) */}
      <div className="mb-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}>
            ▶
          </span>
          {expanded ? 'Hide details' : 'Show details'}
        </button>

        {expanded && (
          <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
            {capabilities.map((cap, index) => (
              <div
                key={`${cap.type}-${cap.path}-${index}`}
                className="p-2 bg-bg-secondary rounded-lg"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={cap.type === 'skill' ? 'success' : 'warning'} size="sm">
                    {cap.type}
                  </Badge>
                  <span className="text-text-primary text-sm font-medium">{cap.name}</span>
                </div>
                <p className="text-text-tertiary text-xs">{cap.path}</p>
                {cap.description && (
                  <p className="text-text-secondary text-xs mt-1">{cap.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-status-error mb-3">{error}</div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          disabled={creating}
        >
          Dismiss
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? 'Creating...' : `Create ${capabilities.length === 1 ? 'Capability' : 'Capabilities'}`}
        </Button>
      </div>
    </Card>
  );
}
