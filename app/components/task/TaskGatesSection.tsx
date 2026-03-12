'use client';

import { Button } from '@/app/components/ui/Button';
import type { TaskGate } from '@/lib/db/schema';

interface TaskGatesSectionProps {
  taskStatus: string;
  parsedGates: TaskGate[];
  showAddGate: boolean;
  setShowAddGate: (show: boolean) => void;
  newGateType: 'document_required' | 'human_approval';
  setNewGateType: (type: 'document_required' | 'human_approval') => void;
  newGateLabel: string;
  setNewGateLabel: (label: string) => void;
  addingGate: boolean;
  onAddGate: () => void;
  onSatisfyGate: (gate: TaskGate) => void;
}

export function TaskGatesSection({
  taskStatus,
  parsedGates,
  showAddGate,
  setShowAddGate,
  newGateType,
  setNewGateType,
  newGateLabel,
  setNewGateLabel,
  addingGate,
  onAddGate,
  onSatisfyGate,
}: TaskGatesSectionProps): JSX.Element | null {
  const showSection = taskStatus === 'pending' || parsedGates.length > 0;
  if (!showSection) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-text-tertiary uppercase tracking-wide">
          Gates {parsedGates.length > 0
            ? `(${parsedGates.filter(g => g.status === 'pending').length} pending)`
            : ''}
        </label>
        {taskStatus === 'pending' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddGate(!showAddGate)}
            className="text-xs h-6 px-2"
          >
            + Add Gate
          </Button>
        )}
      </div>

      {/* Add Gate Form */}
      {showAddGate && (
        <div className="mb-2 p-3 bg-bg-tertiary border border-border rounded-lg space-y-2">
          <select
            value={newGateType}
            onChange={(e) => setNewGateType(e.target.value as 'document_required' | 'human_approval')}
            className="w-full p-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="document_required">Document Required</option>
            <option value="human_approval">Human Approval</option>
          </select>
          <input
            type="text"
            value={newGateLabel}
            onChange={(e) => setNewGateLabel(e.target.value)}
            placeholder="e.g., User interview responses"
            className="w-full p-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={onAddGate}
              disabled={addingGate || !newGateLabel.trim()}
              className="text-xs"
            >
              {addingGate ? 'Adding...' : 'Add'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowAddGate(false); setNewGateLabel(''); }}
              className="text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {parsedGates.length === 0 && !showAddGate && (
        <p className="text-text-tertiary text-sm">
          No gates — add a gate to require human input before this task can be claimed by a worker.
        </p>
      )}

      <div className="space-y-2">
        {parsedGates.map((gate) => (
          <div
            key={gate.id}
            className={`flex items-center justify-between px-3 py-2 rounded text-xs border ${
              gate.status === 'satisfied'
                ? 'bg-status-success/10 border-status-success/30'
                : 'bg-status-warning/10 border-status-warning/30'
            }`}
          >
            <div className="flex items-center gap-2">
              <span>{gate.status === 'satisfied' ? '✓' : '⏳'}</span>
              <span className={gate.status === 'satisfied' ? 'text-status-success' : 'text-status-warning'}>
                {gate.label}
              </span>
              <span className="text-[10px] opacity-60 uppercase">{gate.type.replace('_', ' ')}</span>
            </div>
            <div className="flex items-center gap-2">
              {gate.status === 'satisfied' && gate.satisfied_at && (
                <span className="text-[10px] text-text-tertiary">
                  {new Date(gate.satisfied_at).toLocaleDateString()}
                </span>
              )}
              {gate.status === 'pending' && (
                <Button
                  variant="primary"
                  size="sm"
                  className="text-[10px] px-2 py-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSatisfyGate(gate);
                  }}
                >
                  {gate.type === 'document_required' ? 'Provide Input' : 'Approve'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
