'use client';

import { useState } from 'react';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';
import type { InterventionActionType } from '@/lib/db/schema';

interface InterventionFormProps {
  outcomeId: string;
  workerId?: string;
  onSuccess?: () => void;
  compact?: boolean;
}

const interventionTypes: { value: InterventionActionType; label: string; description: string }[] = [
  { value: 'add_task', label: 'Add Task', description: 'Create a new task for the worker' },
  { value: 'redirect', label: 'Redirect', description: 'Change worker focus to this instruction' },
  { value: 'pause', label: 'Pause', description: 'Pause the worker' },
];

export function InterventionForm({
  outcomeId,
  workerId,
  onSuccess,
  compact = false,
}: InterventionFormProps): JSX.Element {
  const { toast } = useToast();
  const [type, setType] = useState<InterventionActionType>('add_task');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(!compact);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      toast({ type: 'warning', message: 'Please enter a message' });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message: message.trim(),
          worker_id: workerId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({
          type: 'success',
          message: type === 'add_task'
            ? 'Task created!'
            : type === 'pause'
            ? 'Pause signal sent'
            : 'Intervention sent',
        });
        setMessage('');
        onSuccess?.();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to send intervention' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to send intervention' });
    } finally {
      setSubmitting(false);
    }
  };

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left text-sm text-accent hover:text-accent-hover py-2"
      >
        + Add task or send instruction...
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-2">
        {interventionTypes.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              type === t.value
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
            }`}
            title={t.description}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Message input */}
      <div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            type === 'add_task'
              ? 'What should be done? (e.g., "Fix the calculator buttons not responding")'
              : type === 'redirect'
              ? 'What should the worker focus on instead?'
              : 'Reason for pausing (optional)'
          }
          className="w-full h-20 p-3 text-sm bg-bg-secondary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
          disabled={submitting}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={submitting || !message.trim()}
        >
          {submitting
            ? 'Sending...'
            : type === 'add_task'
            ? 'Add Task'
            : type === 'pause'
            ? 'Pause Worker'
            : 'Send'}
        </Button>
        {compact && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(false);
              setMessage('');
            }}
          >
            Cancel
          </Button>
        )}
        <span className="text-xs text-text-tertiary ml-auto">
          {type === 'add_task' && 'Task will be added to the queue'}
          {type === 'redirect' && 'Worker will see this before next task'}
          {type === 'pause' && 'Worker will stop after current task'}
        </span>
      </div>
    </form>
  );
}
