'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommandBar } from './components/CommandBar';
import { SystemStatus } from './components/SystemStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { OutcomeCard, type OutcomeWithCounts } from './components/OutcomeCard';
import { Card, CardContent } from './components/ui/Card';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  projectId?: string;
}

export default function Dashboard(): JSX.Element {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeWithCounts[]>([]);
  const [loading, setLoading] = useState(false);
  const [outcomesLoading, setOutcomesLoading] = useState(true);

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
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setLoading(true);

    try {
      const response = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.response || data.error || 'No response',
          projectId: data.projectId,
        },
      ]);

      // Refresh outcomes if a new one was created
      if (data.projectId) {
        fetchOutcomes();
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [fetchOutcomes]);

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

  // Group outcomes by status
  const activeOutcomes = outcomes.filter((o) => o.status === 'active');
  const dormantOutcomes = outcomes.filter((o) => o.status === 'dormant');
  const achievedOutcomes = outcomes.filter((o) => o.status === 'achieved');

  // Calculate stats
  const activeWorkerCount = outcomes.reduce((sum, o) => sum + o.active_workers, 0);
  const totalPendingTasks = outcomes.reduce((sum, o) => sum + o.pending_tasks, 0);

  return (
    <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full p-6 pb-20">
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
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Column: Conversation */}
        <div className="lg:col-span-2 space-y-4">
          {messages.length > 0 ? (
            <>
              <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
                Conversation
              </h2>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {messages.map((msg, i) => (
                  <Card key={i} padding="md" className={msg.role === 'user' ? 'ml-8' : 'mr-8'}>
                    <CardContent>
                      <div className="text-xs text-text-tertiary mb-1">
                        {msg.role === 'user' ? 'You' : '@virtual_rf'}
                      </div>
                      <div className="text-text-primary whitespace-pre-wrap text-sm">
                        {msg.content}
                      </div>
                      {msg.projectId && (
                        <button
                          onClick={() => router.push(`/outcome/${msg.projectId}`)}
                          className="mt-2 text-xs text-accent hover:text-accent-hover underline"
                        >
                          View Outcome →
                        </button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">No conversations yet.</p>
                <p className="text-text-tertiary text-sm">
                  Start by describing what you want to achieve. I can help with research, building
                  tools, strategy, and more.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Outcomes */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            Outcomes
          </h2>

          {outcomesLoading ? (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary text-sm">Loading outcomes...</p>
              </CardContent>
            </Card>
          ) : outcomes.length === 0 ? (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary text-sm">
                  No outcomes yet. Tell me what you want to achieve!
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Active Outcomes */}
              {activeOutcomes.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs text-text-tertiary font-medium">Active</h3>
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
              )}

              {/* Dormant Outcomes */}
              {dormantOutcomes.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs text-text-tertiary font-medium">Dormant</h3>
                  {dormantOutcomes.map((outcome) => (
                    <OutcomeCard
                      key={outcome.id}
                      outcome={outcome}
                      onStartWorker={() => handleStartWorker(outcome.id)}
                      onClick={() => router.push(`/outcome/${outcome.id}`)}
                    />
                  ))}
                </div>
              )}

              {/* Achieved Outcomes */}
              {achievedOutcomes.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs text-text-tertiary font-medium">Achieved</h3>
                  {achievedOutcomes.slice(0, 5).map((outcome) => (
                    <OutcomeCard
                      key={outcome.id}
                      outcome={outcome}
                      onClick={() => router.push(`/outcome/${outcome.id}`)}
                    />
                  ))}
                  {achievedOutcomes.length > 5 && (
                    <p className="text-xs text-text-tertiary">
                      +{achievedOutcomes.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </>
          )}
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
