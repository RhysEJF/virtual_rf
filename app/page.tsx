'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommandBar, type RequestMode } from './components/CommandBar';
import { SystemStatus } from './components/SystemStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { ActivityFeed } from './components/ActivityFeed';
import { SupervisorAlerts } from './components/SupervisorAlerts';
import { ImprovementSuggestions } from './components/ImprovementSuggestions';
import { OutcomeCard, type OutcomeWithCounts } from './components/OutcomeCard';
import { OutcomeTreeView, type OutcomeTreeNode } from './components/OutcomeTreeView';
import { Card, CardContent } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';

// Simple SVG icons for view mode toggle
function ListIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function TreeIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

type FilterStatus = 'all' | 'active' | 'dormant' | 'achieved';
type ViewMode = 'flat' | 'tree';

const FILTER_STORAGE_KEY = 'virtualrf_outcome_filter';
const VIEW_MODE_STORAGE_KEY = 'virtualrf_view_mode';

interface MatchedOutcome {
  id: string;
  name: string;
  brief: string | null;
  confidence: 'high' | 'medium';
  reason: string;
}

interface MatchState {
  matches: MatchedOutcome[];
  originalInput: string;
}

export default function Dashboard(): JSX.Element {
  const router = useRouter();
  const [outcomes, setOutcomes] = useState<OutcomeWithCounts[]>([]);
  const [treeOutcomes, setTreeOutcomes] = useState<OutcomeTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [outcomesLoading, setOutcomesLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [skillsCount, setSkillsCount] = useState(0);

  // Load filter and view mode from localStorage on mount
  useEffect(() => {
    const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
    if (savedFilter && ['all', 'active', 'dormant', 'achieved'].includes(savedFilter)) {
      setFilterStatus(savedFilter as FilterStatus);
    }
    const savedViewMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (savedViewMode && ['flat', 'tree'].includes(savedViewMode)) {
      setViewMode(savedViewMode as ViewMode);
    }
  }, []);

  // Save filter to localStorage when it changes
  const handleFilterChange = (newFilter: FilterStatus) => {
    setFilterStatus(newFilter);
    localStorage.setItem(FILTER_STORAGE_KEY, newFilter);
  };

  // Save view mode to localStorage when it changes
  const handleViewModeChange = (newMode: ViewMode) => {
    setViewMode(newMode);
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, newMode);
  };

  // Fetch skills count (global + outcome skills)
  const fetchSkillsCount = useCallback(async () => {
    try {
      const [globalResponse, outcomeResponse] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/skills/outcome'),
      ]);
      const globalData = await globalResponse.json();
      const outcomeData = await outcomeResponse.json();
      const globalCount = globalData.total || 0;
      const outcomeCount = outcomeData.total || 0;
      setSkillsCount(globalCount + outcomeCount);
    } catch (error) {
      console.error('Failed to fetch skills count:', error);
    }
  }, []);

  // Fetch outcomes on mount and poll for updates
  const fetchOutcomes = useCallback(async () => {
    try {
      // Fetch both flat and tree views
      const [flatResponse, treeResponse] = await Promise.all([
        fetch('/api/outcomes?counts=true'),
        fetch('/api/outcomes?tree=true'),
      ]);
      const flatData = await flatResponse.json();
      const treeData = await treeResponse.json();
      setOutcomes(flatData.outcomes || []);
      setTreeOutcomes(treeData.outcomes || []);
    } catch (error) {
      console.error('Failed to fetch outcomes:', error);
    } finally {
      setOutcomesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOutcomes();
    fetchSkillsCount();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchOutcomes, 5000);
    return () => clearInterval(interval);
  }, [fetchOutcomes, fetchSkillsCount]);

  const handleSubmit = useCallback(async (input: string, mode: RequestMode, skipMatching?: boolean) => {
    setLoading(true);
    setLastResponse(null);
    setMatchState(null);

    try {
      const response = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, modeHint: mode, skipMatching }),
      });

      const data = await response.json();

      // Smart Dispatcher: matches found - show options to user
      if (data.type === 'match_found' && data.matchedOutcomes?.length > 0) {
        setMatchState({
          matches: data.matchedOutcomes,
          originalInput: data.originalInput || input,
        });
        return;
      }

      // For outcomes (research/deep work), navigate to the detail page
      if (data.type === 'outcome' && data.navigateTo) {
        fetchOutcomes();
        router.push(data.navigateTo);
        return; // Don't show inline response, navigate instead
      }

      // For quick tasks and clarifications, show inline response
      setLastResponse(data.response || data.error || 'Processing...');

      // Legacy support: if projectId exists but no navigateTo
      if (data.projectId || data.outcomeId) {
        fetchOutcomes();
      }
    } catch (error) {
      setLastResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [fetchOutcomes, router]);

  // Handle user choosing to add to an existing outcome
  const handleAddToOutcome = useCallback((outcomeId: string) => {
    const originalInput = matchState?.originalInput;
    setMatchState(null);
    // Pass the original input as a query param so the outcome page can auto-trigger refinement
    if (originalInput) {
      const encoded = encodeURIComponent(originalInput);
      router.push(`/outcome/${outcomeId}?refinement=${encoded}`);
    } else {
      router.push(`/outcome/${outcomeId}`);
    }
  }, [router, matchState]);

  // Handle user choosing to create a new outcome anyway
  const handleCreateNew = useCallback(() => {
    if (matchState) {
      const { originalInput } = matchState;
      setMatchState(null);
      // Re-dispatch with skipMatching flag
      handleSubmit(originalInput, 'smart', true);
    }
  }, [matchState, handleSubmit]);

  // Handle user dismissing the match dialog
  const handleDismissMatch = useCallback(() => {
    setMatchState(null);
  }, []);

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/skills')}
            className="text-text-tertiary hover:text-text-secondary transition-colors text-sm"
            title="Skills Library"
          >
            Skills
          </button>
          <button
            onClick={() => router.push('/settings')}
            className="text-text-tertiary hover:text-text-secondary transition-colors text-sm"
            title="Settings"
          >
            Settings
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Command Bar */}
      <div className="mb-6">
        <CommandBar onSubmit={(input, mode) => handleSubmit(input, mode)} loading={loading} />

        {/* Match Found - Show Options */}
        {matchState && (
          <Card padding="md" className="mt-3 border-accent/30">
            <CardContent>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-text-primary font-medium text-sm">Related outcome found</h3>
                  <p className="text-text-tertiary text-xs mt-1">
                    Would you like to add to an existing outcome or create a new one?
                  </p>
                </div>
                <button
                  onClick={handleDismissMatch}
                  className="text-text-tertiary hover:text-text-secondary text-xs"
                >
                  Dismiss
                </button>
              </div>

              <div className="space-y-2 mb-4">
                {matchState.matches.map((match) => (
                  <button
                    key={match.id}
                    onClick={() => handleAddToOutcome(match.id)}
                    className="w-full text-left p-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-text-primary text-sm font-medium">{match.name}</span>
                      <Badge variant={match.confidence === 'high' ? 'success' : 'info'} className="text-[10px]">
                        {match.confidence}
                      </Badge>
                    </div>
                    <p className="text-text-tertiary text-xs mt-1">{match.reason}</p>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <p className="text-text-tertiary text-xs">
                  Your request: "{matchState.originalInput.substring(0, 50)}{matchState.originalInput.length > 50 ? '...' : ''}"
                </p>
                <Button variant="secondary" size="sm" onClick={handleCreateNew}>
                  Create New Outcome
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Regular Response */}
        {lastResponse && !matchState && (
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
          {/* Section Header with View Toggle and Filter */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
                Outcomes
              </h2>
              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-bg-secondary rounded-md p-0.5 border border-border">
                <button
                  onClick={() => handleViewModeChange('flat')}
                  className={`p-1.5 rounded transition-colors ${
                    viewMode === 'flat'
                      ? 'bg-bg-primary text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                  title="Flat view"
                >
                  <ListIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleViewModeChange('tree')}
                  className={`p-1.5 rounded transition-colors ${
                    viewMode === 'tree'
                      ? 'bg-bg-primary text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                  title="Tree view"
                >
                  <TreeIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <select
              value={filterStatus}
              onChange={(e) => handleFilterChange(e.target.value as FilterStatus)}
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
          ) : viewMode === 'tree' ? (
            /* Tree View */
            <OutcomeTreeView
              outcomes={treeOutcomes}
              onOutcomeClick={(id) => router.push(`/outcome/${id}`)}
              onStartWorker={handleStartWorker}
              onPause={handlePauseOutcome}
              filterStatus={filterStatus}
            />
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
            /* Flat View */
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
                      onClick={() => handleFilterChange('achieved')}
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

        {/* Right Column: Supervisor & Activity Feed */}
        <div className="space-y-6">
          {/* Supervisor Alerts */}
          <SupervisorAlerts
            onWorkerClick={(workerId) => router.push(`/worker/${workerId}`)}
            onOutcomeClick={(outcomeId) => router.push(`/outcome/${outcomeId}`)}
          />

          {/* Improvement Suggestions */}
          <ImprovementSuggestions />

          {/* Activity Feed */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
              Activity
            </h2>
            <ActivityFeed
              onOutcomeClick={(outcomeId) => router.push(`/outcome/${outcomeId}`)}
              showFilter
            />
          </div>
        </div>
      </div>

      {/* System Status */}
      <SystemStatus
        activeAgents={activeWorkerCount}
        skillsLoaded={skillsCount}
      />
    </main>
  );
}
