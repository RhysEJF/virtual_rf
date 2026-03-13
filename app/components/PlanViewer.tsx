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

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Optimize mode
  const [ramble, setRamble] = useState('');
  const [optimizing, setOptimizing] = useState(false);

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

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(plan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent fail
    }
  };

  const handleEdit = (): void => {
    setEditContent(plan);
    setEditing(true);
    setExpanded(true);
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: editContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan);
        setEditing(false);
      }
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  const handleOptimize = async (): Promise<void> => {
    if (!ramble.trim()) return;
    setOptimizing(true);
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ramble }),
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan);
        setRamble('');
        setExpanded(true);
      }
    } catch {
      // Silent fail
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="mt-3 border border-border rounded-lg overflow-hidden bg-bg-primary">
      {/* Header — clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2.5 text-xs hover:bg-bg-tertiary"
      >
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-medium">PLAN.md</span>
          <span className="text-text-tertiary">
            {plan.split('\n').length} lines
          </span>
        </div>
        <span className={`transition-transform text-text-tertiary ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Toolbar */}
          <div className="flex items-center justify-end gap-1 p-1.5 border-b border-border bg-bg-secondary">
            <Button variant="ghost" size="sm" onClick={handleCopy} className="text-xs h-6 px-2">
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            {!editing && (
              <Button variant="ghost" size="sm" onClick={handleEdit} className="text-xs h-6 px-2">
                Edit
              </Button>
            )}
          </div>

          {/* Content — edit mode or display mode */}
          {editing ? (
            <div className="p-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-96 p-2 text-xs font-mono bg-bg-primary border border-border rounded text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="text-xs">
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={saving} className="text-xs">
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <pre className="p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
              {plan}
            </pre>
          )}

          {/* Optimize ramble box */}
          {!editing && (
            <div className="border-t border-border p-2.5 bg-bg-secondary">
              <textarea
                value={ramble}
                onChange={(e) => setRamble(e.target.value)}
                placeholder="Describe changes to the plan... (then click Optimize)"
                className="w-full h-16 p-2 text-xs bg-bg-primary border border-border rounded text-text-primary resize-none placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
              <div className="flex justify-end mt-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOptimize}
                  disabled={!ramble.trim() || optimizing}
                  className="text-xs"
                >
                  {optimizing ? 'Optimizing...' : 'Optimize'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
