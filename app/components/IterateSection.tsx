'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';

interface IterateSectionProps {
  outcomeId: string;
  onSuccess?: () => void;
}

export function IterateSection({ outcomeId, onSuccess }: IterateSectionProps): JSX.Element {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startWorkerAfter, setStartWorkerAfter] = useState(true);

  const handleSubmit = async () => {
    if (!feedback.trim()) {
      toast({ type: 'warning', message: 'Please describe what you want changed' });
      return;
    }

    setSubmitting(true);
    try {
      // Create tasks from feedback
      const response = await fetch(`/api/outcomes/${outcomeId}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: feedback.trim(),
          startWorker: startWorkerAfter,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({
          type: 'success',
          message: data.tasksCreated
            ? `Created ${data.tasksCreated} task${data.tasksCreated !== 1 ? 's' : ''}${startWorkerAfter ? ' - worker starting' : ''}`
            : 'Feedback submitted',
        });
        setFeedback('');
        onSuccess?.();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to submit feedback' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to submit feedback' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Iterate</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-text-tertiary text-xs mb-3">
          Found a bug? Want changes? Describe what needs to be different.
        </p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="e.g., The button color should be blue instead of green, or the footer links are broken..."
          className="w-full h-24 p-3 text-sm bg-bg-secondary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
        />
        <div className="flex items-center gap-2 mt-3">
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={startWorkerAfter}
              onChange={(e) => setStartWorkerAfter(e.target.checked)}
              className="rounded border-border"
            />
            Start worker after
          </label>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="w-full mt-3"
          onClick={handleSubmit}
          disabled={submitting || !feedback.trim()}
        >
          {submitting ? 'Submitting...' : 'Submit Changes'}
        </Button>
      </CardContent>
    </Card>
  );
}
