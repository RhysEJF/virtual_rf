'use client';

/**
 * HOMЯ Escalation Alert
 *
 * Shows a prominent alert when an escalation is pending.
 * Allows the user to answer the question or dismiss it.
 */

import { useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface QuestionOption {
  id: string;
  label: string;
  description: string;
  implications: string;
}

interface Escalation {
  id: string;
  outcomeId: string;
  createdAt: number;
  status: 'pending' | 'answered' | 'dismissed';
  trigger: {
    type: string;
    taskId: string;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: QuestionOption[];
  };
  affectedTasks: string[];
}

interface Props {
  escalation: Escalation;
  onAnswer: (escalationId: string, selectedOption: string, additionalContext?: string) => Promise<void>;
  onDismiss: (escalationId: string) => Promise<void>;
}

export function EscalationAlert({ escalation, onAnswer, onDismiss }: Props): JSX.Element {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [additionalContext, setAdditionalContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!selectedOption) return;

    setSubmitting(true);
    setError(null);

    try {
      await onAnswer(escalation.id, selectedOption, additionalContext || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDismiss(): Promise<void> {
    setSubmitting(true);
    setError(null);

    try {
      await onDismiss(escalation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-status-warning">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-status-warning text-lg">!</span>
          <h3 className="font-semibold text-text-primary">HOMЯ Needs Input</h3>
        </div>
        <Badge variant="warning">{escalation.trigger.type.replace('_', ' ')}</Badge>
      </div>

      {/* Question */}
      <div className="mb-4">
        <p className="text-text-primary font-medium mb-2">{escalation.question.text}</p>
        <p className="text-text-secondary text-sm">{escalation.question.context}</p>
      </div>

      {/* Options */}
      <div className="space-y-2 mb-4">
        {escalation.question.options.map((option) => (
          <div
            key={option.id}
            className={`p-3 rounded-lg border cursor-pointer transition-colors ${
              selectedOption === option.id
                ? 'border-accent-primary bg-accent-primary/10'
                : 'border-border hover:border-border-hover'
            }`}
            onClick={() => setSelectedOption(option.id)}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  selectedOption === option.id
                    ? 'border-accent-primary'
                    : 'border-text-muted'
                }`}
              >
                {selectedOption === option.id && (
                  <div className="w-2 h-2 rounded-full bg-accent-primary" />
                )}
              </div>
              <span className="font-medium text-text-primary">{option.label}</span>
            </div>
            <p className="text-sm text-text-secondary ml-6">{option.description}</p>
            <p className="text-xs text-text-muted ml-6 mt-1">{option.implications}</p>
          </div>
        ))}
      </div>

      {/* Additional Context */}
      <div className="mb-4">
        <label className="block text-sm text-text-secondary mb-1">
          Additional context (optional)
        </label>
        <textarea
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          placeholder="Add any additional context or notes..."
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg focus:outline-none focus:border-accent-primary resize-none"
          rows={2}
        />
      </div>

      {/* Affected Tasks Info */}
      <div className="text-xs text-text-muted mb-4">
        {escalation.affectedTasks.length} task(s) paused pending this decision
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-status-error mb-4">{error}</div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={submitting}
        >
          Dismiss & Continue
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!selectedOption || submitting}
        >
          {submitting ? 'Submitting...' : 'Submit Decision'}
        </Button>
      </div>
    </Card>
  );
}
