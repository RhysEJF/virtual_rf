/**
 * HOMЯ Steerer
 *
 * Modifies tasks and injects context based on observations.
 * Responsible for:
 * - Context injection into pending tasks
 * - Task modification based on discoveries
 * - Priority adjustments
 * - Corrective task creation
 * - Memory injection at task claim time
 */

import { generateId } from '../utils/id';
import {
  getHomrContext,
  getOrCreateHomrContext,
  updateHomrContext,
  addContextInjection,
  getDiscoveriesForTask,
  getContextInjectionsForTask,
  incrementHomrContextStat,
  logHomrActivity,
} from '../db/homr';
import { getPendingTasks, createTask, getTaskById, updateTask } from '../db/tasks';
import type {
  Task,
  HomrDiscovery,
  HomrDecision,
  HomrConstraint,
  HomrContextInjection,
  HomrDriftItem,
  HomrEscalation,
  HomrQuestionOption,
  ParsedMemory,
} from '../db/schema';
import type {
  ObservationResult,
  SteeringResult,
  AnySteeringAction,
  InjectContextAction,
  CreateTaskAction,
  TaskContext,
  EscalationAnswer,
} from './types';
import { buildTaskContextSection, buildMemoryContextSection } from './prompts';
import { memoryService, type SearchResponse } from '../memory';

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build the HOMЯ context section for a task's CLAUDE.md
 * This is called when a task is about to start
 */
export function buildTaskContext(taskId: string, outcomeId: string): string {
  const context = getHomrContext(outcomeId);

  // Get discoveries relevant to this task
  const discoveries = context ? getDiscoveriesForTask(outcomeId, taskId) : [];

  // Get injections for this task
  const injections = context ? getContextInjectionsForTask(outcomeId, taskId) : [];

  // Parse decisions and constraints
  const decisions: HomrDecision[] = context ? JSON.parse(context.decisions) : [];
  const constraints: HomrConstraint[] = context ? JSON.parse(context.constraints) : [];

  // Build the HOMЯ context section using the prompt builder
  const homrSection = buildTaskContextSection(discoveries, decisions, constraints);

  // Get relevant memories for context injection
  const memories = getRelevantMemoriesForTask(taskId, outcomeId);
  const memorySection = memories.length > 0 ? buildMemoryContextSection(memories) : '';

  // Combine sections
  if (!homrSection && !memorySection) {
    return '';
  }

  const sections: string[] = [];
  if (homrSection) sections.push(homrSection);
  if (memorySection) sections.push(memorySection);

  return sections.join('\n');
}

/**
 * Build the HOMЯ context section for a task's CLAUDE.md (async version)
 * This version uses the full async memory retrieval for better results.
 * Use this when you can await the result.
 */
export async function buildTaskContextAsync(taskId: string, outcomeId: string): Promise<string> {
  const context = getHomrContext(outcomeId);

  // Get discoveries relevant to this task
  const discoveries = context ? getDiscoveriesForTask(outcomeId, taskId) : [];

  // Get injections for this task
  const injections = context ? getContextInjectionsForTask(outcomeId, taskId) : [];

  // Parse decisions and constraints
  const decisions: HomrDecision[] = context ? JSON.parse(context.decisions) : [];
  const constraints: HomrConstraint[] = context ? JSON.parse(context.constraints) : [];

  // Build the HOMЯ context section using the prompt builder
  const homrSection = buildTaskContextSection(discoveries, decisions, constraints);

  // Get relevant memories for context injection (async)
  const memories = await getRelevantMemoriesForTaskAsync(taskId, outcomeId);
  const memorySection = memories.length > 0 ? buildMemoryContextSection(memories) : '';

  // Combine sections
  if (!homrSection && !memorySection) {
    return '';
  }

  const sections: string[] = [];
  if (homrSection) sections.push(homrSection);
  if (memorySection) sections.push(memorySection);

  return sections.join('\n');
}

/**
 * Get relevant memories for a task (synchronous version).
 * Uses BM25 search which is synchronous. For association-based retrieval,
 * use getRelevantMemoriesForTaskAsync.
 */
export function getRelevantMemoriesForTask(taskId: string, outcomeId: string): ParsedMemory[] {
  const task = getTaskById(taskId);
  if (!task) {
    return [];
  }

  const allMemories: ParsedMemory[] = [];
  const seenIds = new Set<string>();

  // Build a search query from the task title and description
  const searchQuery = buildMemorySearchQuery(task);
  if (searchQuery) {
    try {
      // Use synchronous BM25 search (doesn't require async embedding)
      const { searchMemoriesBM25, parseMemory } = require('../db/memory');
      const searchResults = searchMemoriesBM25(searchQuery, 10);

      for (const result of searchResults) {
        if (!seenIds.has(result.memory.id)) {
          seenIds.add(result.memory.id);
          allMemories.push(parseMemory(result.memory));
        }
      }
    } catch (error) {
      console.log('[HOMЯ Steerer] Memory search failed:', error);
    }
  }

  // Sort by importance and return top results
  return sortMemoriesByRelevance(allMemories).slice(0, 5);
}

/**
 * Get relevant memories for a task (async version).
 * Retrieves memories from multiple sources:
 * 1. Memories explicitly associated with this task
 * 2. Memories associated with this outcome
 * 3. Semantic search based on task content (hybrid search with vector + BM25)
 *
 * @param taskId - The task to retrieve memories for
 * @param outcomeId - The outcome this task belongs to
 * @param limit - Maximum number of memories to return (default: 5)
 * @returns Promise resolving to array of relevant memories, sorted by relevance
 */
export async function getRelevantMemoriesForTaskAsync(
  taskId: string,
  outcomeId: string,
  limit: number = 5
): Promise<ParsedMemory[]> {
  const task = getTaskById(taskId);
  if (!task) {
    console.log('[HOMЯ Steerer] Task not found for memory retrieval:', taskId);
    return [];
  }

  const allMemories: ParsedMemory[] = [];
  const seenIds = new Set<string>();

  // Helper to add memories while avoiding duplicates
  const addMemories = (memories: ParsedMemory[]) => {
    for (const memory of memories) {
      if (!seenIds.has(memory.id)) {
        seenIds.add(memory.id);
        allMemories.push(memory);
      }
    }
  };

  // 1. Get memories explicitly associated with this task
  try {
    const taskMemories = await memoryService.getForTask(taskId, limit);
    addMemories(taskMemories);
    if (taskMemories.length > 0) {
      console.log(`[HOMЯ Steerer] Found ${taskMemories.length} task-associated memories`);
    }
  } catch (error) {
    console.log('[HOMЯ Steerer] Could not get task-associated memories:', error);
  }

  // 2. Get memories associated with this outcome
  try {
    const outcomeMemories = await memoryService.getForOutcome(outcomeId, limit);
    addMemories(outcomeMemories);
    if (outcomeMemories.length > 0) {
      console.log(`[HOMЯ Steerer] Found ${outcomeMemories.length} outcome-associated memories`);
    }
  } catch (error) {
    console.log('[HOMЯ Steerer] Could not get outcome-associated memories:', error);
  }

  // 3. Search for relevant memories based on task content
  const searchQuery = buildMemorySearchQuery(task);
  if (searchQuery) {
    try {
      // Use the memory service's search which handles hybrid search
      const searchResponse = await memoryService.search({
        query: searchQuery,
        limit: limit * 2, // Get more results to filter from
        outcomeId,
        taskId,
      });

      addMemories(searchResponse.memories);
      if (searchResponse.memories.length > 0) {
        console.log(`[HOMЯ Steerer] Found ${searchResponse.memories.length} memories via search (${searchResponse.strategy})`);
      }
    } catch (error) {
      console.log('[HOMЯ Steerer] Memory search failed:', error);
      // Fall back to synchronous BM25 search
      try {
        const { searchMemoriesBM25, parseMemory } = require('../db/memory');
        const fallbackResults = searchMemoriesBM25(searchQuery, limit * 2);
        addMemories(fallbackResults.map((r: { memory: any }) => parseMemory(r.memory)));
      } catch (fallbackError) {
        console.log('[HOMЯ Steerer] Fallback BM25 search also failed:', fallbackError);
      }
    }
  }

  // Handle case where no memories are found
  if (allMemories.length === 0) {
    console.log('[HOMЯ Steerer] No relevant memories found for task:', taskId);
    return [];
  }

  // Sort by importance and return top results
  const sortedMemories = sortMemoriesByRelevance(allMemories);
  const result = sortedMemories.slice(0, limit);

  console.log(`[HOMЯ Steerer] Returning ${result.length} memories for task ${taskId}`);
  return result;
}

/**
 * Build a search query from task information
 */
function buildMemorySearchQuery(task: Task): string {
  const parts: string[] = [];

  // Use task title (most important)
  if (task.title) {
    parts.push(task.title);
  }

  // Extract key terms from description (if available)
  if (task.description) {
    // Take first 200 chars of description to avoid very long queries
    const descSnippet = task.description.substring(0, 200);
    // Extract words that might be technical terms (capitalized or long)
    const technicalTerms = descSnippet
      .split(/\s+/)
      .filter(word => word.length > 4 || /^[A-Z]/.test(word))
      .slice(0, 10)
      .join(' ');
    if (technicalTerms) {
      parts.push(technicalTerms);
    }
  }

  // Include PRD context keywords if available
  if (task.prd_context) {
    const prdSnippet = task.prd_context.substring(0, 100);
    parts.push(prdSnippet);
  }

  return parts.join(' ').trim();
}

/**
 * Sort memories by relevance (importance, then recency)
 */
function sortMemoriesByRelevance(memories: ParsedMemory[]): ParsedMemory[] {
  const importancePriority: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return [...memories].sort((a, b) => {
    // First by importance
    const importanceA = importancePriority[a.importance] ?? 4;
    const importanceB = importancePriority[b.importance] ?? 4;
    if (importanceA !== importanceB) {
      return importanceA - importanceB;
    }

    // Then by recency (last accessed or created)
    const timeA = a.last_accessed_at || a.created_at;
    const timeB = b.last_accessed_at || b.created_at;
    return timeB - timeA;
  });
}

/**
 * Get full task context including injections
 */
export function getTaskContext(taskId: string, outcomeId: string): TaskContext {
  const context = getHomrContext(outcomeId);
  if (!context) {
    return {
      discoveries: [],
      injections: [],
      decisions: [],
      constraints: [],
    };
  }

  return {
    discoveries: getDiscoveriesForTask(outcomeId, taskId),
    injections: getContextInjectionsForTask(outcomeId, taskId),
    decisions: JSON.parse(context.decisions),
    constraints: JSON.parse(context.constraints).filter((c: HomrConstraint) => c.active),
  };
}

// ============================================================================
// Steering Actions
// ============================================================================

/**
 * Steer based on an observation result
 * This is called after observeTask() completes
 */
export async function steer(observation: ObservationResult): Promise<SteeringResult> {
  const actions: AnySteeringAction[] = [];
  const { outcomeId, drift, discoveries } = observation;

  // Handle drift - high severity drift creates corrective tasks
  for (const driftItem of drift) {
    if (driftItem.severity === 'high') {
      const action = createCorrectiveTaskAction(outcomeId, driftItem, observation.taskId);
      actions.push(action);
    } else {
      // Lower severity drift - inject warning to pending tasks
      const warningAction = createDriftWarningAction(outcomeId, driftItem, observation.taskId);
      actions.push(warningAction);
    }
  }

  // Share discoveries with relevant tasks
  for (const discovery of discoveries) {
    if (discovery.relevantTasks.length > 0) {
      const action = createDiscoveryInjectionAction(outcomeId, discovery);
      actions.push(action);
    }
  }

  // Execute all actions
  for (const action of actions) {
    await executeSteeringAction(action, outcomeId);
  }

  // Log steering activity
  if (actions.length > 0) {
    incrementHomrContextStat(outcomeId, 'steering_actions');

    logHomrActivity({
      outcome_id: outcomeId,
      type: 'steering',
      details: {
        observationId: observation.taskId,
        actionCount: actions.length,
        actions: actions.map(a => ({ type: a.type, reason: a.reason })),
      },
      summary: `Executed ${actions.length} steering action(s) after observing task ${observation.taskId}`,
    });
  }

  return {
    actions,
    summary: actions.length > 0
      ? `Executed ${actions.length} steering action(s)`
      : 'No steering actions needed',
  };
}

/**
 * Create action for corrective task
 */
function createCorrectiveTaskAction(
  outcomeId: string,
  drift: HomrDriftItem,
  sourceTaskId: string
): CreateTaskAction {
  return {
    type: 'create_task',
    reason: `High severity drift detected: ${drift.description}`,
    timestamp: Date.now(),
    task: {
      title: `Fix: ${drift.description.substring(0, 50)}`,
      description: `**Corrective Task Created by HOMЯ**

This task was automatically created to address drift detected in task ${sourceTaskId}.

**Drift Type:** ${drift.type}
**Severity:** ${drift.severity}
**Description:** ${drift.description}

**Evidence:**
> ${drift.evidence}

Please review the original work and make corrections as needed.`,
      priority: 1, // High priority
    },
  };
}

/**
 * Create action for drift warning injection
 */
function createDriftWarningAction(
  outcomeId: string,
  drift: HomrDriftItem,
  sourceTaskId: string
): InjectContextAction {
  const pendingTasks = getPendingTasks(outcomeId);

  return {
    type: 'inject_context',
    reason: `Warning about ${drift.severity} severity drift`,
    timestamp: Date.now(),
    taskIds: pendingTasks.map(t => t.id),
    context: {
      id: generateId('inj'),
      type: 'warning',
      content: `**Drift Detected in Previous Task:** ${drift.description}\n\nPlease ensure your work stays aligned with the original intent.`,
      source: sourceTaskId,
      priority: drift.severity === 'medium' ? 'should_know' : 'nice_to_know',
      targetTaskId: '*', // All tasks
      createdAt: Date.now(),
    },
  };
}

/**
 * Create action for discovery injection
 */
function createDiscoveryInjectionAction(
  outcomeId: string,
  discovery: HomrDiscovery
): InjectContextAction {
  const priority: 'must_know' | 'should_know' | 'nice_to_know' =
    discovery.type === 'blocker' ? 'must_know' :
    discovery.type === 'constraint' || discovery.type === 'dependency' ? 'should_know' :
    'nice_to_know';

  return {
    type: 'inject_context',
    reason: `Share ${discovery.type} discovery with relevant tasks`,
    timestamp: Date.now(),
    taskIds: discovery.relevantTasks,
    context: {
      id: generateId('inj'),
      type: 'discovery',
      content: discovery.content,
      source: discovery.source,
      priority,
      targetTaskId: discovery.relevantTasks.includes('*') ? '*' : discovery.relevantTasks[0],
      createdAt: Date.now(),
    },
  };
}

/**
 * Execute a steering action
 */
async function executeSteeringAction(action: AnySteeringAction, outcomeId: string): Promise<void> {
  switch (action.type) {
    case 'inject_context': {
      const injectAction = action as InjectContextAction;

      // If targeting all tasks, use '*'
      if (injectAction.taskIds.includes('*') || injectAction.context.targetTaskId === '*') {
        addContextInjection(outcomeId, {
          ...injectAction.context,
          targetTaskId: '*',
        });
      } else {
        // Add injection for each specific task
        for (const taskId of injectAction.taskIds) {
          addContextInjection(outcomeId, {
            ...injectAction.context,
            id: generateId('inj'),
            targetTaskId: taskId,
          });
        }
      }
      console.log(`[HOMЯ Steerer] Injected context to ${injectAction.taskIds.length} task(s)`);
      break;
    }

    case 'create_task': {
      const createAction = action as CreateTaskAction;
      createTask({
        outcome_id: outcomeId,
        title: createAction.task.title,
        description: createAction.task.description,
        priority: createAction.task.priority,
        phase: createAction.task.phase || 'execution',
      });
      console.log(`[HOMЯ Steerer] Created corrective task: ${createAction.task.title}`);
      break;
    }

    case 'update_task': {
      // Update task description
      const task = getTaskById(action.taskId);
      if (task) {
        const newDescription = task.description
          ? `${task.description}\n\n---\n\n**HOMЯ Update:**\n${action.additions}`
          : `**HOMЯ Update:**\n${action.additions}`;
        updateTask(action.taskId, { description: newDescription });
        console.log(`[HOMЯ Steerer] Updated task ${action.taskId} description`);
      }
      break;
    }

    case 'update_priority': {
      updateTask(action.taskId, { priority: action.newPriority });
      console.log(`[HOMЯ Steerer] Updated task ${action.taskId} priority to ${action.newPriority}`);
      break;
    }

    case 'mark_obsolete': {
      // We don't have a status for obsolete, so we'll just update the description
      const task = getTaskById(action.taskId);
      if (task) {
        updateTask(action.taskId, {
          description: `**MARKED OBSOLETE BY HOMЯ:**\n${action.reason}\n\n---\n\n${task.description || ''}`,
        });
        console.log(`[HOMЯ Steerer] Marked task ${action.taskId} as obsolete`);
      }
      break;
    }
  }
}

// ============================================================================
// Context Compaction
// ============================================================================

/**
 * Compact the context store to prevent unbounded growth
 */
export function compactContext(outcomeId: string, maxDiscoveries: number = 50): void {
  const context = getHomrContext(outcomeId);
  if (!context) return;

  const discoveries: HomrDiscovery[] = JSON.parse(context.discoveries);

  if (discoveries.length <= maxDiscoveries) {
    return; // No compaction needed
  }

  // Score discoveries by relevance (blockers and recent items score higher)
  const scored = discoveries.map((d, index) => ({
    discovery: d,
    score: calculateRelevanceScore(d, index, discoveries.length),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Keep top discoveries
  const kept = scored.slice(0, maxDiscoveries).map(s => s.discovery);

  // Create summary of compacted discoveries
  const compacted = scored.slice(maxDiscoveries);
  if (compacted.length > 0) {
    const summaryDiscovery: HomrDiscovery = {
      type: 'pattern',
      content: `[Compacted ${compacted.length} earlier discoveries] Including: ${
        compacted.slice(0, 3).map(c => c.discovery.content.substring(0, 50)).join('; ')
      }...`,
      relevantTasks: ['*'],
      source: 'HOMЯ Compaction',
    };
    kept.push(summaryDiscovery);
  }

  // Update context store
  updateHomrContext(outcomeId, { discoveries: kept });

  console.log(`[HOMЯ Steerer] Compacted context: ${discoveries.length} -> ${kept.length} discoveries`);

  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'context_compaction',
      before: discoveries.length,
      after: kept.length,
      compacted: compacted.length,
    },
    summary: `Compacted ${compacted.length} discoveries to maintain context size`,
  });
}

/**
 * Calculate relevance score for a discovery
 */
function calculateRelevanceScore(
  discovery: HomrDiscovery,
  index: number,
  total: number
): number {
  let score = 0;

  // Type priority (blockers are most important)
  const typePriority: Record<string, number> = {
    blocker: 100,
    constraint: 80,
    dependency: 70,
    decision: 60,
    pattern: 40,
  };
  score += typePriority[discovery.type] || 30;

  // Recency (newer items score higher)
  const recencyScore = (index / total) * 50;
  score += recencyScore;

  // Relevance to all tasks scores higher
  if (discovery.relevantTasks.includes('*')) {
    score += 20;
  }

  return score;
}

// ============================================================================
// Decision Management
// ============================================================================

/**
 * Add a decision to the context store
 */
export function recordDecision(
  outcomeId: string,
  content: string,
  madeBy: 'human' | 'worker' | 'homr',
  context: string,
  affectedAreas: string[] = []
): void {
  const contextStore = getOrCreateHomrContext(outcomeId);
  const decisions: HomrDecision[] = JSON.parse(contextStore.decisions);

  decisions.push({
    id: generateId('dec'),
    content,
    madeBy,
    madeAt: Date.now(),
    context,
    affectedAreas,
  });

  updateHomrContext(outcomeId, { decisions });

  console.log(`[HOMЯ Steerer] Recorded decision: ${content.substring(0, 50)}...`);
}

/**
 * Add a constraint to the context store
 */
export function recordConstraint(
  outcomeId: string,
  type: HomrConstraint['type'],
  content: string,
  source: string
): void {
  const contextStore = getOrCreateHomrContext(outcomeId);
  const constraints: HomrConstraint[] = JSON.parse(contextStore.constraints);

  constraints.push({
    id: generateId('con'),
    type,
    content,
    discoveredAt: Date.now(),
    source,
    active: true,
  });

  updateHomrContext(outcomeId, { constraints });

  console.log(`[HOMЯ Steerer] Recorded constraint: ${content.substring(0, 50)}...`);
}

/**
 * Deactivate a constraint
 */
export function deactivateConstraint(outcomeId: string, constraintId: string): void {
  const contextStore = getHomrContext(outcomeId);
  if (!contextStore) return;

  const constraints: HomrConstraint[] = JSON.parse(contextStore.constraints);
  const constraint = constraints.find(c => c.id === constraintId);

  if (constraint) {
    constraint.active = false;
    updateHomrContext(outcomeId, { constraints });
    console.log(`[HOMЯ Steerer] Deactivated constraint: ${constraintId}`);
  }
}

// ============================================================================
// Dependency Graph Management
// ============================================================================

/**
 * Result of a dependency modification operation
 */
export interface DependencyModificationResult {
  success: boolean;
  taskId?: string;
  affectedTasks: string[];
  reason?: string;
}

/**
 * Insert a corrective task that blocks a target task.
 * The corrective task becomes a dependency of the target task,
 * meaning the target cannot proceed until the corrective task completes.
 *
 * @param outcomeId - The outcome to create the task in
 * @param title - Title of the corrective task
 * @param description - Description of what needs to be corrected
 * @param targetTaskId - The task that should be blocked until correction completes
 * @param priority - Priority of the corrective task (default 1 = high)
 * @returns Result including the new task ID and affected tasks
 */
export function insertCorrectiveTask(
  outcomeId: string,
  title: string,
  description: string,
  targetTaskId: string,
  priority: number = 1
): DependencyModificationResult {
  // Verify target task exists
  const targetTask = getTaskById(targetTaskId);
  if (!targetTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Target task ${targetTaskId} not found`,
    };
  }

  // Verify target task belongs to this outcome
  if (targetTask.outcome_id !== outcomeId) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Target task ${targetTaskId} does not belong to outcome ${outcomeId}`,
    };
  }

  // Create the corrective task
  const correctiveTask = createTask({
    outcome_id: outcomeId,
    title,
    description: `**Corrective Task Created by HOMЯ**\n\n${description}\n\n**Blocks:** ${targetTask.title}`,
    priority,
    phase: targetTask.phase, // Same phase as target
  });

  // Add the corrective task as a dependency of the target task
  const addResult = addDependency(targetTaskId, correctiveTask.id);

  if (!addResult.success) {
    // Rollback: we could delete the task, but leaving it is safer
    console.log(`[HOMЯ Steerer] Warning: Created corrective task but failed to add dependency: ${addResult.reason}`);
  }

  // Log the activity
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'insert_corrective_task',
      correctiveTaskId: correctiveTask.id,
      targetTaskId,
      title,
    },
    summary: `Inserted corrective task "${title}" blocking task ${targetTaskId}`,
  });

  console.log(`[HOMЯ Steerer] Inserted corrective task ${correctiveTask.id} blocking ${targetTaskId}`);

  return {
    success: true,
    taskId: correctiveTask.id,
    affectedTasks: [correctiveTask.id, targetTaskId],
  };
}

/**
 * Add a dependency from one task to another.
 * After this operation, dependentTaskId cannot be claimed until dependencyTaskId completes.
 *
 * @param dependentTaskId - The task that should wait (will have a new dependency)
 * @param dependencyTaskId - The task that must complete first (the dependency)
 * @returns Result of the operation
 */
export function addDependency(
  dependentTaskId: string,
  dependencyTaskId: string
): DependencyModificationResult {
  // Get both tasks
  const dependentTask = getTaskById(dependentTaskId);
  const dependencyTask = getTaskById(dependencyTaskId);

  if (!dependentTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Dependent task ${dependentTaskId} not found`,
    };
  }

  if (!dependencyTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Dependency task ${dependencyTaskId} not found`,
    };
  }

  // Prevent self-dependency
  if (dependentTaskId === dependencyTaskId) {
    return {
      success: false,
      affectedTasks: [],
      reason: 'A task cannot depend on itself',
    };
  }

  // Verify both tasks belong to the same outcome
  if (dependentTask.outcome_id !== dependencyTask.outcome_id) {
    return {
      success: false,
      affectedTasks: [],
      reason: 'Tasks must belong to the same outcome to create a dependency',
    };
  }

  // Parse existing dependencies
  let existingDeps: string[] = [];
  if (dependentTask.depends_on) {
    try {
      existingDeps = JSON.parse(dependentTask.depends_on);
      if (!Array.isArray(existingDeps)) {
        existingDeps = [];
      }
    } catch {
      existingDeps = [];
    }
  }

  // Check if dependency already exists
  if (existingDeps.includes(dependencyTaskId)) {
    return {
      success: true, // Already exists, not an error
      affectedTasks: [dependentTaskId],
      reason: 'Dependency already exists',
    };
  }

  // Check for circular dependency
  if (wouldCreateCircularDependency(dependentTaskId, dependencyTaskId)) {
    return {
      success: false,
      affectedTasks: [],
      reason: 'Adding this dependency would create a circular dependency',
    };
  }

  // Add the new dependency
  existingDeps.push(dependencyTaskId);

  // Update the task
  updateTask(dependentTaskId, { depends_on: existingDeps });

  console.log(`[HOMЯ Steerer] Added dependency: ${dependentTaskId} now depends on ${dependencyTaskId}`);

  return {
    success: true,
    affectedTasks: [dependentTaskId],
  };
}

/**
 * Check if adding a dependency would create a circular dependency.
 * This traverses the dependency graph from dependencyTaskId to see if
 * we can reach dependentTaskId (which would indicate a cycle).
 */
function wouldCreateCircularDependency(dependentTaskId: string, dependencyTaskId: string): boolean {
  const visited = new Set<string>();
  const queue = [dependencyTaskId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (currentId === dependentTaskId) {
      return true; // Found a cycle
    }

    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    // Get this task's dependencies
    const task = getTaskById(currentId);
    if (!task || !task.depends_on) {
      continue;
    }

    try {
      const deps = JSON.parse(task.depends_on);
      if (Array.isArray(deps)) {
        for (const depId of deps) {
          if (!visited.has(depId)) {
            queue.push(depId);
          }
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return false;
}

/**
 * Block a chain of tasks by adding a blocker task as a dependency to all of them.
 * This is useful when a fundamental issue is discovered that affects multiple downstream tasks.
 *
 * @param outcomeId - The outcome containing the tasks
 * @param blockerTaskId - The task that must complete first (already exists or newly created)
 * @param taskIdsToBlock - Array of task IDs that should be blocked
 * @returns Result including all affected tasks
 */
export function blockTaskChain(
  outcomeId: string,
  blockerTaskId: string,
  taskIdsToBlock: string[]
): DependencyModificationResult {
  // Verify blocker task exists
  const blockerTask = getTaskById(blockerTaskId);
  if (!blockerTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Blocker task ${blockerTaskId} not found`,
    };
  }

  // Verify blocker task belongs to this outcome
  if (blockerTask.outcome_id !== outcomeId) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Blocker task ${blockerTaskId} does not belong to outcome ${outcomeId}`,
    };
  }

  const affectedTasks: string[] = [];
  const errors: string[] = [];

  for (const taskId of taskIdsToBlock) {
    // Skip if trying to block the blocker itself
    if (taskId === blockerTaskId) {
      continue;
    }

    const result = addDependency(taskId, blockerTaskId);
    if (result.success) {
      affectedTasks.push(taskId);
    } else {
      errors.push(`${taskId}: ${result.reason}`);
    }
  }

  // Log the activity
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'block_task_chain',
      blockerTaskId,
      blockedTasks: affectedTasks,
      errors: errors.length > 0 ? errors : undefined,
    },
    summary: `Blocked ${affectedTasks.length} task(s) with blocker task ${blockerTaskId}`,
  });

  if (affectedTasks.length > 0) {
    console.log(`[HOMЯ Steerer] Blocked ${affectedTasks.length} tasks with blocker ${blockerTaskId}`);
  }

  return {
    success: affectedTasks.length > 0 || errors.length === 0,
    affectedTasks,
    reason: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Remove a dependency from a task.
 * After this operation, dependentTaskId no longer waits for dependencyTaskId.
 *
 * @param dependentTaskId - The task to remove the dependency from
 * @param dependencyTaskId - The dependency to remove
 * @returns Result of the operation
 */
export function removeDependency(
  dependentTaskId: string,
  dependencyTaskId: string
): DependencyModificationResult {
  const dependentTask = getTaskById(dependentTaskId);

  if (!dependentTask) {
    return {
      success: false,
      affectedTasks: [],
      reason: `Task ${dependentTaskId} not found`,
    };
  }

  // Parse existing dependencies
  let existingDeps: string[] = [];
  if (dependentTask.depends_on) {
    try {
      existingDeps = JSON.parse(dependentTask.depends_on);
      if (!Array.isArray(existingDeps)) {
        existingDeps = [];
      }
    } catch {
      existingDeps = [];
    }
  }

  // Check if dependency exists
  const index = existingDeps.indexOf(dependencyTaskId);
  if (index === -1) {
    return {
      success: true, // Already doesn't exist
      affectedTasks: [dependentTaskId],
      reason: 'Dependency does not exist',
    };
  }

  // Remove the dependency
  existingDeps.splice(index, 1);

  // Update the task
  updateTask(dependentTaskId, { depends_on: existingDeps });

  console.log(`[HOMЯ Steerer] Removed dependency: ${dependentTaskId} no longer depends on ${dependencyTaskId}`);

  return {
    success: true,
    affectedTasks: [dependentTaskId],
  };
}

/**
 * Get all tasks that are directly blocked by a given task.
 * These are tasks that have the given task as a dependency.
 *
 * @param taskId - The task to check for dependents
 * @returns Array of task IDs that depend on this task
 */
export function getTasksDependingOn(taskId: string): string[] {
  const task = getTaskById(taskId);
  if (!task) return [];

  const allTasks = getPendingTasks(task.outcome_id);
  const dependents: string[] = [];

  for (const t of allTasks) {
    if (!t.depends_on) continue;

    try {
      const deps = JSON.parse(t.depends_on);
      if (Array.isArray(deps) && deps.includes(taskId)) {
        dependents.push(t.id);
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return dependents;
}

// ============================================================================
// Escalation Decision Application
// ============================================================================

/**
 * Decision action types that can be applied
 */
export type EscalationDecisionAction =
  | 'inject_context'      // Add context/guidance to affected tasks
  | 'update_priority'     // Change task priority
  | 'add_dependency'      // Add a dependency between tasks
  | 'update_description'  // Append to task description
  | 'record_decision';    // Record the decision in context store

/**
 * Result of applying an escalation decision
 */
export interface EscalationDecisionResult {
  success: boolean;
  actionsApplied: EscalationDecisionAction[];
  affectedTaskIds: string[];
  errors: string[];
  decision?: HomrDecision;
}

/**
 * Options for applying an escalation decision
 */
export interface ApplyEscalationDecisionOptions {
  /** The escalation that was answered */
  escalation: HomrEscalation;
  /** The selected option from the escalation */
  selectedOption: HomrQuestionOption;
  /** Additional context provided by the human */
  additionalContext?: string;
  /** Override the affected tasks (defaults to escalation.affected_tasks) */
  affectedTaskIds?: string[];
  /** Priority to assign to affected tasks (if changing priority) */
  newPriority?: number;
  /** Task ID to add as a dependency to all affected tasks */
  dependencyTaskId?: string;
  /** Whether to inject context into affected tasks (default: true) */
  injectContext?: boolean;
  /** Whether to update task descriptions (default: true) */
  updateDescriptions?: boolean;
  /** Whether to record the decision in context store (default: true) */
  recordInContext?: boolean;
}

/**
 * Apply an escalation decision to affected tasks.
 *
 * This function modifies tasks based on a human's answer to an escalation:
 * - Injects context into pending tasks so they're aware of the decision
 * - Updates task priorities if specified
 * - Adds dependencies if specified
 * - Records the decision in the HOMЯ context store
 *
 * @param options Configuration for applying the decision
 * @returns Result with details of what was applied
 */
export function applyEscalationDecision(
  options: ApplyEscalationDecisionOptions
): EscalationDecisionResult {
  const {
    escalation,
    selectedOption,
    additionalContext,
    affectedTaskIds: overrideAffectedTasks,
    newPriority,
    dependencyTaskId,
    injectContext = true,
    updateDescriptions = true,
    recordInContext = true,
  } = options;

  const result: EscalationDecisionResult = {
    success: true,
    actionsApplied: [],
    affectedTaskIds: [],
    errors: [],
  };

  // Parse affected tasks from escalation or use override
  let affectedTasks: string[] = [];
  if (overrideAffectedTasks) {
    affectedTasks = overrideAffectedTasks;
  } else if (escalation.affected_tasks) {
    try {
      affectedTasks = JSON.parse(escalation.affected_tasks);
      if (!Array.isArray(affectedTasks)) {
        affectedTasks = [];
      }
    } catch {
      result.errors.push('Failed to parse affected_tasks from escalation');
      affectedTasks = [];
    }
  }

  const outcomeId = escalation.outcome_id;

  // =========================================================================
  // 1. Record decision in context store
  // =========================================================================
  if (recordInContext) {
    const decision: HomrDecision = {
      id: generateId('dec'),
      content: `${selectedOption.label}: ${selectedOption.description}`,
      madeBy: 'human',
      madeAt: Date.now(),
      context: `Escalation question: ${escalation.question_text}${
        additionalContext ? `\nHuman context: ${additionalContext}` : ''
      }`,
      affectedAreas: affectedTasks,
    };

    const contextStore = getOrCreateHomrContext(outcomeId);
    const decisions: HomrDecision[] = JSON.parse(contextStore.decisions);
    decisions.push(decision);
    updateHomrContext(outcomeId, { decisions });

    result.actionsApplied.push('record_decision');
    result.decision = decision;

    console.log(`[HOMЯ Steerer] Recorded decision from escalation: ${selectedOption.label}`);
  }

  // =========================================================================
  // 2. Inject context into affected tasks
  // =========================================================================
  if (injectContext && affectedTasks.length > 0) {
    const contextContent = buildDecisionContextContent(
      selectedOption,
      additionalContext,
      escalation.question_text
    );

    // Use '*' if all tasks are affected, otherwise inject per task
    const targetTaskId = affectedTasks.length > 3 ? '*' : affectedTasks[0];

    if (targetTaskId === '*') {
      addContextInjection(outcomeId, {
        id: generateId('inj'),
        type: 'decision',
        content: contextContent,
        source: `Escalation: ${escalation.id}`,
        priority: 'must_know',
        targetTaskId: '*',
        createdAt: Date.now(),
      });
    } else {
      for (const taskId of affectedTasks) {
        addContextInjection(outcomeId, {
          id: generateId('inj'),
          type: 'decision',
          content: contextContent,
          source: `Escalation: ${escalation.id}`,
          priority: 'must_know',
          targetTaskId: taskId,
          createdAt: Date.now(),
        });
      }
    }

    result.actionsApplied.push('inject_context');
    result.affectedTaskIds.push(...affectedTasks);

    console.log(`[HOMЯ Steerer] Injected decision context to ${affectedTasks.length} task(s)`);
  }

  // =========================================================================
  // 3. Update task descriptions
  // =========================================================================
  if (updateDescriptions && affectedTasks.length > 0) {
    const descriptionAddition = buildDescriptionAddition(
      selectedOption,
      additionalContext
    );

    for (const taskId of affectedTasks) {
      const task = getTaskById(taskId);
      if (!task) {
        result.errors.push(`Task ${taskId} not found`);
        continue;
      }

      // Skip completed/failed tasks
      if (task.status === 'completed' || task.status === 'failed') {
        continue;
      }

      const newDescription = task.description
        ? `${task.description}\n\n---\n\n${descriptionAddition}`
        : descriptionAddition;

      updateTask(taskId, { description: newDescription });
    }

    result.actionsApplied.push('update_description');

    console.log(`[HOMЯ Steerer] Updated descriptions for affected tasks`);
  }

  // =========================================================================
  // 4. Update priority if specified
  // =========================================================================
  if (newPriority !== undefined && affectedTasks.length > 0) {
    for (const taskId of affectedTasks) {
      const task = getTaskById(taskId);
      if (!task) {
        result.errors.push(`Task ${taskId} not found for priority update`);
        continue;
      }

      // Skip completed/failed tasks
      if (task.status === 'completed' || task.status === 'failed') {
        continue;
      }

      updateTask(taskId, { priority: newPriority });
    }

    result.actionsApplied.push('update_priority');

    console.log(`[HOMЯ Steerer] Updated priority to ${newPriority} for affected tasks`);
  }

  // =========================================================================
  // 5. Add dependency if specified
  // =========================================================================
  if (dependencyTaskId && affectedTasks.length > 0) {
    for (const taskId of affectedTasks) {
      // Skip if task is the dependency itself
      if (taskId === dependencyTaskId) continue;

      const depResult = addDependency(taskId, dependencyTaskId);
      if (!depResult.success) {
        result.errors.push(`Failed to add dependency for ${taskId}: ${depResult.reason}`);
      }
    }

    result.actionsApplied.push('add_dependency');

    console.log(`[HOMЯ Steerer] Added dependency ${dependencyTaskId} to affected tasks`);
  }

  // =========================================================================
  // Log the activity
  // =========================================================================
  logHomrActivity({
    outcome_id: outcomeId,
    type: 'steering',
    details: {
      action: 'apply_escalation_decision',
      escalationId: escalation.id,
      selectedOption: selectedOption.label,
      actionsApplied: result.actionsApplied,
      affectedTaskCount: result.affectedTaskIds.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    },
    summary: `Applied escalation decision "${selectedOption.label}" to ${result.affectedTaskIds.length} task(s)`,
  });

  // Set success based on whether we had any errors for critical operations
  result.success = result.errors.length === 0 || result.actionsApplied.length > 0;

  return result;
}

/**
 * Build context content for injection from a decision
 */
function buildDecisionContextContent(
  selectedOption: HomrQuestionOption,
  additionalContext: string | undefined,
  questionText: string
): string {
  let content = `**Human Decision Made**

**Question:** ${questionText}

**Decision:** ${selectedOption.label}
${selectedOption.description}`;

  if (selectedOption.implications) {
    content += `

**Implications:** ${selectedOption.implications}`;
  }

  if (additionalContext) {
    content += `

**Additional Guidance:** ${additionalContext}`;
  }

  return content;
}

/**
 * Build description addition for tasks
 */
function buildDescriptionAddition(
  selectedOption: HomrQuestionOption,
  additionalContext: string | undefined
): string {
  let addition = `**[HOMЯ Decision Applied]**
**Action:** ${selectedOption.label}
${selectedOption.description}`;

  if (additionalContext) {
    addition += `

**Human guidance:** ${additionalContext}`;
  }

  return addition;
}
