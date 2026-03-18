'use client';

import { useState, useCallback, useEffect } from 'react';

interface OutcomeEval {
  id: string;
  name: string;
  outcomeId: string;
  path: string;
  description: string;
  mode: string;
  direction: string;
  content?: string;
}

interface EvalsSectionProps {
  outcomeId: string;
}

export function EvalsSection({ outcomeId }: EvalsSectionProps): JSX.Element {
  const [evals, setEvals] = useState<OutcomeEval[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEval, setSelectedEval] = useState<OutcomeEval | null>(null);
  const [evalContent, setEvalContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const fetchEvals = useCallback(async () => {
    try {
      const response = await fetch(`/api/evals/outcome?outcomeId=${outcomeId}&includeContent=true`);
      if (response.ok) {
        const data = await response.json();
        setEvals(data.evals || []);
      }
    } catch (err) {
      console.error('Failed to fetch evals:', err);
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchEvals();
  }, [fetchEvals]);

  const handleSelectEval = async (evalItem: OutcomeEval) => {
    if (selectedEval?.id === evalItem.id) {
      setSelectedEval(null);
      setEvalContent(null);
      return;
    }
    setSelectedEval(evalItem);
    if (evalItem.content) {
      setEvalContent(evalItem.content);
      return;
    }
    setLoadingContent(true);
    try {
      const response = await fetch(`/api/evals/outcome/${encodeURIComponent(`${outcomeId}:${evalItem.id}`)}`);
      if (response.ok) {
        const data = await response.json();
        setEvalContent(data.content || 'No content available');
      }
    } catch (err) {
      console.error('Failed to fetch eval content:', err);
      setEvalContent('Error loading content');
    } finally {
      setLoadingContent(false);
    }
  };

  if (loading) {
    return <p className="text-text-tertiary text-xs">Loading evals...</p>;
  }

  if (evals.length === 0) {
    return (
      <p className="text-text-tertiary text-xs">
        No evals yet. Enable evolve mode on a task to create one.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {evals.map((evalItem) => (
        <div key={evalItem.id} className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => handleSelectEval(evalItem)}
            className="w-full text-left px-3 py-2 hover:bg-bg-secondary/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">{evalItem.name}</span>
              <span className="text-[10px] text-text-tertiary">
                {evalItem.mode} &middot; {evalItem.direction}
              </span>
            </div>
            {evalItem.description && (
              <p className="text-xs text-text-tertiary mt-0.5">{evalItem.description}</p>
            )}
          </button>
          {selectedEval?.id === evalItem.id && (
            <div className="border-t border-border bg-bg-primary p-3">
              {loadingContent ? (
                <p className="text-text-tertiary text-xs">Loading...</p>
              ) : (
                <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap overflow-x-auto max-h-64">
                  {evalContent}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
