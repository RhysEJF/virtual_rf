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

type CommandState = 'idle' | 'interpreting' | 'suggesting' | 'editing' | 'confirming' | 'executing' | 'error';

interface OutcomeCommandBarProps {
  outcomeId: string;
  outcomeName: string;
  onSuccess?: () => void;
  /** Optional initial input to auto-populate and process (e.g., from dispatcher) */
  initialInput?: string;
  /** Callback when initial input has been consumed */
  onInitialInputConsumed?: () => void;
}

export function OutcomeCommandBar({ outcomeId, outcomeName, onSuccess, initialInput, onInitialInputConsumed }: OutcomeCommandBarProps): JSX.Element {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [state, setState] = useState<CommandState>('idle');
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [editedPlan, setEditedPlan] = useState<ActionPlan | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [fromDispatcher, setFromDispatcher] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const initialInputProcessedRef = useRef(false);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input, refineInput]);

  // Process initial input from dispatcher (auto-populate and auto-submit)
  useEffect(() => {
    if (initialInput && !initialInputProcessedRef.current && state === 'idle') {
      initialInputProcessedRef.current = true;
      setInput(initialInput);
      setFromDispatcher(true);
      onInitialInputConsumed?.();

      // Auto-trigger the interpret flow after a short delay for UX
      const timer = setTimeout(() => {
        handleSubmitWithInput(initialInput);
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [initialInput, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmitWithInput = async (inputText: string) => {
    if (!inputText.trim()) return;

    setState('interpreting');
    setLastError(null);

    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputText.trim() }),
      });

      const data = await response.json();

      if (data.success && data.plan) {
        // Check if the AI was confused (no actions or only warnings)
        const hasUsefulActions = data.plan.actions && data.plan.actions.length > 0;
        const isConfused = data.plan.summary?.toLowerCase().includes('trouble understanding') ||
                          data.plan.summary?.toLowerCase().includes('could you be more specific') ||
                          data.plan.summary?.toLowerCase().includes('ambiguous');

        if (isConfused || !hasUsefulActions) {
          // AI couldn't understand - go to error state but preserve input
          setPlan(data.plan);
          setEditedPlan(data.plan);
          setLastError(data.plan.summary || 'Could not interpret request');
          setState('error');
        } else {
          setPlan(data.plan);
          setEditedPlan(data.plan);
          setState('suggesting');
        }
      } else {
        // API error - preserve input and show error state
        setLastError(data.error || 'Failed to interpret request');
        setState('error');
      }
    } catch (err) {
      // Network error - preserve input and show error state
      setLastError('Failed to connect. Please try again.');
      setState('error');
    }
  };

  const handleSubmit = () => handleSubmitWithInput(input);

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
        // Full reset on success
        handleFullReset();
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

  // Cancel preserves input so user doesn't lose their ramble
  const handleCancel = () => {
    // Keep the input! Don't clear it.
    setPlan(null);
    setEditedPlan(null);
    setRefineInput('');
    setLastError(null);
    // Keep fromDispatcher true if we came from dispatcher so we show context
    setState('idle');
  };

  // Full reset clears everything (use sparingly)
  const handleFullReset = () => {
    setInput('');
    setPlan(null);
    setEditedPlan(null);
    setRefineInput('');
    setFromDispatcher(false);
    setLastError(null);
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
          {/* Show hint if there's preserved input from a previous attempt */}
          {input.trim() && fromDispatcher && (
            <div className="mb-3 p-2 bg-accent/10 border border-accent/30 rounded-lg flex items-center justify-between">
              <p className="text-xs text-accent">Your previous request is preserved. Edit it or press Send to try again.</p>
              <button
                onClick={handleFullReset}
                className="text-xs text-text-tertiary hover:text-text-secondary ml-2"
              >
                Clear
              </button>
            </div>
          )}
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
              rows={input.length > 100 ? 3 : 1}
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
        <div className="p-6">
          {fromDispatcher && (
            <div className="mb-4 p-3 bg-accent/10 border border-accent/30 rounded-lg">
              <p className="text-sm text-accent font-medium">Continuing from dashboard...</p>
              <p className="text-xs text-text-secondary mt-1 line-clamp-2">{input}</p>
            </div>
          )}
          <div className="text-center">
            <div className="flex items-center justify-center gap-3">
              <div className="animate-spin h-5 w-5 border-2 border-accent border-t-transparent rounded-full" />
              <span className="text-text-secondary">Interpreting your request...</span>
            </div>
          </div>
        </div>
      )}

      {/* Error State - Preserve input and allow retry */}
      {state === 'error' && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary">Couldn't Process Request</h3>
            <button
              onClick={handleFullReset}
              className="text-xs text-text-tertiary hover:text-text-secondary"
            >
              Start Over
            </button>
          </div>

          {/* Error Message */}
          <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-lg">
            <p className="text-sm text-status-error">{lastError}</p>
          </div>

          {/* Your Original Input - Show it prominently */}
          <div className="mb-4">
            <p className="text-xs text-text-secondary mb-2">Your original request:</p>
            <div className="p-3 bg-bg-primary border border-border rounded-lg max-h-32 overflow-y-auto">
              <p className="text-sm text-text-primary whitespace-pre-wrap">{input}</p>
            </div>
          </div>

          {/* Add More Context */}
          <div className="mb-4">
            <p className="text-xs text-text-secondary mb-2">Add more context (optional):</p>
            <textarea
              value={refineInput}
              onChange={(e) => setRefineInput(e.target.value)}
              placeholder="Add details, clarify what you want, or mention specific documents..."
              className="w-full p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
              rows={3}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
            >
              Edit Request
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  // Retry with same input
                  setLastError(null);
                  handleSubmitWithInput(input);
                }}
              >
                Try Again
              </Button>
              {refineInput.trim() && (
                <Button
                  variant="primary"
                  onClick={() => {
                    // Combine original + new context and retry
                    const combined = `${input}\n\nAdditional context: ${refineInput}`;
                    setInput(combined);
                    setRefineInput('');
                    setLastError(null);
                    handleSubmitWithInput(combined);
                  }}
                >
                  Submit with Context
                </Button>
              )}
            </div>
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
