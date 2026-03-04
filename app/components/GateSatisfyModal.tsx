'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/Button';
import type { TaskGate } from '@/lib/db/schema';

interface GateSatisfyModalProps {
  gate: TaskGate;
  taskId: string;
  onClose: () => void;
  onSatisfied: () => void;
}

export function GateSatisfyModal({
  gate,
  taskId,
  onClose,
  onSatisfied,
}: GateSatisfyModalProps): JSX.Element {
  const [responseData, setResponseData] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDocumentGate = gate.type === 'document_required';

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSubmit = async (): Promise<void> => {
    if (isDocumentGate && !responseData.trim()) {
      setError('Please provide the required input.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body = isDocumentGate
        ? { response_data: responseData.trim() }
        : {};

      const response = await fetch(`/api/tasks/${taskId}/gates/${gate.id}/satisfy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to satisfy gate');
      }

      onSatisfied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg border border-border max-w-lg w-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border bg-bg-secondary">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-text-primary">
                {isDocumentGate ? 'Provide Input' : 'Approve Gate'}
              </h2>
              <p className="text-text-secondary text-sm mt-1">{gate.label}</p>
            </div>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary transition-colors p-1"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {gate.description && (
            <div className="text-text-secondary text-sm bg-bg-tertiary rounded-lg p-3">
              {gate.description}
            </div>
          )}

          {isDocumentGate ? (
            <div>
              <label className="text-xs text-text-tertiary uppercase tracking-wide block mb-1.5">
                Response
              </label>
              <textarea
                value={responseData}
                onChange={(e) => { setResponseData(e.target.value); setError(null); }}
                placeholder="Enter the required information..."
                className="w-full h-32 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                autoFocus
              />
            </div>
          ) : (
            <p className="text-text-secondary text-sm">
              Are you sure you want to approve <strong>{gate.label}</strong>? This will unblock the task for workers.
            </p>
          )}

          {error && (
            <div className="bg-status-error/10 border border-status-error/30 rounded-lg p-3">
              <p className="text-status-error text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-bg-secondary flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? 'Submitting...'
              : isDocumentGate ? 'Submit' : 'Approve'}
          </Button>
        </div>
      </div>
    </div>
  );
}
