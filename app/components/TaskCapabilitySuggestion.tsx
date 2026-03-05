'use client';

/**
 * Task Capability Suggestion
 *
 * Compact inline component for showing detected new capabilities
 * inside the task card after optimization.
 */

import { useState } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { CapabilityNeed } from '@/lib/agents/capability-planner';

interface Props {
  capabilities: CapabilityNeed[];
  outcomeId: string;
  onCreated: () => void;
  onDismiss: () => void;
}

export function TaskCapabilitySuggestion({
  capabilities,
  outcomeId,
  onCreated,
  onDismiss,
}: Props): JSX.Element | null {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (capabilities.length === 0) return null;

  const handleCreateAll = async (): Promise<void> => {
    setCreating(true);
    setError(null);

    try {
      for (const cap of capabilities) {
        const response = await fetch(`/api/capabilities/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcomeId,
            type: cap.type,
            name: cap.name,
            description: cap.description,
            specification: cap.specification,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Failed to create ${cap.name}`);
        }
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create capabilities');
      setCreating(false);
    }
  };

  return (
    <div className="p-3 bg-status-info/5 border border-status-info/30 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-status-info text-sm">+</span>
          <span className="text-text-primary text-xs font-medium">
            {capabilities.length} new {capabilities.length === 1 ? 'capability' : 'capabilities'} detected
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            disabled={creating}
            className="text-[10px] h-5 px-1.5"
          >
            Dismiss
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateAll}
            disabled={creating}
            className="text-[10px] h-5 px-1.5"
          >
            {creating ? 'Creating...' : 'Create All'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {capabilities.map((cap, i) => (
          <div
            key={`${cap.type}-${cap.path}-${i}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-bg-secondary border border-border"
          >
            <Badge
              variant={cap.type === 'skill' ? 'success' : 'warning'}
              className="text-[8px] px-1 py-0"
            >
              {cap.type}
            </Badge>
            <span className="text-text-secondary">{cap.name}</span>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-status-error text-[10px]">{error}</p>
      )}
    </div>
  );
}
