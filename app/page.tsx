'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommandBar } from './components/CommandBar';
import { SystemStatus } from './components/SystemStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { ActivityFeed } from './components/ActivityFeed';
import { OutcomeCard, type OutcomeWithCounts } from './components/OutcomeCard';
import { Card, CardContent } from './components/ui/Card';
import { Badge } from './components/ui/Badge';

type FilterStatus = 'all' | 'active' | 'dormant' | 'achieved';

export default function Dashboard(): JSX.Element {
  const router = useRouter();
  const [outcomes, setOutcomes] = useState<OutcomeWithCounts[]>([]);
  const [loading, setLoading] = useState(false);
  const [outcomesLoading, setOutcomesLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [lastResponse, setLastResponse] = useState<string | null>(null);

  // Fetch outcomes on mount and poll for updates
  const fetchOutcomes = useCallback(async () => {
    try {
      const response = await fetch('/api/outcomes?counts=true');
      const data = await response.json();
      setOutcomes(data.outcomes || []);
    } catch (error) {
      console.error('Failed to fetch outcomes:', error);
    } finally {
      setOutcomesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOutcomes();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchOutcomes, 5000);
    return () => clearInterval(interval);
  }, [fetchOutcomes]);

  const handleSubmit = useCallback(async (input: string) => {
    setLoading(true);
    setLastResponse(null);

    try {
      const response = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      const data = await response.json();
      setLastResponse(data.response || data.error || 'Processing...');

      // Refresh outcomes if a new one was created
      if (data.projectId) {
        fetchOutcomes();
        // Navigate to the new outcome
        router.push(`/outcome/${data.projectId}`);
      }
    } catch (error) {
      setLastResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [fetchOutcomes, router]);

  const handleStartWorker = async (outcomeId: string) => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/workers`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        fetchOutcomes();
      } else {
        console.error('Failed to start worker:', data.error);
      }
    } catch (error) {
      console.error('Failed to start worker:', error);
    }
  };

  const handlePauseOutcome = async (outcomeId: string) => {
    try {
      await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dormant' }),
      });
      fetchOutcomes();
    } catch (error) {
      console.error('Failed to pause outcome:', error);
    }
  };

  const handleAchieveOutcome = async (outcomeId: string) => {
    try {
      await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'achieved' }),
      });
      fetchOutcomes();
    } catch (error) {
      console.error('Failed to achieve outcome:', error);
    }
  };

  const handleResumeOutcome = async (outcomeId: string) => {
    try {
      await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      fetchOutcomes();
    } catch (error) {
      console.error('Failed to resume outcome:', error);
    }
  };

  // Filter outcomes based on selected filter
  const filteredOutcomes = outcomes.filter((o) => {
    if (filterStatus === 'all') return true;
    return o.status === filterStatus;
  });

  // Group outcomes by status for display
  const activeOutcomes = filteredOutcomes.filter((o) => o.status === 'active');
  const dormantOutcomes = filteredOutcomes.filter((o) => o.status === 'dormant');
  const achievedOutcomes = filteredOutcomes.filter((o) => o.status === 'achieved');

  // Calculate stats
  const activeWorkerCount = outcomes.reduce((sum, o) => sum + o.active_workers, 0);
  const totalPendingTasks = outcomes.reduce((sum, o) => sum + o.pending_tasks, 0);
  const totalCompletedTasks = outcomes.reduce((sum, o) => sum + o.completed_tasks, 0);

  return (
    <main className="flex-1 flex flex-col max-w-6xl mx-auto w-full p-6 pb-20">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">@virtual_rf</h1>
          <p className="text-text-secondary mt-1">Your personal AI workforce</p>
        </div>
        <ThemeToggle />
      </header>

      {/* Command Bar */}
      <div className="mb-6">
        <CommandBar onSubmit={handleSubmit} loading={loading} />
        {lastResponse && (
          <Card padding="sm" className="mt-3">
            <CardContent>
              <p className="text-text-secondary text-sm whitespace-pre-wrap">{lastResponse}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main Content Grid - Outcomes left, Activity right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Column: Outcomes (main area) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Section Header with Filter */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
              Outcomes
            </h2>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="text-xs bg-bg-secondary border border-border rounded px-2 py-1 text-text-secondary focus:outline-none focus:border-accent"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="achieved">Achieved</option>
            </select>
          </div>

          {outcomesLoading ? (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary text-sm">Loading outcomes...</p>
              </CardContent>
            </Card>
          ) : filteredOutcomes.length === 0 ? (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">
                  {filterStatus === 'all'
                    ? "No outcomes yet."
                    : `No ${filterStatus} outcomes.`}
                </p>
                {filterStatus === 'all' && (
                  <p className="text-text-tertiary text-sm">
                    Start by describing what you want to achieve. Try: "Build a simple calculator app" or "Research competitors in the AI space"
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Active Outcomes */}
              {activeOutcomes.length > 0 && (filterStatus === 'all' || filterStatus === 'active') && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs text-text-tertiary font-medium">Active</h3>
                    <Badge variant="success" className="text-[10px]">{activeOutcomes.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeOutcomes.map((outcome) => (
                      <OutcomeCard
                        key={outcome.id}
                        outcome={outcome}
                        onStartWorker={() => handleStartWorker(outcome.id)}
                        onPause={() => handlePauseOutcome(outcome.id)}
                        onAchieve={() => handleAchieveOutcome(outcome.id)}
                        onClick={() => router.push(`/outcome/${outcome.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Dormant Outcomes */}
              {dormantOutcomes.length > 0 && (filterStatus === 'all' || filterStatus === 'dormant') && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs text-text-tertiary font-medium">Dormant</h3>
                    <Badge variant="warning" className="text-[10px]">{dormantOutcomes.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {dormantOutcomes.map((outcome) => (
                      <OutcomeCard
                        key={outcome.id}
                        outcome={outcome}
                        onStartWorker={() => handleResumeOutcome(outcome.id)}
                        onClick={() => router.push(`/outcome/${outcome.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Achieved Outcomes */}
              {achievedOutcomes.length > 0 && (filterStatus === 'all' || filterStatus === 'achieved') && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs text-text-tertiary font-medium">Achieved</h3>
                    <Badge variant="success" className="text-[10px]">{achievedOutcomes.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(filterStatus === 'achieved' ? achievedOutcomes : achievedOutcomes.slice(0, 4)).map((outcome) => (
                      <OutcomeCard
                        key={outcome.id}
                        outcome={outcome}
                        onClick={() => router.push(`/outcome/${outcome.id}`)}
                      />
                    ))}
                  </div>
                  {filterStatus === 'all' && achievedOutcomes.length > 4 && (
                    <button
                      onClick={() => setFilterStatus('achieved')}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      View all {achievedOutcomes.length} achieved →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Activity Feed */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            Activity
          </h2>
          <ActivityFeed
            onOutcomeClick={(outcomeId) => router.push(`/outcome/${outcomeId}`)}
          />
        </div>
      </div>

      {/* System Status */}
      <SystemStatus
        activeAgents={activeWorkerCount}
        todayCost={0}
        skillsLoaded={totalPendingTasks}
      />
    </main>
  );
}
