'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import { Button } from '@/app/components/ui/Button';
import { Progress } from '@/app/components/ui/Progress';
import { ProgressView } from '@/app/components/ProgressView';
import { InterventionForm } from '@/app/components/InterventionForm';
import { OutputsSection } from '@/app/components/OutputsSection';
import { GitConfigSection } from '@/app/components/GitConfigSection';
import { SkillsSection } from '@/app/components/SkillsSection';
import { ToolsSection } from '@/app/components/ToolsSection';
import { DocumentsSection } from '@/app/components/DocumentsSection';
import { OutcomeBreadcrumbs } from '@/app/components/OutcomeBreadcrumbs';
import { ChildOutcomesList } from '@/app/components/ChildOutcomesList';
import { CreateChildModal } from '@/app/components/CreateChildModal';
import { ExpandableTaskCard } from '@/app/components/ExpandableTaskCard';
import { ActivityLogDrawer } from '@/app/components/homr/ActivityLogDrawer';
import { useToast } from '@/app/hooks/useToast';
import { CollapsibleSection } from '@/app/components/CollapsibleSection';
import { OutcomeChat } from '@/app/components/OutcomeChat';
import { CommitSettingsSection } from '@/app/components/CommitSettingsSection';
import { HomrDashboard } from '@/app/components/HomrDashboard';
import type { OutcomeStatus, WorkerStatus, Task, Worker, GitMode, SaveTarget } from '@/lib/db/schema';

// Types
interface OutcomeDetail {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;
  brief: string | null;
  intent: string | null;
  timeline: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  capability_ready: number;
  design_doc: { approach: string; version: number } | null;
  tasks: Task[];
  workers: Worker[];
  parent_id: string | null;
  depth: number;
  working_directory: string | null;
  git_mode: GitMode;
  base_branch: string | null;
  work_branch: string | null;
  auto_commit: boolean;
  create_pr_on_complete: boolean;
  repository_id: string | null;
  output_target: SaveTarget;
  skill_target: SaveTarget;
  tool_target: SaveTarget;
  file_target: SaveTarget;
  auto_save: boolean;
}

interface ChildOutcomeInfo {
  id: string;
  name: string;
  status: OutcomeStatus;
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  active_workers: number;
}

interface AggregatedStats {
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  active_workers: number;
  total_descendants: number;
}

interface Breadcrumb {
  id: string;
  name: string;
}

interface TaskStats {
  total: number;
  pending: number;
  claimed: number;
  running: number;
  completed: number;
  failed: number;
}

interface ConvergenceStatus {
  is_converging: boolean;
  consecutive_zero_issues: number;
  trend: string;
  last_issues: number;
  total_cycles: number;
}

// Status configurations
const outcomeStatusConfig: Record<OutcomeStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  active: { label: 'Active', variant: 'success' },
  dormant: { label: 'Dormant', variant: 'warning' },
  achieved: { label: 'Achieved', variant: 'success' },
  archived: { label: 'Archived', variant: 'default' },
};

const workerStatusConfig: Record<WorkerStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  idle: { label: 'Idle', variant: 'default' },
  running: { label: 'Running', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

// Hierarchy/nest icon component
function HierarchyIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="12" x2="6" y2="16" />
      <line x1="12" y1="12" x2="18" y2="16" />
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="19" r="3" />
    </svg>
  );
}

export default function OutcomeDetailPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const outcomeId = params.id as string;

  // Check for refinement input from dispatcher
  const [refinementInput, setRefinementInput] = useState<string | undefined>(() => {
    const refinement = searchParams.get('refinement');
    return refinement ? decodeURIComponent(refinement) : undefined;
  });

  const handleRefinementConsumed = useCallback(() => {
    if (refinementInput) {
      const url = new URL(window.location.href);
      url.searchParams.delete('refinement');
      window.history.replaceState({}, '', url.toString());
      setRefinementInput(undefined);
    }
  }, [refinementInput]);

  const [outcome, setOutcome] = useState<OutcomeDetail | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [convergence, setConvergence] = useState<ConvergenceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Hierarchy state
  const [parent, setParent] = useState<{ id: string; name: string } | null>(null);
  const [children, setChildren] = useState<ChildOutcomeInfo[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [aggregatedStats, setAggregatedStats] = useState<AggregatedStats | null>(null);
  const [isParent, setIsParent] = useState(false);
  const [showCreateChildModal, setShowCreateChildModal] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(false);

  // Left panel tab state
  const [leftPanelTab, setLeftPanelTab] = useState<'context' | 'homr'>('context');

  // Workers tab state
  const [workersTab, setWorkersTab] = useState<'live' | 'history'>('live');

  // Edit mode states
  const [isEditingIntent, setIsEditingIntent] = useState(false);
  const [isEditingApproach, setIsEditingApproach] = useState(false);
  const [editedIntentSummary, setEditedIntentSummary] = useState('');
  const [editedApproach, setEditedApproach] = useState('');
  const [savingIntent, setSavingIntent] = useState(false);
  const [savingApproach, setSavingApproach] = useState(false);

  // Optimize/ramble states
  const [intentRamble, setIntentRamble] = useState('');
  const [approachRamble, setApproachRamble] = useState('');
  const [optimizingIntent, setOptimizingIntent] = useState(false);
  const [optimizingApproach, setOptimizingApproach] = useState(false);

  // Review response state
  const [lastReviewResponse, setLastReviewResponse] = useState<string | null>(null);
  const [showReviewDetails, setShowReviewDetails] = useState(false);

  // Add task state
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  // HOMЯ state
  const [showHomrActivityLog, setShowHomrActivityLog] = useState(false);
  const [pendingEscalations, setPendingEscalations] = useState<Array<{
    id: string;
    outcomeId: string;
    createdAt: number;
    status: 'pending' | 'answered' | 'dismissed';
    trigger: {
      type: string;
      taskId: string;
      evidence: string[];
    };
    question: {
      text: string;
      context: string;
      options: Array<{
        id: string;
        label: string;
        description: string;
        implications: string;
      }>;
    };
    affectedTasks: string[];
  }>>([]);

  // Fetch outcome data
  const fetchOutcome = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}?relations=true`);
      if (!response.ok) {
        throw new Error('Outcome not found');
      }
      const data = await response.json();
      setOutcome(data.outcome);
      setTaskStats(data.taskStats);
      setConvergence(data.convergence);
      setParent(data.parent || null);
      setChildren(data.children || []);
      setBreadcrumbs(data.breadcrumbs || []);
      setAggregatedStats(data.aggregatedStats || null);
      setIsParent(data.isParent || false);
      setError(null);

      // Fetch HOMЯ escalations
      try {
        const homrRes = await fetch(`/api/outcomes/${outcomeId}/homr/escalations?pending=true`);
        if (homrRes.ok) {
          const homrData = await homrRes.json();
          setPendingEscalations(homrData.escalations || []);
        }
      } catch {
        // HOMЯ fetch failed, continue without it
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load outcome');
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchOutcome();
    const interval = setInterval(fetchOutcome, 5000);
    return () => clearInterval(interval);
  }, [fetchOutcome]);

  // HOMЯ handlers
  const handleHomrAnswer = async (escalationId: string, selectedOption: string, additionalContext?: string): Promise<void> => {
    const response = await fetch(`/api/outcomes/${outcomeId}/homr/escalations/${escalationId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedOption, additionalContext }),
    });
    if (!response.ok) {
      let errorMessage = 'Failed to answer escalation';
      try {
        const data = await response.json();
        errorMessage = data.error || errorMessage;
      } catch {
        // Response body wasn't valid JSON, use default message
      }
      throw new Error(errorMessage);
    }
    toast({ type: 'success', message: 'Decision submitted - tasks resumed' });
    setPendingEscalations(prev => prev.filter(e => e.id !== escalationId));
    fetchOutcome();
  };

  const handleHomrDismiss = async (escalationId: string): Promise<void> => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/homr/escalations/${escalationId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Failed to dismiss escalation');
      }
      toast({ type: 'info', message: 'Escalation dismissed' });
      setPendingEscalations(prev => prev.filter(e => e.id !== escalationId));
      fetchOutcome();
    } catch (err) {
      toast({ type: 'error', message: 'Failed to dismiss escalation' });
      throw err;
    }
  };

  // Actions
  const handleStartWorker = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/workers`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Worker started!' });
      } else {
        toast({ type: 'error', message: data.error || 'Failed to start worker' });
      }
      fetchOutcome();
    } catch (err) {
      toast({ type: 'error', message: 'Failed to start worker' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartOrchestrated = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Orchestrated execution started - building capabilities first' });
      } else {
        toast({ type: 'error', message: data.error || 'Failed to start orchestration' });
      }
      fetchOutcome();
    } catch (err) {
      toast({ type: 'error', message: 'Failed to start orchestration' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunReview = async () => {
    setActionLoading(true);
    setLastReviewResponse(null);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/review`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: `Review complete: ${data.message}` });
        if (data.rawResponse) {
          setLastReviewResponse(data.rawResponse);
          setShowReviewDetails(true);
        }
      } else {
        toast({ type: 'error', message: data.error || 'Review failed' });
      }
      fetchOutcome();
    } catch (err) {
      toast({ type: 'error', message: 'Failed to run review' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: OutcomeStatus) => {
    setActionLoading(true);
    try {
      await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      toast({ type: 'success', message: `Status changed to ${newStatus}` });
      fetchOutcome();
    } catch (err) {
      toast({ type: 'error', message: 'Failed to update status' });
    } finally {
      setActionLoading(false);
    }
  };

  // Direct edit handlers
  const handleStartEditIntent = () => {
    if (outcome?.intent) {
      try {
        const parsed = JSON.parse(outcome.intent);
        setEditedIntentSummary(parsed.summary || '');
      } catch {
        setEditedIntentSummary(outcome.intent);
      }
    }
    setIsEditingIntent(true);
  };

  const handleSaveIntent = async () => {
    setSavingIntent(true);
    try {
      let existingIntent = { summary: '', items: [], success_criteria: [] };
      if (outcome?.intent) {
        try {
          existingIntent = JSON.parse(outcome.intent);
        } catch {
          // Use default
        }
      }

      const updatedIntent = {
        ...existingIntent,
        summary: editedIntentSummary,
      };

      const response = await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: JSON.stringify(updatedIntent) }),
      });

      if (response.ok) {
        toast({ type: 'success', message: 'Intent saved' });
        setIsEditingIntent(false);
        fetchOutcome();
      } else {
        toast({ type: 'error', message: 'Failed to save intent' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to save intent' });
    } finally {
      setSavingIntent(false);
    }
  };

  const handleStartEditApproach = () => {
    setEditedApproach(outcome?.design_doc?.approach || '');
    setIsEditingApproach(true);
  };

  const handleSaveApproach = async () => {
    setSavingApproach(true);
    try {
      const updatedDesignDoc = {
        ...(outcome?.design_doc || {}),
        approach: editedApproach,
        version: (outcome?.design_doc?.version || 0) + 1,
      };

      const response = await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design_doc: JSON.stringify(updatedDesignDoc) }),
      });

      if (response.ok) {
        toast({ type: 'success', message: 'Approach saved' });
        setIsEditingApproach(false);
        fetchOutcome();
      } else {
        toast({ type: 'error', message: 'Failed to save approach' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to save approach' });
    } finally {
      setSavingApproach(false);
    }
  };

  // Optimize intent handler
  const handleOptimizeIntent = async () => {
    if (!intentRamble.trim()) {
      toast({ type: 'warning', message: 'Enter some text to optimize' });
      return;
    }
    setOptimizingIntent(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/optimize-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ramble: intentRamble }),
      });
      if (response.ok) {
        toast({ type: 'success', message: 'Intent optimized' });
        setIntentRamble('');
        fetchOutcome();
      } else {
        const data = await response.json();
        toast({ type: 'error', message: data.error || 'Failed to optimize intent' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to optimize intent' });
    } finally {
      setOptimizingIntent(false);
    }
  };

  // Optimize approach handler
  const handleOptimizeApproach = async () => {
    if (!approachRamble.trim()) {
      toast({ type: 'warning', message: 'Enter some text to optimize' });
      return;
    }
    setOptimizingApproach(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/optimize-approach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ramble: approachRamble }),
      });
      if (response.ok) {
        toast({ type: 'success', message: 'Approach optimized' });
        setApproachRamble('');
        fetchOutcome();
      } else {
        const data = await response.json();
        toast({ type: 'error', message: data.error || 'Failed to optimize approach' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to optimize approach' });
    } finally {
      setOptimizingApproach(false);
    }
  };

  // Add task handler
  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    setAddingTask(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          description: newTaskDescription.trim() || null,
        }),
      });

      if (response.ok) {
        setNewTaskTitle('');
        setNewTaskDescription('');
        setShowAddTask(false);
        toast({ type: 'success', message: 'Task added' });
        fetchOutcome();
      } else {
        toast({ type: 'error', message: 'Failed to add task' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to add task' });
    } finally {
      setAddingTask(false);
    }
  };

  // Delete task handler
  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setOutcome(prev => prev ? {
          ...prev,
          tasks: prev.tasks.filter(t => t.id !== taskId),
        } : null);
        toast({ type: 'success', message: 'Task deleted' });
      } else {
        toast({ type: 'error', message: 'Failed to delete task' });
      }
    } catch (err) {
      toast({ type: 'error', message: 'Failed to delete task' });
    }
  };

  // Reorder task handler
  const handleMoveTask = async (taskId: string, direction: 'up' | 'down') => {
    if (!outcome) return;

    const taskIndex = outcome.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const swapIndex = direction === 'up' ? taskIndex - 1 : taskIndex + 1;
    if (swapIndex < 0 || swapIndex >= outcome.tasks.length) return;

    const task = outcome.tasks[taskIndex];
    const swapTask = outcome.tasks[swapIndex];

    try {
      await Promise.all([
        fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: swapTask.priority }),
        }),
        fetch(`/api/tasks/${swapTask.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: task.priority }),
        }),
      ]);

      const newTasks = [...outcome.tasks];
      newTasks[taskIndex] = swapTask;
      newTasks[swapIndex] = task;

      setOutcome(prev => prev ? { ...prev, tasks: newTasks } : null);
    } catch (err) {
      toast({ type: 'error', message: 'Failed to reorder task' });
    }
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto p-6">
        <p className="text-text-secondary">Loading...</p>
      </main>
    );
  }

  if (error || !outcome) {
    return (
      <main className="max-w-7xl mx-auto p-6">
        <Card padding="lg">
          <CardContent>
            <p className="text-status-error">{error || 'Outcome not found'}</p>
            <Button variant="secondary" className="mt-4" onClick={() => router.push('/')}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const status = outcomeStatusConfig[outcome.status];
  const progressPercent = taskStats && taskStats.total > 0
    ? (taskStats.completed / taskStats.total) * 100
    : 0;
  const hasRunningWorker = outcome.workers.some(w => w.status === 'running');
  const hasPendingTasks = taskStats ? taskStats.pending > 0 : false;
  const hasEverHadWorker = outcome.workers.length > 0;
  const isDraft = !hasEverHadWorker && outcome.status === 'active';
  const canStartWorker = hasPendingTasks && !hasRunningWorker && outcome.status === 'active';

  const needsCapabilities = outcome.capability_ready === 0;
  const capabilityInProgress = outcome.capability_ready === 1;
  const capabilityReady = outcome.capability_ready === 2;

  // Parse intent
  let intent: { summary?: string; items?: { id: string; title: string; status: string }[]; success_criteria?: string[] } | null = null;
  if (outcome.intent) {
    try {
      intent = JSON.parse(outcome.intent);
    } catch {
      // Not valid JSON
    }
  }

  // Get intent summary for collapsed state
  const intentSummary = intent?.summary
    ? intent.summary.slice(0, 60) + (intent.summary.length > 60 ? '...' : '')
    : undefined;

  // Get approach summary for collapsed state
  const approachSummary = outcome.design_doc?.approach
    ? outcome.design_doc.approach.slice(0, 60) + (outcome.design_doc.approach.length > 60 ? '...' : '')
    : undefined;

  // Worker summary for HOMЯ dashboard
  const workerSummary = {
    total: outcome.workers.length,
    running: outcome.workers.filter(w => w.status === 'running').length,
    completed: outcome.workers.filter(w => w.status === 'completed').length,
    failed: outcome.workers.filter(w => w.status === 'failed').length,
    totalCost: outcome.workers.reduce((sum, w) => sum + w.cost, 0),
    totalIterations: outcome.workers.reduce((sum, w) => sum + w.iteration, 0),
  };

  return (
    <main className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-4">
        <button
          onClick={() => parent ? router.push(`/outcome/${parent.id}`) : router.push('/')}
          className="text-text-tertiary hover:text-text-secondary text-sm mb-2 flex items-center gap-1"
        >
          ← {parent ? `Back to "${parent.name}"` : 'Back'}
        </button>

        {breadcrumbs.length > 1 && (
          <div className="mb-4">
            <OutcomeBreadcrumbs breadcrumbs={breadcrumbs} currentName={outcome.name} />
          </div>
        )}

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-text-primary">{outcome.name}</h1>
              {outcome.is_ongoing && <Badge variant="info">Ongoing</Badge>}
              <Badge variant={status.variant}>{status.label}</Badge>
              {isParent && (
                <Badge variant="default">{children.length} {children.length === 1 ? 'child' : 'children'}</Badge>
              )}
              {!isParent && needsCapabilities && (
                <Badge variant="warning">Capabilities Needed</Badge>
              )}
              {!isParent && capabilityInProgress && (
                <Badge variant="info">Building Capabilities</Badge>
              )}
              {!isParent && capabilityReady && outcome.capability_ready !== 0 && (
                <Badge variant="success">Capabilities Ready</Badge>
              )}
            </div>
            {outcome.brief && (
              <div className="max-w-3xl">
                <p className={`text-text-secondary text-sm ${!briefExpanded ? 'line-clamp-2' : ''}`}>
                  {outcome.brief}
                </p>
                {outcome.brief.length > 150 && (
                  <button
                    onClick={() => setBriefExpanded(!briefExpanded)}
                    className="text-accent hover:text-accent/80 text-xs mt-1"
                  >
                    {briefExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2">
            {/* Hierarchy Icon Button */}
            <button
              onClick={() => setShowCreateChildModal(true)}
              className="p-2 rounded-lg hover:bg-bg-secondary text-text-tertiary hover:text-text-primary transition-colors"
              title="Manage Hierarchy"
            >
              <HierarchyIcon />
            </button>

            {/* Status actions inline */}
            {outcome.status === 'active' && hasEverHadWorker && (
              <Button variant="ghost" size="sm" onClick={() => handleStatusChange('dormant')} disabled={actionLoading}>
                Pause
              </Button>
            )}
            {outcome.status === 'dormant' && (
              <Button variant="ghost" size="sm" onClick={() => handleStatusChange('active')} disabled={actionLoading}>
                Resume
              </Button>
            )}
            {!isParent && hasEverHadWorker && (
              <Button variant="secondary" size="sm" onClick={handleRunReview} disabled={actionLoading}>
                Review
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Create Child Modal */}
      {showCreateChildModal && (
        <CreateChildModal
          parentId={outcomeId}
          parentName={outcome.name}
          currentParentId={outcome.parent_id}
          currentParentName={parent?.name}
          onClose={() => setShowCreateChildModal(false)}
          onSuccess={fetchOutcome}
        />
      )}

      {/* Main Chat - Top of Page */}
      <div className="mb-6">
        <OutcomeChat
          outcomeId={outcomeId}
          outcomeName={outcome.name}
          hasRunningWorker={hasRunningWorker}
          hasEverHadWorker={hasEverHadWorker}
          onSuccess={fetchOutcome}
          initialInput={refinementInput}
          onInitialInputConsumed={handleRefinementConsumed}
        />

        {/* Capability phase status indicator */}
        {capabilityInProgress && (
          <div className="mt-2 flex items-center gap-2 text-xs text-status-info p-3 bg-status-info/10 rounded-lg">
            <div className="animate-spin h-3 w-3 border-2 border-status-info border-t-transparent rounded-full" />
            <span>Building capabilities (skills/tools)...</span>
          </div>
        )}
      </div>

      {/* Show Children List for parent outcomes */}
      {isParent && (
        <div className="mb-6">
          <ChildOutcomesList
            children={children}
            aggregatedStats={aggregatedStats}
            parentId={outcomeId}
            onCreateChild={() => setShowCreateChildModal(true)}
          />
        </div>
      )}

      {/* Split Panel Layout */}
      <div className="flex gap-6">
        {/* Left Panel (40%) - Tabs: Context | HOMЯ */}
        <div className="w-2/5 border border-border rounded-lg bg-bg-primary overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 320px)', minHeight: '500px' }}>
          {/* Tab Headers */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setLeftPanelTab('context')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                leftPanelTab === 'context'
                  ? 'text-text-primary border-b-2 border-accent bg-bg-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-secondary'
              }`}
            >
              Context
            </button>
            <button
              onClick={() => setLeftPanelTab('homr')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors relative ${
                leftPanelTab === 'homr'
                  ? 'text-text-primary border-b-2 border-accent bg-bg-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-secondary'
              }`}
            >
              HOMЯ
              {pendingEscalations.length > 0 && (
                <span className="absolute top-2 right-2 w-5 h-5 bg-status-warning text-white text-xs rounded-full flex items-center justify-center">
                  {pendingEscalations.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {leftPanelTab === 'context' ? (
              /* Context Tab */
              <div>
                {/* Intent (What) */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-intent`}
                  title="Intent (What)"
                  badge={intent?.items ? `${intent.items.filter(i => i.status === 'done').length}/${intent.items.length}` : undefined}
                  summary={intentSummary}
                  defaultExpanded={true}
                >
                  {isEditingIntent ? (
                    <div className="space-y-3">
                      <textarea
                        value={editedIntentSummary}
                        onChange={(e) => setEditedIntentSummary(e.target.value)}
                        className="w-full h-32 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary"
                        placeholder="What should this outcome achieve?"
                      />
                      <div className="flex items-center gap-2">
                        <Button variant="primary" size="sm" onClick={handleSaveIntent} disabled={savingIntent}>
                          {savingIntent ? 'Saving...' : 'Save'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setIsEditingIntent(false)} disabled={savingIntent}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {intent?.summary && (
                        <div className="flex justify-between items-start mb-3">
                          <p className="text-text-secondary text-sm flex-1">{intent.summary}</p>
                          <Button variant="ghost" size="sm" onClick={handleStartEditIntent} className="ml-2 flex-shrink-0">
                            Edit
                          </Button>
                        </div>
                      )}
                      {intent?.items && intent.items.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {intent.items.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 text-sm">
                              <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs
                                ${item.status === 'done' ? 'bg-status-success/20 border-status-success text-status-success' : 'border-border'}`}>
                                {item.status === 'done' ? '✓' : ''}
                              </span>
                              <span className={item.status === 'done' ? 'text-text-tertiary line-through' : 'text-text-primary'}>
                                {item.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {intent?.success_criteria && intent.success_criteria.length > 0 && (
                        <div className="p-3 bg-bg-secondary rounded-lg">
                          <p className="text-xs text-text-tertiary uppercase tracking-wide mb-2">Success Criteria</p>
                          <ul className="text-sm text-text-secondary space-y-1">
                            {intent.success_criteria.map((criterion, i) => (
                              <li key={i}>• {criterion}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!intent?.summary && (
                        <p className="text-text-tertiary text-sm mb-3">No intent defined yet. Describe what you want below.</p>
                      )}
                      {/* Ramble box for intent optimization */}
                      <div className="mt-4 pt-4 border-t border-border">
                        <textarea
                          value={intentRamble}
                          onChange={(e) => setIntentRamble(e.target.value)}
                          placeholder="Describe what this outcome should achieve... (ramble here, then click Optimize)"
                          className="w-full h-24 p-3 text-sm bg-bg-secondary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                        />
                        <div className="flex justify-end mt-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleOptimizeIntent}
                            disabled={optimizingIntent || !intentRamble.trim()}
                          >
                            {optimizingIntent ? 'Optimizing...' : 'Optimize'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </CollapsibleSection>

                {/* Approach (How) */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-approach`}
                  title="Approach (How)"
                  badge={outcome.design_doc ? `v${outcome.design_doc.version}` : undefined}
                  summary={approachSummary}
                  defaultExpanded={false}
                >
                  {isEditingApproach ? (
                    <div className="space-y-3">
                      <textarea
                        value={editedApproach}
                        onChange={(e) => setEditedApproach(e.target.value)}
                        className="w-full h-48 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary font-mono"
                        placeholder="How will this outcome be achieved?"
                      />
                      <div className="flex items-center gap-2">
                        <Button variant="primary" size="sm" onClick={handleSaveApproach} disabled={savingApproach}>
                          {savingApproach ? 'Saving...' : 'Save'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setIsEditingApproach(false)} disabled={savingApproach}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {outcome.design_doc ? (
                        <div className="flex justify-between items-start mb-4">
                          <p className="text-text-secondary text-sm whitespace-pre-wrap flex-1">
                            {outcome.design_doc.approach}
                          </p>
                          <Button variant="ghost" size="sm" onClick={handleStartEditApproach} className="ml-2 flex-shrink-0">
                            Edit
                          </Button>
                        </div>
                      ) : (
                        <p className="text-text-tertiary text-sm mb-3">
                          No design doc yet. Describe your approach below.
                        </p>
                      )}
                      {/* Ramble box for approach optimization */}
                      <div className="mt-4 pt-4 border-t border-border">
                        <textarea
                          value={approachRamble}
                          onChange={(e) => setApproachRamble(e.target.value)}
                          placeholder="Describe how to approach this... (ramble here, then click Optimize)"
                          className="w-full h-24 p-3 text-sm bg-bg-secondary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                        />
                        <div className="flex justify-end mt-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleOptimizeApproach}
                            disabled={optimizingApproach || !approachRamble.trim()}
                          >
                            {optimizingApproach ? 'Optimizing...' : 'Optimize'}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </CollapsibleSection>

                {/* Tasks */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-tasks`}
                  title="Tasks"
                  badge={taskStats ? `${taskStats.completed}/${taskStats.total}` : undefined}
                  defaultExpanded={false}
                >
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-text-tertiary text-sm">{outcome.tasks.length} total</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddTask(!showAddTask)}
                      className="text-xs"
                    >
                      + Add Task
                    </Button>
                  </div>

                  {showAddTask && (
                    <div className="mb-4 p-3 border border-border rounded-lg bg-bg-tertiary">
                      <input
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder="Task title..."
                        className="w-full p-2 text-sm bg-bg-primary border border-border rounded mb-2 focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddTask();
                          }
                        }}
                      />
                      <textarea
                        value={newTaskDescription}
                        onChange={(e) => setNewTaskDescription(e.target.value)}
                        placeholder="Description (optional)..."
                        className="w-full p-2 text-sm bg-bg-primary border border-border rounded mb-2 resize-none h-16 focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleAddTask}
                          disabled={addingTask || !newTaskTitle.trim()}
                        >
                          {addingTask ? 'Adding...' : 'Add'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowAddTask(false);
                            setNewTaskTitle('');
                            setNewTaskDescription('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {outcome.tasks.length === 0 && !showAddTask ? (
                    <div className="text-center py-4">
                      <p className="text-text-tertiary text-sm">No tasks yet</p>
                    </div>
                  ) : outcome.tasks.length > 0 && (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {outcome.tasks.map((task, index) => (
                        <ExpandableTaskCard
                          key={task.id}
                          task={task}
                          onUpdate={(updatedTask) => {
                            setOutcome(prev => prev ? {
                              ...prev,
                              tasks: prev.tasks.map(t =>
                                t.id === updatedTask.id ? updatedTask : t
                              ),
                            } : null);
                          }}
                          onDelete={handleDeleteTask}
                          onMoveUp={(taskId) => handleMoveTask(taskId, 'up')}
                          onMoveDown={(taskId) => handleMoveTask(taskId, 'down')}
                          isFirst={index === 0}
                          isLast={index === outcome.tasks.length - 1}
                        />
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Git & Commit Settings */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-git`}
                  title="Git & Commit Settings"
                  defaultExpanded={false}
                >
                  <div className="space-y-4">
                    <GitConfigSection
                      outcomeId={outcomeId}
                      outcomeName={outcome.name}
                      config={{
                        working_directory: outcome.working_directory,
                        git_mode: outcome.git_mode,
                        base_branch: outcome.base_branch,
                        work_branch: outcome.work_branch,
                        auto_commit: outcome.auto_commit,
                        create_pr_on_complete: outcome.create_pr_on_complete,
                      }}
                      onUpdate={fetchOutcome}
                    />
                    <div className="border-t border-border pt-4">
                      <CommitSettingsSection
                        outcomeId={outcomeId}
                        config={{
                          output_target: outcome.output_target,
                          skill_target: outcome.skill_target,
                          tool_target: outcome.tool_target,
                          file_target: outcome.file_target,
                          auto_save: outcome.auto_save,
                          repository_id: outcome.repository_id ?? null,
                          parent_id: outcome.parent_id ?? null,
                        }}
                        onUpdate={fetchOutcome}
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Skills */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-skills`}
                  title="Skills"
                  defaultExpanded={false}
                >
                  <SkillsSection outcomeId={outcomeId} />
                </CollapsibleSection>

                {/* Tools */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-tools`}
                  title="Tools"
                  defaultExpanded={false}
                >
                  <ToolsSection outcomeId={outcomeId} />
                </CollapsibleSection>

                {/* Documents */}
                <CollapsibleSection
                  id={`outcome-${outcomeId}-documents`}
                  title="Documents"
                  defaultExpanded={false}
                >
                  <DocumentsSection outcomeId={outcomeId} />
                </CollapsibleSection>
              </div>
            ) : (
              /* HOMЯ Tab */
              <HomrDashboard
                outcomeId={outcomeId}
                pendingEscalations={pendingEscalations}
                workerSummary={workerSummary}
                onAnswer={handleHomrAnswer}
                onDismiss={handleHomrDismiss}
                onActivityClick={() => setShowHomrActivityLog(true)}
              />
            )}
          </div>
        </div>

        {/* Right Panel (60%) - Control Tower */}
        <div className="w-3/5 space-y-4">
          {/* Progress Section - First */}
          {(!isParent || outcome.tasks.length > 0) && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Progress</CardTitle>
                {isDraft ? (
                  <Badge variant="info">Draft</Badge>
                ) : convergence && (
                  <Badge variant={
                    convergence.is_converging || (progressPercent === 100 && convergence.consecutive_zero_issues >= 1)
                      ? 'success'
                      : convergence.trend === 'improving' ? 'info' : 'default'
                  }>
                    {convergence.is_converging
                      ? 'Converging'
                      : progressPercent === 100 && convergence.consecutive_zero_issues >= 1
                      ? 'Complete'
                      : convergence.total_cycles === 0
                      ? 'Needs Review'
                      : convergence.trend === 'unknown'
                      ? convergence.last_issues === 0 ? 'Clean' : 'In Progress'
                      : convergence.trend === 'improving'
                      ? 'Improving'
                      : convergence.trend === 'stable'
                      ? 'Stable'
                      : 'Needs Work'}
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <Progress value={progressPercent} showLabel variant={progressPercent === 100 ? 'success' : 'default'} />
                </div>
                {taskStats && (
                  <div className="flex gap-6 text-sm">
                    <div>
                      <span className="text-text-tertiary">Completed: </span>
                      <span className="text-text-primary font-medium">{taskStats.completed}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Running: </span>
                      <span className="text-text-primary font-medium">{taskStats.running + taskStats.claimed}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Pending: </span>
                      <span className="text-text-primary font-medium">{taskStats.pending}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary">Failed: </span>
                      <span className="text-status-error font-medium">{taskStats.failed}</span>
                    </div>
                  </div>
                )}
                {convergence && convergence.total_cycles > 0 && (
                  <div className="mt-4 pt-4 border-t border-border text-sm">
                    <span className="text-text-tertiary">Review cycles: </span>
                    <span className="text-text-primary">{convergence.total_cycles}</span>
                    {convergence.consecutive_zero_issues > 0 && (
                      <span className="text-status-success ml-2">
                        ({convergence.consecutive_zero_issues} clean)
                      </span>
                    )}
                  </div>
                )}
                {lastReviewResponse && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <button
                      className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
                      onClick={() => setShowReviewDetails(!showReviewDetails)}
                    >
                      <span className={`transform transition-transform ${showReviewDetails ? 'rotate-90' : ''}`}>▶</span>
                      Review Analysis
                    </button>
                    {showReviewDetails && (
                      <div className="mt-2 p-3 bg-bg-secondary rounded text-sm text-text-secondary whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {lastReviewResponse}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Workers Section - Second, with tabs */}
          {!isParent && (
            <Card padding="md">
              <CardHeader>
                <div className="flex items-center gap-4">
                  <CardTitle>Workers</CardTitle>
                  {/* Worker tabs */}
                  <div className="flex bg-bg-secondary rounded-lg p-1">
                    <button
                      onClick={() => setWorkersTab('live')}
                      className={`px-3 py-1 text-xs rounded ${
                        workersTab === 'live'
                          ? 'bg-bg-primary text-text-primary shadow-sm'
                          : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      Live
                    </button>
                    <button
                      onClick={() => setWorkersTab('history')}
                      className={`px-3 py-1 text-xs rounded ${
                        workersTab === 'history'
                          ? 'bg-bg-primary text-text-primary shadow-sm'
                          : 'text-text-tertiary hover:text-text-secondary'
                      }`}
                    >
                      History
                    </button>
                  </div>
                </div>
                {canStartWorker && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={needsCapabilities ? handleStartOrchestrated : handleStartWorker}
                    disabled={actionLoading}
                  >
                    {needsCapabilities ? 'Build & Run' : 'Start Worker'}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {workersTab === 'live' ? (
                  /* Live Workers */
                  <>
                    {outcome.workers.length === 0 ? (
                      <div className="text-center py-4">
                        <p className="text-text-tertiary text-sm mb-2">No workers started yet</p>
                        {isDraft && hasPendingTasks && (
                          <p className="text-text-tertiary text-xs">
                            Click "Start Worker" to begin execution
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-48 overflow-y-auto">
                        {[...outcome.workers]
                          .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
                          .map((worker) => {
                            const workerStatus = workerStatusConfig[worker.status];
                            return (
                              <div
                                key={worker.id}
                                className="p-3 rounded bg-bg-secondary cursor-pointer hover:bg-bg-tertiary transition-colors border border-transparent hover:border-border"
                                onClick={() => router.push(`/worker/${worker.id}`)}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-text-primary text-sm">{worker.name}</span>
                                  <Badge variant={workerStatus.variant}>{workerStatus.label}</Badge>
                                </div>
                                <div className="text-xs text-text-tertiary">
                                  Iteration {worker.iteration} • ${worker.cost.toFixed(4)}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}

                    {/* Intervention Form when worker is running */}
                    {hasRunningWorker && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <InterventionForm
                          outcomeId={outcomeId}
                          workerId={outcome.workers.find(w => w.status === 'running')?.id}
                          onSuccess={fetchOutcome}
                          compact
                        />
                      </div>
                    )}
                  </>
                ) : (
                  /* Worker History / Progress View */
                  <div className="max-h-96 overflow-y-auto">
                    {hasEverHadWorker ? (
                      <ProgressView outcomeId={outcomeId} />
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-text-tertiary text-sm">No worker history yet</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Outputs Section */}
          <OutputsSection outcomeId={outcomeId} />

          {/* Timeline */}
          {outcome.timeline && (
            <Card padding="md">
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-text-secondary text-sm">{outcome.timeline}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* HOMЯ Activity Log Drawer */}
      <ActivityLogDrawer
        outcomeId={outcomeId}
        isOpen={showHomrActivityLog}
        onClose={() => setShowHomrActivityLog(false)}
      />
    </main>
  );
}
