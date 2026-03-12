'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/Button';

interface PlanViewerProps {
  outcomeId: string;
}

export function PlanViewer({ outcomeId }: PlanViewerProps): JSX.Element | null {
  const [plan, setPlan] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/plan`);
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan || null);
        setExists(data.exists || false);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  if (loading || !exists || !plan) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent fail
    }
  };

  return (
    <div className="mt-3 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2 text-xs hover:bg-bg-tertiary"
      >
        <span className="text-text-primary font-medium">PLAN.md</span>
        <span className={`transition-transform text-text-tertiary ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <div className="flex justify-end p-1 border-b border-border">
            <Button variant="ghost" size="sm" onClick={handleCopy} className="text-xs h-6 px-2">
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <pre className="p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-96 overflow-y-auto bg-bg-primary">
            {plan}
          </pre>
        </div>
      )}
    </div>
  );
}
