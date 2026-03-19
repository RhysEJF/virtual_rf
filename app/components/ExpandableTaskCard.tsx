'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { GateSatisfyModal } from './GateSatisfyModal';
import { TaskCapabilitySuggestion } from './TaskCapabilitySuggestion';
import { TaskDependencySection } from './task/TaskDependencySection';
import { TaskSkillsSection } from './task/TaskSkillsSection';
import { TaskCapabilitiesSection } from './task/TaskCapabilitiesSection';
import { TaskGatesSection } from './task/TaskGatesSection';
import { TaskAttemptHistory } from './task/TaskAttemptHistory';
import { TaskCheckpointInfo } from './task/TaskCheckpointInfo';
import { EvolvePanel } from './EvolvePanel';
import type { Task, TaskStatus, TaskGate } from '@/lib/db/schema';
import type { CapabilityNeed } from '@/lib/agents/capability-planner';

interface TaskSkillStatus {
  name: string;
  status: 'ready' | 'needs_api_key' | 'will_be_built';
  skillId?: string;
  missingKeys?: string[];
  description?: string;
}

interface AvailableSkill {
  id: string;
  name: string;
  category: string;
  description: string | null;
}

/** Capability status information */
interface CapabilityStatus {
  id: string;  // e.g., 'skill:database' or 'tool:api-client'
  type: 'skill' | 'tool';
  name: string;
  exists: boolean;
}

/** Task with dependency information */
export interface TaskWithDependencies extends Task {
  dependency_ids?: string[];
  blocked_by?: string[];
  is_blocked?: boolean;
  parsed_gates?: TaskGate[];
  has_pending_gates?: boolean;
  pending_gate_count?: number;
  attempt_count?: number;
}

const RECIPE_TEMPLATE = `# Evolve Recipe: My Eval

## Artifact
- file: title.txt
- description: The file to optimize

## Scoring
- mode: judge
- direction: higher
- budget: 5
- samples: 1

## Criteria
- Quality (0.4): Overall quality of the output
- Clarity (0.3): Clear and easy to understand
- Completeness (0.3): Covers all necessary aspects

## Examples
### "Poor quality" → 20
Lacks structure, unclear, missing key elements.

### "Excellent quality" → 85
Well-structured, clear and concise, covers all requirements.

## Context
Add any additional context the judge needs here.
`;

interface ExpandableTaskCardProps {
  task: TaskWithDependencies;
  /** Map of all tasks by ID for displaying dependency titles */
  taskMap?: Map<string, TaskWithDependencies>;
  /** List of task IDs that depend on this task (computed from parent) */
  dependentIds?: string[];
  onUpdate?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onMoveUp?: (taskId: string) => void;
  onMoveDown?: (taskId: string) => void;
  isFirst?: boolean;
  isLast?: boolean;
}

const statusConfig: Record<TaskStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' | 'error' }> = {
  pending: { label: 'Pending', variant: 'default' },
  claimed: { label: 'Claimed', variant: 'info' },
  running: { label: 'Running', variant: 'info' },
  completed: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
};

export function ExpandableTaskCard({
  task,
  taskMap,
  dependentIds = [],
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
}: ExpandableTaskCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taskIntent, setTaskIntent] = useState(task.task_intent || '');
  const [taskApproach, setTaskApproach] = useState(task.task_approach || '');
  const [description, setDescription] = useState(task.description || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [optimizingIntent, setOptimizingIntent] = useState(false);
  const [optimizingApproach, setOptimizingApproach] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Evolve mode state
  const [metricCommand, setMetricCommand] = useState(task.metric_command || '');
  const [metricBaseline, setMetricBaseline] = useState(task.metric_baseline?.toString() || '');
  const [optimizationBudget, setOptimizationBudget] = useState(task.optimization_budget?.toString() || '5');
  const [metricDirection, setMetricDirection] = useState<'lower' | 'higher'>((task.metric_direction as 'lower' | 'higher') || 'lower');
  const [showEvolveSetup, setShowEvolveSetup] = useState(false);
  const [savingEvolve, setSavingEvolve] = useState(false);
  // Recipe-based evolve state
  const [evolveTab, setEvolveTab] = useState<'existing' | 'create' | 'manual'>('existing');
  const [availableEvals, setAvailableEvals] = useState<Array<{ id: string; name: string; description: string; mode: string; direction: string; path: string }>>([]);
  const [selectedEval, setSelectedEval] = useState<string | null>(null);
  const [evalSearchQuery, setEvalSearchQuery] = useState('');
  const [recipeContent, setRecipeContent] = useState('');
  const [recipeSaveName, setRecipeSaveName] = useState('');
  const [generatingRecipe, setGeneratingRecipe] = useState(false);
  // Override state for eval recipe settings
  const [overrideBudget, setOverrideBudget] = useState('');
  const [overrideSamples, setOverrideSamples] = useState('');
  const [overrideDirection, setOverrideDirection] = useState<'higher' | 'lower' | ''>('');

  // Turn budget state
  const [turnBudget, setTurnBudget] = useState(task.max_attempts.toString());
  const [savingTurnBudget, setSavingTurnBudget] = useState(false);

  // Gate satisfy modal state
  const [satisfyingGate, setSatisfyingGate] = useState<TaskGate | null>(null);

  // Gate creation state
  const [showAddGate, setShowAddGate] = useState(false);
  const [newGateType, setNewGateType] = useState<'document_required' | 'human_approval'>('document_required');
  const [newGateLabel, setNewGateLabel] = useState('');
  const [addingGate, setAddingGate] = useState(false);

  // Skills state
  const [skills, setSkills] = useState<TaskSkillStatus[]>([]);
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);

  // Capabilities state (required_capabilities field)
  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([]);
  const [loadingCapabilities, setLoadingCapabilities] = useState(false);

  // Detected new capabilities from optimization
  const [detectedNewCapabilities, setDetectedNewCapabilities] = useState<CapabilityNeed[]>([]);

  const status = statusConfig[task.status];
  const hasContext = Boolean(task.task_intent || task.task_approach);

  // Dependency information
  const isBlocked = task.is_blocked || false;
  const blockedByIds = task.blocked_by || [];
  const dependencyIds = task.dependency_ids || [];
  const hasDependencies = dependencyIds.length > 0;
  const hasDependents = dependentIds.length > 0;

  // Fetch skills when expanded
  const fetchSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/skills`);
      if (response.ok) {
        const data = await response.json();
        setSkills(data.skills || []);
        setAvailableSkills(data.availableSkills || []);
      }
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    } finally {
      setLoadingSkills(false);
    }
  }, [task.id]);

  useEffect(() => {
    if (expanded) {
      fetchSkills();
    }
  }, [expanded, fetchSkills]);

  // Parse and fetch capability status when expanded
  const fetchCapabilities = useCallback(async () => {
    // Parse required_capabilities from task
    let rawCapabilities: string[] = [];
    if (task.required_capabilities) {
      try {
        rawCapabilities = JSON.parse(task.required_capabilities);
      } catch {
        rawCapabilities = [];
      }
    }

    if (rawCapabilities.length === 0) {
      setCapabilities([]);
      return;
    }

    setLoadingCapabilities(true);
    try {
      // Parse capabilities into structured format
      const parsedCaps: CapabilityStatus[] = rawCapabilities.map((cap) => {
        const [type, ...nameParts] = cap.split(':');
        const name = nameParts.join(':'); // Handle names with colons
        return {
          id: cap,
          type: (type === 'skill' || type === 'tool') ? type : 'skill',
          name: name || cap,
          exists: false, // Will be updated after fetching
        };
      });

      // Check which skills exist (from available skills in DB)
      const skillNames = parsedCaps.filter(c => c.type === 'skill').map(c => c.name);
      const toolNames = parsedCaps.filter(c => c.type === 'tool').map(c => c.name);

      // Fetch global skills to check existence
      let existingSkillNames: string[] = [];
      if (skillNames.length > 0) {
        try {
          const skillsResponse = await fetch('/api/skills');
          if (skillsResponse.ok) {
            const skillsData = await skillsResponse.json();
            existingSkillNames = (skillsData.skills || []).map((s: { name: string }) => s.name.toLowerCase());
          }
        } catch {
          // Skills check failed, assume none exist
        }
      }

      // For tools, we'd need to check outcome-specific tools
      // For now, we'll assume tools need to be built if not found
      let existingToolNames: string[] = [];
      if (toolNames.length > 0) {
        try {
          // Extract outcome_id from task to check outcome tools
          const toolsResponse = await fetch(`/api/tools/outcome?outcomeId=${task.outcome_id}`);
          if (toolsResponse.ok) {
            const toolsData = await toolsResponse.json();
            existingToolNames = (toolsData.tools || []).map((t: { name: string }) => t.name.toLowerCase());
          }
        } catch {
          // Tools check failed, assume none exist
        }
      }

      // Update existence status
      const updatedCaps = parsedCaps.map(cap => ({
        ...cap,
        exists: cap.type === 'skill'
          ? existingSkillNames.includes(cap.name.toLowerCase())
          : existingToolNames.includes(cap.name.toLowerCase()),
      }));

      setCapabilities(updatedCaps);
    } catch (err) {
      console.error('Failed to fetch capabilities:', err);
      setCapabilities([]);
    } finally {
      setLoadingCapabilities(false);
    }
  }, [task.required_capabilities, task.outcome_id]);

  useEffect(() => {
    if (expanded) {
      fetchCapabilities();
    }
  }, [expanded, fetchCapabilities]);

  // Sync turn budget when task prop changes
  useEffect(() => {
    setTurnBudget(task.max_attempts.toString());
  }, [task.max_attempts]);

  // Add skill to task
  const handleAddSkill = async (skillName: string) => {
    const currentSkills = skills.map(s => s.name);
    if (currentSkills.includes(skillName)) return;

    const newSkills = [...currentSkills, skillName];

    try {
      const response = await fetch(`/api/tasks/${task.id}/skills`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: newSkills }),
      });

      if (response.ok) {
        fetchSkills();
      }
    } catch (err) {
      console.error('Failed to add skill:', err);
    }

    setShowSkillDropdown(false);
  };

  // Remove skill from task
  const handleRemoveSkill = async (skillName: string) => {
    const newSkills = skills.map(s => s.name).filter(s => s !== skillName);

    try {
      const response = await fetch(`/api/tasks/${task.id}/skills`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: newSkills }),
      });

      if (response.ok) {
        fetchSkills();
      }
    } catch (err) {
      console.error('Failed to remove skill:', err);
    }
  };

  // Track changes
  const checkForChanges = (newIntent: string, newApproach: string, newDescription: string) => {
    const intentChanged = newIntent !== (task.task_intent || '');
    const approachChanged = newApproach !== (task.task_approach || '');
    const descriptionChanged = newDescription !== (task.description || '');
    setHasChanges(intentChanged || approachChanged || descriptionChanged);
  };

  const handleIntentChange = (value: string) => {
    setTaskIntent(value);
    checkForChanges(value, taskApproach, description);
  };

  const handleApproachChange = (value: string) => {
    setTaskApproach(value);
    checkForChanges(taskIntent, value, description);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    checkForChanges(taskIntent, taskApproach, value);
  };

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description || null,
          task_intent: taskIntent || null,
          task_approach: taskApproach || null,
        }),
      });

      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setHasChanges(false);
        setIsEditingDescription(false);
      }
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  // Save turn budget on blur
  const handleTurnBudgetBlur = async (): Promise<void> => {
    const parsed = parseInt(turnBudget, 10);
    const clamped = Math.max(10, Math.min(500, isNaN(parsed) ? task.max_attempts : parsed));
    setTurnBudget(clamped.toString());
    if (clamped === task.max_attempts) return;
    setSavingTurnBudget(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_attempts: clamped }),
      });
      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
      }
    } catch (err) {
      console.error('Failed to save turn budget:', err);
      setTurnBudget(task.max_attempts.toString());
    } finally {
      setSavingTurnBudget(false);
    }
  };

  // Delete task
  const handleDelete = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (task.status === 'running' || task.status === 'claimed') {
      alert(`Cannot delete a ${task.status} task — stop the worker first.`);
      return;
    }

    if (!confirm('Delete this task and all its subtasks?')) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
      });

      if (response.ok && onDelete) {
        onDelete(task.id);
      } else if (!response.ok) {
        const body = await response.json().catch(() => null);
        alert(body?.error || `Failed to delete task (${response.status})`);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Optimize a specific field
  const handleOptimize = async (field: 'intent' | 'approach') => {
    const content = field === 'intent' ? taskIntent : taskApproach;
    if (!content.trim()) return;

    const setOptimizing = field === 'intent' ? setOptimizingIntent : setOptimizingApproach;
    const setValue = field === 'intent' ? setTaskIntent : setTaskApproach;

    setOptimizing(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/optimize-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, content }),
      });

      const data = await response.json();
      if (response.ok && data.optimized) {
        setValue(data.optimized);
        setHasChanges(true);

        // Refresh skills if any were detected during optimization
        if (data.detectedSkills && data.detectedSkills.length > 0) {
          fetchSkills();
        }

        // Show detected new capabilities
        if (data.detectedCapabilities && data.detectedCapabilities.length > 0) {
          setDetectedNewCapabilities(data.detectedCapabilities);
        }
      }
    } catch (err) {
      console.error('Failed to optimize:', err);
    } finally {
      setOptimizing(false);
    }
  };

  // Save evolve mode configuration
  const handleSaveEvolve = async () => {
    if (!metricCommand.trim()) return;
    setSavingEvolve(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric_command: metricCommand.trim(),
          metric_baseline: metricBaseline ? parseFloat(metricBaseline) : null,
          optimization_budget: optimizationBudget ? parseInt(optimizationBudget, 10) : 5,
          metric_direction: metricDirection,
        }),
      });
      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setShowEvolveSetup(false);
      }
    } catch (err) {
      console.error('Failed to save evolve config:', err);
    } finally {
      setSavingEvolve(false);
    }
  };

  // Remove evolve mode from task
  const handleRemoveEvolve = async () => {
    setSavingEvolve(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric_command: null,
          metric_baseline: null,
          optimization_budget: null,
          metric_direction: null,
        }),
      });
      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setMetricCommand('');
        setMetricBaseline('');
        setOptimizationBudget('5');
        setMetricDirection('lower');
        setShowEvolveSetup(false);
      }
    } catch (err) {
      console.error('Failed to remove evolve config:', err);
    } finally {
      setSavingEvolve(false);
    }
  };

  // Fetch available evals when evolve setup opens
  const fetchAvailableEvals = async () => {
    try {
      const response = await fetch('/api/evals');
      const data = await response.json();
      setAvailableEvals(data.evals || []);
    } catch (err) {
      console.error('Failed to fetch evals:', err);
    }
  };

  // Activate evolve from an existing eval recipe
  const handleActivateFromRecipe = async (recipeName: string) => {
    setSavingEvolve(true);
    try {
      const overrides: Record<string, unknown> = {};
      if (overrideBudget) overrides.budget = parseInt(overrideBudget, 10);
      if (overrideSamples) overrides.samples = parseInt(overrideSamples, 10);
      if (overrideDirection) overrides.direction = overrideDirection;

      const response = await fetch(`/api/tasks/${task.id}/evolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_name: recipeName,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        }),
      });
      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setShowEvolveSetup(false);
      }
    } catch (err) {
      console.error('Failed to activate evolve from recipe:', err);
    } finally {
      setSavingEvolve(false);
    }
  };

  // AI-generate a recipe draft
  const handleGenerateRecipe = async () => {
    setGeneratingRecipe(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/evolve/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (response.ok && data.recipe) {
        setRecipeContent(data.recipe);
      }
    } catch (err) {
      console.error('Failed to generate recipe:', err);
    } finally {
      setGeneratingRecipe(false);
    }
  };

  // Save and activate from inline recipe content
  const handleSaveAndActivateRecipe = async () => {
    if (!recipeContent.trim()) return;
    setSavingEvolve(true);
    try {
      const overrides: Record<string, unknown> = {};
      if (overrideBudget) overrides.budget = parseInt(overrideBudget, 10);
      if (overrideSamples) overrides.samples = parseInt(overrideSamples, 10);
      if (overrideDirection) overrides.direction = overrideDirection;

      const response = await fetch(`/api/tasks/${task.id}/evolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_content: recipeContent,
          save_as: recipeSaveName.trim() || undefined,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        }),
      });
      const data = await response.json();
      if (response.ok && data.task && onUpdate) {
        onUpdate(data.task);
        setShowEvolveSetup(false);
        setRecipeContent('');
        setRecipeSaveName('');
      }
    } catch (err) {
      console.error('Failed to save and activate recipe:', err);
    } finally {
      setSavingEvolve(false);
    }
  };

  // Add gate to task
  const handleAddGate = async () => {
    if (!newGateLabel.trim()) return;
    setAddingGate(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/gates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newGateType, label: newGateLabel.trim() }),
      });
      if (response.ok) {
        setShowAddGate(false);
        setNewGateLabel('');
        setNewGateType('document_required');
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to add gate:', err);
    } finally {
      setAddingGate(false);
    }
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${
      task.has_pending_gates
        ? 'border-border bg-bg-secondary border-l-4 border-l-status-error'
        : isBlocked
        ? 'border-border/50 bg-bg-secondary/50 opacity-70'
        : 'border-border bg-bg-secondary'
    }`}>
      {/* Collapsed Header - Always visible */}
      <div className="flex items-center">
        {/* Reorder buttons */}
        {(onMoveUp || onMoveDown) && (
          <div className="flex flex-col px-1 border-r border-border">
            <button
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(task.id); }}
              disabled={isFirst}
              className={`p-0.5 ${isFirst ? 'text-text-tertiary/30' : 'text-text-tertiary hover:text-text-secondary'}`}
              title="Move up"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 8L6 4L10 8" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(task.id); }}
              disabled={isLast}
              className={`p-0.5 ${isLast ? 'text-text-tertiary/30' : 'text-text-tertiary hover:text-text-secondary'}`}
              title="Move down"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4L6 8L10 4" />
              </svg>
            </button>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 p-3 text-left hover:bg-bg-tertiary transition-colors"
        >
          <div className="flex items-start gap-2">
            {/* Chevron */}
            <span className={`text-text-tertiary transition-transform mt-0.5 shrink-0 ${expanded ? 'rotate-90' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </span>

            {/* Task info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text-primary text-sm font-medium">
                  {task.title}
                </span>
                {task.from_review && (
                  <Badge variant="warning" className="text-[10px] shrink-0">Review</Badge>
                )}
                {hasContext && (
                  <span className="text-text-tertiary text-xs shrink-0" title="Has context">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </span>
                )}
                {task.required_skills && (
                  <span className="text-accent text-xs shrink-0" title="Has required skills">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                  </span>
                )}
                {/* Dependency indicators */}
                {hasDependencies && !isBlocked && (
                  <span className="text-text-tertiary text-xs shrink-0" title={`Depends on ${dependencyIds.length} task(s)`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </span>
                )}
                {hasDependents && (
                  <span className="text-status-info text-xs shrink-0" title={`${dependentIds.length} task(s) depend on this`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </span>
                )}
                {/* Evolve mode indicator */}
                {task.metric_command && (
                  <span className="text-accent text-xs shrink-0" title="Evolve mode (hill-climbing optimization)">
                    🧬
                  </span>
                )}
              </div>
              {task.description && !expanded && (
                <p className="text-text-tertiary text-xs mt-1 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>

            {/* Status badges - always visible */}
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              {/* Complexity badge */}
              {task.complexity_score != null && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary"
                  title={`Complexity: ${task.complexity_score}/10${task.estimated_turns ? `, ~${task.estimated_turns} turns` : ''}`}
                >
                  C{task.complexity_score}{task.estimated_turns ? `/${task.estimated_turns}t` : ''}
                </span>
              )}
              {/* Turn budget */}
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${
                  (task.attempt_count ?? 0) >= task.max_attempts
                    ? 'bg-status-error/10 text-status-error'
                    : (task.attempt_count ?? 0) > 0
                      ? 'bg-status-warning/10 text-status-warning'
                      : 'bg-bg-tertiary text-text-tertiary'
                }`}
                title="Turn Budget — attempts used / budget"
                onClick={(e) => e.stopPropagation()}
              >
                {(task.attempt_count ?? 0) > 0 && <>{task.attempt_count}/</>}
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={turnBudget}
                  onChange={(e) => setTurnBudget(e.target.value)}
                  onBlur={handleTurnBudgetBlur}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-[3.5ch] bg-transparent text-center text-[10px] font-inherit outline-none border-b border-dashed border-current/30 focus:border-current/60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  title={`Turn budget (10–500)${savingTurnBudget ? ' — saving...' : ''}`}
                />
                {(task.attempt_count ?? 0) === 0 && <span className="opacity-60">t</span>}
              </span>
              {isBlocked && (
                <Badge variant="warning" className="text-[10px]" title={`Blocked by ${blockedByIds.length} task(s)`}>
                  Blocked ({blockedByIds.length})
                </Badge>
              )}
              {task.has_pending_gates && (
                <Badge variant="error" className="animate-pulse" title="Awaiting human input">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline -mt-0.5 mr-1">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Needs Input ({task.pending_gate_count})
                </Badge>
              )}
              <Badge variant={status.variant}>
                {status.label}
              </Badge>
            </div>
          </div>
        </button>
        {onDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-text-tertiary hover:text-status-error transition-colors shrink-0"
            title="Delete task"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Description - Editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                Description
              </label>
              {!isEditingDescription && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingDescription(true)}
                  className="text-xs h-6 px-2"
                >
                  Edit
                </Button>
              )}
            </div>
            {isEditingDescription ? (
              <textarea
                value={description}
                onChange={(e) => handleDescriptionChange(e.target.value)}
                placeholder="Brief description of the task..."
                className="w-full h-20 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                autoFocus
              />
            ) : (
              <p className="text-text-secondary text-sm">
                {description || <span className="text-text-tertiary italic">No description</span>}
              </p>
            )}
          </div>

          {/* Dependencies Section */}
          <TaskDependencySection task={task} taskMap={taskMap} dependentIds={dependentIds} />

          {/* Task Intent (What) - Editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                What (Task Intent)
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOptimize('intent')}
                disabled={optimizingIntent || !taskIntent.trim()}
                className="text-xs h-6 px-2"
              >
                {optimizingIntent ? 'Optimizing...' : 'Optimize'}
              </Button>
            </div>
            <textarea
              value={taskIntent}
              onChange={(e) => handleIntentChange(e.target.value)}
              placeholder="What should this task achieve? What are the requirements?"
              className="w-full h-20 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          {/* Task Approach (How) - Editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                How (Task Approach)
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOptimize('approach')}
                disabled={optimizingApproach || !taskApproach.trim()}
                className="text-xs h-6 px-2"
              >
                {optimizingApproach ? 'Optimizing...' : 'Optimize'}
              </Button>
            </div>
            <textarea
              value={taskApproach}
              onChange={(e) => handleApproachChange(e.target.value)}
              placeholder="How should this be done? What tools, patterns, or constraints?"
              className="w-full h-20 p-3 text-sm bg-bg-primary border border-border rounded-lg resize-none focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          {/* Detected New Capabilities (from optimization) */}
          {detectedNewCapabilities.length > 0 && (
            <TaskCapabilitySuggestion
              capabilities={detectedNewCapabilities}
              outcomeId={task.outcome_id}
              onCreated={() => {
                setDetectedNewCapabilities([]);
                fetchCapabilities();
              }}
              onDismiss={() => setDetectedNewCapabilities([])}
            />
          )}

          {/* Skills Section */}
          <TaskSkillsSection
            skills={skills}
            availableSkills={availableSkills}
            loadingSkills={loadingSkills}
            showSkillDropdown={showSkillDropdown}
            setShowSkillDropdown={setShowSkillDropdown}
            onAddSkill={handleAddSkill}
            onRemoveSkill={handleRemoveSkill}
          />

          {/* Required Capabilities Section */}
          <TaskCapabilitiesSection capabilities={capabilities} loadingCapabilities={loadingCapabilities} />

          {/* Gates Section (Human-in-the-Loop) */}
          <TaskGatesSection
            taskStatus={task.status}
            parsedGates={task.parsed_gates || []}
            showAddGate={showAddGate}
            setShowAddGate={setShowAddGate}
            newGateType={newGateType}
            setNewGateType={setNewGateType}
            newGateLabel={newGateLabel}
            setNewGateLabel={setNewGateLabel}
            addingGate={addingGate}
            onAddGate={handleAddGate}
            onSatisfyGate={(gate) => setSatisfyingGate(gate)}
          />

          {/* Verify Command */}
          {task.verify_command && (
            <div>
              <label className="text-xs text-text-tertiary uppercase tracking-wide mb-1 block">
                Verify Command
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-bg-primary px-3 py-2 rounded border border-border text-text-secondary font-mono">
                  {task.verify_command}
                </code>
                {task.status === 'completed' && (
                  <Badge variant="success" className="text-[10px] shrink-0">Pass</Badge>
                )}
                {task.status === 'failed' && (
                  <Badge variant="error" className="text-[10px] shrink-0">Fail</Badge>
                )}
              </div>
            </div>
          )}

          {/* Attempt History */}
          <TaskAttemptHistory taskId={task.id} visible={expanded} />

          {/* Evolve Mode Panel — shown when already configured */}
          {task.metric_command && (
            <EvolvePanel
              taskId={task.id}
              outcomeId={task.outcome_id}
              metricCommand={task.metric_command}
              metricBaseline={task.metric_baseline}
              optimizationBudget={task.optimization_budget}
              metricDirection={task.metric_direction}
            />
          )}

          {/* Evolve Mode Setup / Edit */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-tertiary uppercase tracking-wide">
                Optimize Mode
              </label>
              {!showEvolveSetup && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowEvolveSetup(true); fetchAvailableEvals(); }}
                  className="text-xs h-6 px-2"
                >
                  {task.metric_command ? 'Edit' : 'Enable'}
                </Button>
              )}
            </div>
            {!showEvolveSetup && !task.metric_command && (
              <p className="text-text-tertiary text-xs">
                Enable hill-climbing optimization with an eval recipe or manual metric command.
              </p>
            )}
            {showEvolveSetup && !task.metric_command && (
              <div className="space-y-3 p-3 bg-bg-primary border border-border rounded-lg">
                {/* Tab selection */}
                <div className="flex items-center gap-1 border-b border-border pb-2">
                  <button
                    onClick={() => setEvolveTab('existing')}
                    className={`px-2 py-1 text-xs rounded-t ${evolveTab === 'existing' ? 'bg-bg-secondary text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary'}`}
                  >
                    Use Eval
                  </button>
                  <button
                    onClick={() => { setEvolveTab('create'); if (!recipeContent) setRecipeContent(RECIPE_TEMPLATE); }}
                    className={`px-2 py-1 text-xs rounded-t ${evolveTab === 'create' ? 'bg-bg-secondary text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary'}`}
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => setEvolveTab('manual')}
                    className={`px-2 py-1 text-xs rounded-t ${evolveTab === 'manual' ? 'bg-bg-secondary text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary'}`}
                  >
                    Manual
                  </button>
                </div>

                {/* Tab A: Use Existing Eval */}
                {evolveTab === 'existing' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={evalSearchQuery}
                      onChange={(e) => setEvalSearchQuery(e.target.value)}
                      placeholder="Search evals..."
                      className="w-full px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                    />
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {availableEvals
                        .filter(e => !evalSearchQuery || e.name.toLowerCase().includes(evalSearchQuery.toLowerCase()))
                        .map(e => (
                          <button
                            key={e.id}
                            onClick={() => {
                              setSelectedEval(e.id);
                              setOverrideDirection(e.direction as 'higher' | 'lower');
                              setOverrideBudget('5');
                              setOverrideSamples('1');
                            }}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded ${selectedEval === e.id ? 'bg-accent/10 border border-accent/30' : 'hover:bg-bg-secondary border border-transparent'}`}
                          >
                            <div className="font-medium text-text-primary">{e.name}</div>
                            {e.description && <div className="text-text-tertiary text-[10px] mt-0.5">{e.description}</div>}
                            <div className="text-text-tertiary text-[10px] mt-0.5">
                              {e.mode} &middot; {e.direction} is better
                            </div>
                          </button>
                        ))}
                      {availableEvals.length === 0 && (
                        <p className="text-text-tertiary text-xs py-2 text-center">No evals found. Create one or use manual mode.</p>
                      )}
                    </div>
                    {selectedEval && (
                      <div className="mt-2 p-2 bg-bg-secondary/50 rounded border border-border space-y-2">
                        <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Settings (editable)</p>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-text-tertiary block">Direction</label>
                            <select
                              value={overrideDirection}
                              onChange={(e) => setOverrideDirection(e.target.value as 'higher' | 'lower')}
                              className="w-full px-2 py-1 text-xs bg-bg-secondary border border-border rounded"
                            >
                              <option value="higher">Higher is better</option>
                              <option value="lower">Lower is better</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-text-tertiary block">Budget</label>
                            <input type="number" min="1" max="20" value={overrideBudget} onChange={(e) => setOverrideBudget(e.target.value)}
                              className="w-full px-2 py-1 text-xs bg-bg-secondary border border-border rounded" />
                          </div>
                          <div>
                            <label className="text-[10px] text-text-tertiary block">Samples</label>
                            <input type="number" min="1" max="10" value={overrideSamples} onChange={(e) => setOverrideSamples(e.target.value)}
                              className="w-full px-2 py-1 text-xs bg-bg-secondary border border-border rounded" />
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => selectedEval && handleActivateFromRecipe(selectedEval)}
                        disabled={!selectedEval || savingEvolve}
                      >
                        {savingEvolve ? 'Activating...' : 'Activate'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowEvolveSetup(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Tab B: Create New Eval */}
                {evolveTab === 'create' && (
                  <div className="space-y-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateRecipe}
                      disabled={generatingRecipe}
                      className="text-xs"
                    >
                      {generatingRecipe ? 'Generating...' : 'Generate with AI'}
                    </Button>
                    <textarea
                      value={recipeContent}
                      onChange={(e) => setRecipeContent(e.target.value)}
                      rows={16}
                      className="w-full px-3 py-2 text-xs bg-bg-secondary border border-border rounded font-mono focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary resize-y"
                    />
                    <div>
                      <label className="text-xs text-text-secondary block mb-1">Save as (optional — saves to eval library)</label>
                      <input
                        type="text"
                        value={recipeSaveName}
                        onChange={(e) => setRecipeSaveName(e.target.value)}
                        placeholder="my-eval-name"
                        className="w-full px-3 py-1.5 text-xs bg-bg-secondary border border-border rounded focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                      />
                    </div>
                    <div className="mt-2 p-2 bg-bg-secondary/50 rounded border border-border space-y-2">
                      <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Settings (editable)</p>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-text-tertiary block">Direction</label>
                          <select
                            value={overrideDirection}
                            onChange={(e) => setOverrideDirection(e.target.value as 'higher' | 'lower')}
                            className="w-full px-2 py-1 text-xs bg-bg-secondary border border-border rounded"
                          >
                            <option value="higher">Higher is better</option>
                            <option value="lower">Lower is better</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-text-tertiary block">Budget</label>
                          <input type="number" min="1" max="20" value={overrideBudget} onChange={(e) => setOverrideBudget(e.target.value)}
                            className="w-full px-2 py-1 text-xs bg-bg-secondary border border-border rounded" />
                        </div>
                        <div>
                          <label className="text-[10px] text-text-tertiary block">Samples</label>
                          <input type="number" min="1" max="10" value={overrideSamples} onChange={(e) => setOverrideSamples(e.target.value)}
                            className="w-full px-2 py-1 text-xs bg-bg-secondary border border-border rounded" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveAndActivateRecipe}
                        disabled={!recipeContent.trim() || savingEvolve}
                      >
                        {savingEvolve ? 'Saving...' : 'Save & Activate'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowEvolveSetup(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Tab C: Manual (power user / raw metric command) */}
                {evolveTab === 'manual' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-text-secondary block mb-1">
                        Metric Command <span className="text-status-error">*</span>
                      </label>
                      <input
                        type="text"
                        value={metricCommand}
                        onChange={(e) => setMetricCommand(e.target.value)}
                        placeholder="e.g., node benchmark.js --json | jq .score"
                        className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded font-mono focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                      />
                      <p className="text-[10px] text-text-tertiary mt-1">
                        Shell command that outputs a single number.
                      </p>
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary block mb-1">Direction</label>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                          <input
                            type="radio"
                            name={`metric-direction-${task.id}`}
                            value="higher"
                            checked={metricDirection === 'higher'}
                            onChange={() => setMetricDirection('higher')}
                            className="accent-accent"
                          />
                          Higher is better
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                          <input
                            type="radio"
                            name={`metric-direction-${task.id}`}
                            value="lower"
                            checked={metricDirection === 'lower'}
                            onChange={() => setMetricDirection('lower')}
                            className="accent-accent"
                          />
                          Lower is better
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-text-secondary block mb-1">Baseline</label>
                        <input
                          type="number"
                          step="any"
                          value={metricBaseline}
                          onChange={(e) => setMetricBaseline(e.target.value)}
                          placeholder="Current value"
                          className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-text-secondary block mb-1">Budget (iterations)</label>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={optimizationBudget}
                          onChange={(e) => setOptimizationBudget(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveEvolve}
                        disabled={savingEvolve || !metricCommand.trim()}
                      >
                        {savingEvolve ? 'Saving...' : 'Enable Optimize'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowEvolveSetup(false);
                          setMetricCommand(task.metric_command || '');
                          setMetricBaseline(task.metric_baseline?.toString() || '');
                          setOptimizationBudget(task.optimization_budget?.toString() || '5');
                          setMetricDirection((task.metric_direction as 'lower' | 'higher') || 'lower');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Edit mode when evolve is already configured */}
            {showEvolveSetup && task.metric_command && (
              <div className="space-y-3 p-3 bg-bg-primary border border-border rounded-lg">
                <div>
                  <label className="text-xs text-text-secondary block mb-1">
                    Metric Command <span className="text-status-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={metricCommand}
                    onChange={(e) => setMetricCommand(e.target.value)}
                    placeholder="e.g., bash eval.sh"
                    className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded font-mono focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary block mb-1">Direction</label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input type="radio" name={`metric-direction-${task.id}`} value="higher" checked={metricDirection === 'higher'} onChange={() => setMetricDirection('higher')} className="accent-accent" />
                      Higher is better
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input type="radio" name={`metric-direction-${task.id}`} value="lower" checked={metricDirection === 'lower'} onChange={() => setMetricDirection('lower')} className="accent-accent" />
                      Lower is better
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">Baseline</label>
                    <input type="number" step="any" value={metricBaseline} onChange={(e) => setMetricBaseline(e.target.value)} placeholder="Current value" className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary" />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">Budget</label>
                    <input type="number" min="1" max="20" value={optimizationBudget} onChange={(e) => setOptimizationBudget(e.target.value)} className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded focus:outline-none focus:border-accent text-text-primary placeholder:text-text-tertiary" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={handleSaveEvolve} disabled={savingEvolve || !metricCommand.trim()}>
                    {savingEvolve ? 'Saving...' : 'Update'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowEvolveSetup(false); setMetricCommand(task.metric_command || ''); setMetricBaseline(task.metric_baseline?.toString() || ''); setOptimizationBudget(task.optimization_budget?.toString() || '5'); setMetricDirection((task.metric_direction as 'lower' | 'higher') || 'lower'); }}>
                    Cancel
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleRemoveEvolve} disabled={savingEvolve} className="text-status-error hover:text-status-error/80 ml-auto">
                    Disable
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Checkpoint Recovery */}
          <TaskCheckpointInfo
            taskId={task.id}
            taskStatus={task.status}
            attempts={task.attempts}
            visible={expanded}
            onResumed={() => window.location.reload()}
          />

          {/* Save/Delete buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              {hasChanges && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTaskIntent(task.task_intent || '');
                      setTaskApproach(task.task_approach || '');
                      setDescription(task.description || '');
                      setIsEditingDescription(false);
                      setHasChanges(false);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {satisfyingGate && (
        <GateSatisfyModal
          gate={satisfyingGate}
          taskId={task.id}
          onClose={() => setSatisfyingGate(null)}
          onSatisfied={() => {
            setSatisfyingGate(null);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
