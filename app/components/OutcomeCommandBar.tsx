'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';

// Action types the AI can suggest
export interface SuggestedAction {
  id: string;
  type: 'update_intent' | 'update_approach' | 'create_tasks' | 'build_infrastructure' | 'start_worker' | 'pause_workers' | 'run_review';
  description: string;
  details: string;
  data?: Record<string, unknown>;
  enabled: boolean;
}

export interface ActionPlan {
  summary: string;
  reasoning: string;
  actions: SuggestedAction[];
  warnings?: string[];
}

type CommandState = 'idle' | 'interpreting' | 'suggesting' | 'editing' | 'confirming' | 'executing';

interface OutcomeCommandBarProps {
  outcomeId: string;
  outcomeName: string;
  onSuccess?: () => void;
}

export function OutcomeCommandBar({ outcomeId, outcomeName, onSuccess }: OutcomeCommandBarProps): JSX.Element {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [state, setState] = useState<CommandState>('idle');
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [editedPlan, setEditedPlan] = useState<ActionPlan | null>(null);
  const [refineInput, setRefineInput] = useState('');

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input, refineInput]);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    setState('interpreting');

    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim() }),
      });

      const data = await response.json();

      if (data.success && data.plan) {
        setPlan(data.plan);
        setEditedPlan(data.plan);
        setState('suggesting');
      } else {
        toast({ type: 'error', message: data.error || 'Failed to interpret request' });
        setState('idle');
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to interpret request' });
      setState('idle');
    }
  };

  const handleRefine = async () => {
    if (!refineInput.trim()) return;

    setState('interpreting');

    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: refineInput.trim(),
          previousPlan: editedPlan,
          originalInput: input,
        }),
      });

      const data = await response.json();

      if (data.success && data.plan) {
        setPlan(data.plan);
        setEditedPlan(data.plan);
        setRefineInput('');
        setState('suggesting');
      } else {
        toast({ type: 'error', message: data.error || 'Failed to refine plan' });
        setState('suggesting');
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to refine plan' });
      setState('suggesting');
    }
  };

  const handleToggleAction = (actionId: string) => {
    if (!editedPlan) return;

    setEditedPlan({
      ...editedPlan,
      actions: editedPlan.actions.map(action =>
        action.id === actionId ? { ...action, enabled: !action.enabled } : action
      ),
    });
  };

  const handleApprove = () => {
    setState('confirming');
  };

  const handleExecute = async () => {
    if (!editedPlan) return;

    setState('executing');

    try {
      const enabledActions = editedPlan.actions.filter(a => a.enabled);

      const response = await fetch(`/api/outcomes/${outcomeId}/execute-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: enabledActions,
          originalInput: input,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({ type: 'success', message: data.message || 'Plan executed successfully' });
        // Reset state
        setInput('');
        setPlan(null);
        setEditedPlan(null);
        setState('idle');
        onSuccess?.();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to execute plan' });
        setState('suggesting');
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to execute plan' });
      setState('suggesting');
    }
  };

  const handleCancel = () => {
    setInput('');
    setPlan(null);
    setEditedPlan(null);
    setRefineInput('');
    setState('idle');
  };

  const handleBack = () => {
    setState('suggesting');
  };

  // Render based on state
  return (
    <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
      {/* Idle State - Input Box */}
      {state === 'idle' && (
        <div className="p-4">
          <div className="flex gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={`Talk to "${outcomeName}"... Describe changes, add requirements, or give instructions.`}
              className="flex-1 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary min-h-[44px]"
              rows={1}
            />
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="self-end"
            >
              Send
            </Button>
          </div>
          <p className="text-xs text-text-tertiary mt-2">
            Changes will be suggested for your approval before execution.
          </p>
        </div>
      )}

      {/* Interpreting State */}
      {state === 'interpreting' && (
        <div className="p-6 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-accent border-t-transparent rounded-full" />
            <span className="text-text-secondary">Interpreting your request...</span>
          </div>
        </div>
      )}

      {/* Suggesting State - Show Plan */}
      {(state === 'suggesting' || state === 'editing') && editedPlan && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary">Suggested Actions</h3>
            <button
              onClick={handleCancel}
              className="text-xs text-text-tertiary hover:text-text-secondary"
            >
              Cancel
            </button>
          </div>

          {/* AI Reasoning */}
          <div className="mb-4 p-3 bg-bg-primary rounded-lg border border-border">
            <p className="text-sm text-text-secondary">{editedPlan.summary}</p>
            {editedPlan.reasoning && (
              <p className="text-xs text-text-tertiary mt-2">{editedPlan.reasoning}</p>
            )}
          </div>

          {/* Warnings */}
          {editedPlan.warnings && editedPlan.warnings.length > 0 && (
            <div className="mb-4 p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg">
              <p className="text-xs text-status-warning font-medium mb-1">Warnings:</p>
              {editedPlan.warnings.map((warning, i) => (
                <p key={i} className="text-xs text-status-warning">• {warning}</p>
              ))}
            </div>
          )}

          {/* Actions List */}
          <div className="space-y-2 mb-4">
            {editedPlan.actions.map((action) => (
              <div
                key={action.id}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  action.enabled
                    ? 'bg-accent/5 border-accent/30'
                    : 'bg-bg-primary border-border opacity-60'
                }`}
                onClick={() => handleToggleAction(action.id)}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    action.enabled
                      ? 'bg-accent border-accent text-white'
                      : 'border-border'
                  }`}>
                    {action.enabled && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary font-medium">{action.description}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{action.details}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Refine Input */}
          <div className="mb-4">
            <textarea
              value={refineInput}
              onChange={(e) => setRefineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRefine();
                }
              }}
              placeholder="Continue refining... (e.g., 'Actually, don't start the worker yet' or 'Also add...')"
              className="w-full p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
              rows={2}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefine}
              disabled={!refineInput.trim()}
            >
              Refine Plan
            </Button>
            <Button
              variant="primary"
              onClick={handleApprove}
              disabled={!editedPlan.actions.some(a => a.enabled)}
            >
              Approve →
            </Button>
          </div>
        </div>
      )}

      {/* Confirming State - Final Confirmation */}
      {state === 'confirming' && editedPlan && (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-status-warning/20 flex items-center justify-center">
              <span className="text-status-warning">⚠️</span>
            </div>
            <h3 className="text-sm font-medium text-text-primary">Confirm Changes</h3>
          </div>

          <div className="mb-4 p-3 bg-bg-primary rounded-lg border border-border">
            <p className="text-sm text-text-secondary mb-3">
              This will modify the outcome. Are you sure?
            </p>
            <ul className="space-y-1">
              {editedPlan.actions.filter(a => a.enabled).map((action) => (
                <li key={action.id} className="text-xs text-text-tertiary flex items-center gap-2">
                  <span className="text-accent">•</span>
                  {action.description}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
            <Button variant="primary" onClick={handleExecute}>
              Yes, Execute
            </Button>
          </div>
        </div>
      )}

      {/* Executing State */}
      {state === 'executing' && (
        <div className="p-6 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-accent border-t-transparent rounded-full" />
            <span className="text-text-secondary">Executing plan...</span>
          </div>
        </div>
      )}
    </div>
  );
}
