'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { PlanViewer } from './PlanViewer';

interface DiscoverySession {
  tier: 'QUICK' | 'STANDARD' | 'DEEP';
  status: 'idle' | 'running' | 'completed' | 'failed';
  phase: string;
  planPath?: string;
}

interface DiscoveryStatusPanelProps {
  outcomeId: string;
}

const PHASES = ['clarity-check', 'interview', 'research', 'planning', 'task-generation', 'done'];

const PHASE_LABELS: Record<string, string> = {
  'clarity-check': 'Clarity',
  'interview': 'Interview',
  'research': 'Research',
  'planning': 'Planning',
  'task-generation': 'Tasks',
  'done': 'Done',
};

function getPhaseIndex(phase: string): number {
  const idx = PHASES.indexOf(phase);
  return idx >= 0 ? idx : -1;
}

/**
 * Get the phases to display based on tier.
 * DEEP tier shows all phases including interview.
 * STANDARD/QUICK skip interview.
 */
function getPhasesForTier(tier?: string): string[] {
  if (tier === 'DEEP') return PHASES;
  return PHASES.filter(p => p !== 'interview');
}

export function DiscoveryStatusPanel({ outcomeId }: DiscoveryStatusPanelProps): JSX.Element {
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [selectedTier, setSelectedTier] = useState<'QUICK' | 'STANDARD' | 'DEEP'>('STANDARD');

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/discover`);
      if (res.ok) {
        const data = await res.json();
        setSession(data.session || null);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Poll while running
  const sessionStatus = session?.status;
  useEffect(() => {
    if (sessionStatus !== 'running') return;
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, [sessionStatus, fetchSession]);

  const handleStart = async (): Promise<void> => {
    setStarting(true);
    try {
      const res = await fetch(`/api/outcomes/${outcomeId}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier }),
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.session || { tier: selectedTier, status: 'running', phase: 'clarity-check' });
      }
    } catch {
      // Silent fail
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <></>;

  // No session — show start button
  if (!session) {
    return (
      <div className="p-3 bg-bg-secondary rounded-lg border border-border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary font-medium">Discovery</p>
            <p className="text-xs text-text-tertiary">Analyze and plan before execution</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value as 'QUICK' | 'STANDARD' | 'DEEP')}
              className="text-xs bg-bg-primary border border-border rounded px-2 py-1 text-text-primary"
            >
              <option value="QUICK">Quick</option>
              <option value="STANDARD">Standard</option>
              <option value="DEEP">Deep</option>
            </select>
            <Button variant="primary" size="sm" onClick={handleStart} disabled={starting}>
              {starting ? 'Starting...' : 'Discover'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const displayPhases = getPhasesForTier(session.tier);
  const currentPhaseIndex = displayPhases.indexOf(session.phase);
  const isRunning = session.status === 'running';
  const isCompleted = session.status === 'completed' || session.phase === 'done';
  const isFailed = session.status === 'failed';

  return (
    <div className="p-3 bg-bg-secondary rounded-lg border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-text-primary font-medium">Discovery</p>
          <Badge variant={
            isCompleted ? 'success' : isFailed ? 'error' : isRunning ? 'info' : 'default'
          }>
            {session.tier}
          </Badge>
        </div>
        <span className={`text-xs ${
          isCompleted ? 'text-status-success' : isFailed ? 'text-status-error' : isRunning ? 'text-status-info' : 'text-text-tertiary'
        }`}>
          {isCompleted ? 'Complete' : isFailed ? 'Failed' : isRunning ? 'Running...' : session.status}
        </span>
      </div>

      {/* Phase stepper */}
      <div className="flex items-center gap-1">
        {displayPhases.map((phase, idx) => {
          const isActive = phase === session.phase && isRunning;
          const isDone = idx < currentPhaseIndex || isCompleted;
          const isCurrent = idx === currentPhaseIndex;

          return (
            <div key={phase} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-full h-1.5 rounded-full ${
                    isDone
                      ? 'bg-status-success'
                      : isActive
                      ? 'bg-status-info animate-pulse'
                      : 'bg-bg-tertiary'
                  }`}
                />
                <span className={`text-[10px] mt-1 ${
                  isDone
                    ? 'text-status-success'
                    : isCurrent
                    ? 'text-text-primary font-medium'
                    : 'text-text-tertiary'
                }`}>
                  {PHASE_LABELS[phase] || phase}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Plan viewer — nested inside discovery when plan exists */}
      {(isCompleted || session.planPath) && (
        <PlanViewer outcomeId={outcomeId} />
      )}
    </div>
  );
}
