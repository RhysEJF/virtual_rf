'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';
import type { ImprovementSuggestion, SuggestionType } from '@/lib/db/schema';

const typeConfig: Record<SuggestionType, { label: string; variant: 'info' | 'warning' | 'default' }> = {
  skill: { label: 'Skill Gap', variant: 'info' },
  automation: { label: 'Automation', variant: 'warning' },
  process: { label: 'Process', variant: 'default' },
};

export function ImprovementSuggestions(): JSX.Element | null {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<ImprovementSuggestion[]>([]);
  const [engineRunning, setEngineRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | 'analyze' | null>(null);

  const fetchSuggestions = useCallback(async () => {
    try {
      const response = await fetch('/api/improvements');
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
        setEngineRunning(data.engine?.running || false);
      }
    } catch (err) {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuggestions();
    const interval = setInterval(fetchSuggestions, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchSuggestions]);

  const handleRunAnalysis = async () => {
    setActionLoading('analyze');
    try {
      const response = await fetch('/api/improvements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze' }),
      });
      const data = await response.json();
      if (data.success) {
        toast({
          type: 'success',
          message: data.message,
        });
        fetchSuggestions();
      } else {
        toast({ type: 'error', message: data.error || 'Analysis failed' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to run analysis' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (suggestionId: number) => {
    setActionLoading(suggestionId);
    try {
      const response = await fetch('/api/improvements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion_id: suggestionId, status: 'accepted' }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Suggestion accepted' });
        fetchSuggestions();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to accept suggestion' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to accept suggestion' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismiss = async (suggestionId: number) => {
    setActionLoading(suggestionId);
    try {
      const response = await fetch('/api/improvements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion_id: suggestionId, status: 'dismissed' }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'info', message: 'Suggestion dismissed' });
        fetchSuggestions();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to dismiss suggestion' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to dismiss suggestion' });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return null;
  }

  // Don't render if no suggestions
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Improvements</CardTitle>
          <Badge variant="info" className="text-[10px]">{suggestions.length}</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRunAnalysis}
          disabled={actionLoading === 'analyze'}
        >
          {actionLoading === 'analyze' ? 'Analyzing...' : 'Analyze'}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {suggestions.slice(0, 5).map((suggestion) => {
            const config = typeConfig[suggestion.type];
            const isLoading = actionLoading === suggestion.id;
            return (
              <div
                key={suggestion.id}
                className="p-3 rounded-lg bg-bg-secondary border border-border"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={config.variant} className="text-[10px]">
                      {config.label}
                    </Badge>
                    {suggestion.priority > 3 && (
                      <span className="text-xs text-text-tertiary">
                        {suggestion.priority}x pattern
                      </span>
                    )}
                  </div>
                </div>
                <h4 className="text-sm font-medium text-text-primary mb-1">
                  {suggestion.title}
                </h4>
                <p className="text-xs text-text-secondary mb-2 line-clamp-2">
                  {suggestion.description}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAccept(suggestion.id)}
                    disabled={isLoading}
                    className="text-status-success"
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDismiss(suggestion.id)}
                    disabled={isLoading}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
          {suggestions.length > 5 && (
            <p className="text-xs text-text-tertiary text-center">
              +{suggestions.length - 5} more suggestions
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
