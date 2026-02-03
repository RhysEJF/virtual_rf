/**
 * Task Decomposer Agent
 *
 * Takes a high-complexity task and breaks it into smaller subtasks that
 * are achievable within worker turn limits. Creates proper task dependencies
 * between subtasks to ensure correct execution order.
 *
 * Part of the Worker Resilience & Feedback Loop outcome.
 */

import { claudeComplete } from '../claude/client';
import { createTask, updateTask, getTaskById, getSubtasksByParentTaskId, CreateTaskInput } from '../db/tasks';
import { detectCircularDependencies, validateDependencies } from '../db/dependencies';
import type { Task, Intent, Approach, DecompositionStatus } from '../db/schema';
import { ComplexityEstimate, ComplexityThresholds, estimateTaskComplexity } from './task-complexity-estimator';
import { detectBulkDataTask, BulkDetectionResult, DecompositionSuggestion } from './bulk-detector';

// ============================================================================
// Types
// ============================================================================

export interface Subtask {
  title: string;
  description: string;
  estimatedComplexity: number;    // 1-10 scale
  estimatedTurns: number;         // Predicted turns to complete
  dependsOnIndices: number[];     // Indices of subtasks this depends on (0-based)
  phase?: 'capability' | 'execution';
}

export interface DecompositionResult {
  success: boolean;
  originalTaskId: string;
  subtasks: Subtask[];
  createdTaskIds: string[];       // IDs of created subtasks
  reasoning: string;
  error?: string;
}

export interface DecompositionContext {
  task: Task;
  complexityEstimate?: ComplexityEstimate;
  outcomeIntent?: Intent | null;
  outcomeApproach?: Approach | null;
  maxTurnsPerSubtask?: number;    // Target max turns per subtask (default: 10)
  forceDecompose?: boolean;       // Skip complexity threshold check (for user-requested decomposition)
}

export interface DecompositionThresholds {
  minComplexityToDecompose: number;  // Only decompose if complexity >= this (default: 6)
  maxTurnsPerSubtask: number;        // Target max turns per subtask (default: 10)
  maxSubtasks: number;               // Maximum subtasks to create (default: 6)
  workerMaxTurns: number;            // Worker turn limit for context (default: 20)
}

const DEFAULT_THRESHOLDS: DecompositionThresholds = {
  minComplexityToDecompose: 6,
  maxTurnsPerSubtask: 10,
  maxSubtasks: 6,
  workerMaxTurns: 20,
};

// ============================================================================
// Main Decomposition Function
// ============================================================================

/**
 * Decompose a high-complexity task into smaller subtasks.
 * Returns the created subtask IDs with proper dependencies between them.
 *
 * Uses atomic state transitions to prevent race conditions:
 * 1. Sets decomposition_status = 'in_progress' BEFORE calling Claude
 * 2. Sets decomposition_status = 'completed' and status = 'completed' AFTER subtasks created
 * 3. Sets decomposition_status = 'failed' if decomposition fails
 *
 * Includes idempotency check: if subtasks already exist for this task,
 * returns existing subtask IDs instead of creating duplicates.
 */
export async function decomposeTask(
  context: DecompositionContext,
  thresholds: DecompositionThresholds = DEFAULT_THRESHOLDS
): Promise<DecompositionResult> {
  const { task, complexityEstimate, outcomeIntent, outcomeApproach, maxTurnsPerSubtask, forceDecompose } = context;
  const effectiveMaxTurns = maxTurnsPerSubtask ?? thresholds.maxTurnsPerSubtask;

  // ============================================================================
  // Idempotency Check: Return existing subtasks if they already exist
  // ============================================================================
  const existingSubtasks = getSubtasksByParentTaskId(task.id);
  if (existingSubtasks.length > 0) {
    console.log(`[TaskDecomposer] Found ${existingSubtasks.length} existing subtasks for task ${task.id}, returning them (idempotency)`);
    return {
      success: true,
      originalTaskId: task.id,
      subtasks: existingSubtasks.map(st => ({
        title: st.title,
        description: st.description || '',
        estimatedComplexity: st.complexity_score || 3,
        estimatedTurns: st.estimated_turns || 5,
        dependsOnIndices: [], // We don't reconstruct indices for existing subtasks
        phase: st.phase as 'capability' | 'execution' | undefined,
      })),
      createdTaskIds: existingSubtasks.map(st => st.id),
      reasoning: 'Returning existing subtasks (idempotency check)',
    };
  }

  // ============================================================================
  // Check if decomposition is already in progress (another worker may be handling it)
  // ============================================================================
  const currentTask = getTaskById(task.id);
  if (currentTask?.decomposition_status === 'in_progress') {
    console.log(`[TaskDecomposer] Task ${task.id} decomposition already in progress, skipping`);
    return {
      success: false,
      originalTaskId: task.id,
      subtasks: [],
      createdTaskIds: [],
      reasoning: 'Decomposition already in progress by another worker',
    };
  }

  // Get or estimate complexity
  let estimate = complexityEstimate;
  if (!estimate) {
    estimate = await estimateTaskComplexity(
      { task, outcomeIntent, outcomeApproach },
      { maxTurns: thresholds.workerMaxTurns, warningRatio: 0.7, splitThreshold: thresholds.minComplexityToDecompose }
    );
  }

  // Check if decomposition is needed (skip check if forceDecompose is true)
  if (!forceDecompose && estimate.complexity_score < thresholds.minComplexityToDecompose) {
    return {
      success: false,
      originalTaskId: task.id,
      subtasks: [],
      createdTaskIds: [],
      reasoning: `Task complexity (${estimate.complexity_score}/10) is below decomposition threshold (${thresholds.minComplexityToDecompose})`,
    };
  }

  // ============================================================================
  // Atomic State Transition: Set decomposition_status = 'in_progress'
  // ============================================================================
  console.log(`[TaskDecomposer] Setting decomposition_status='in_progress' for task ${task.id}`);
  await updateTask(task.id, { decomposition_status: 'in_progress' });

  // Use Claude to decompose the task
  const prompt = buildDecompositionPrompt(task, estimate, outcomeIntent, outcomeApproach, thresholds, effectiveMaxTurns);

  try {
    const result = await claudeComplete({
      prompt,
      maxTurns: 5, // Increased from 1 - Claude may need several turns for complex decomposition
      timeout: 90000,
      description: `Task decomposition for: ${task.title}`,
    });

    if (!result.success || !result.text) {
      // ============================================================================
      // Atomic State Transition: Set decomposition_status = 'failed'
      // ============================================================================
      console.log(`[TaskDecomposer] Claude decomposition failed for task ${task.id}, setting decomposition_status='failed'`);
      await updateTask(task.id, { decomposition_status: 'failed' });

      return {
        success: false,
        originalTaskId: task.id,
        subtasks: [],
        createdTaskIds: [],
        reasoning: 'Claude decomposition failed',
        error: result.error || 'No response from Claude',
      };
    }

    // Parse the decomposition response
    const parseResult = parseDecompositionResponse(result.text, thresholds);
    if (!parseResult.success || parseResult.subtasks.length === 0) {
      // ============================================================================
      // Atomic State Transition: Set decomposition_status = 'failed'
      // ============================================================================
      console.log(`[TaskDecomposer] Failed to parse decomposition response for task ${task.id}, setting decomposition_status='failed'`);
      await updateTask(task.id, { decomposition_status: 'failed' });

      return {
        success: false,
        originalTaskId: task.id,
        subtasks: [],
        createdTaskIds: [],
        reasoning: parseResult.reasoning || 'Failed to parse decomposition response',
        error: parseResult.error,
      };
    }

    // Create the subtasks in the database (with decomposed_from_task_id set)
    const createdIds = await createSubtasks(task, parseResult.subtasks);

    // ============================================================================
    // Atomic State Transition: Set decomposition_status = 'completed' and status = 'completed'
    // ============================================================================
    console.log(`[TaskDecomposer] Subtasks created successfully for task ${task.id}, setting decomposition_status='completed' and status='completed'`);
    await updateTask(task.id, {
      description: `${task.description || ''}\n\n[DECOMPOSED into ${createdIds.length} subtasks: ${createdIds.join(', ')}]`,
      status: 'completed', // Critical: prevents workers from re-claiming the decomposed task
      decomposition_status: 'completed',
    });

    return {
      success: true,
      originalTaskId: task.id,
      subtasks: parseResult.subtasks,
      createdTaskIds: createdIds,
      reasoning: parseResult.reasoning,
    };
  } catch (error) {
    // ============================================================================
    // Atomic State Transition: Set decomposition_status = 'failed'
    // ============================================================================
    console.error('[TaskDecomposer] Decomposition failed:', error);
    console.log(`[TaskDecomposer] Exception during decomposition for task ${task.id}, setting decomposition_status='failed'`);
    await updateTask(task.id, { decomposition_status: 'failed' });

    return {
      success: false,
      originalTaskId: task.id,
      subtasks: [],
      createdTaskIds: [],
      reasoning: 'Decomposition failed with exception',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildDecompositionPrompt(
  task: Task,
  estimate: ComplexityEstimate,
  intent: Intent | null | undefined,
  approach: Approach | null | undefined,
  thresholds: DecompositionThresholds,
  maxTurnsPerSubtask: number
): string {
  const taskDescription = task.description || 'No description provided';
  const prdContext = task.prd_context || '';
  const designContext = task.design_context || '';
  const taskIntent = task.task_intent || '';
  const taskApproach = task.task_approach || '';

  let contextInfo = '';
  if (intent) {
    contextInfo += `\nOUTCOME SUMMARY: ${intent.summary}`;
    if (intent.success_criteria?.length) {
      contextInfo += `\nSUCCESS CRITERIA: ${intent.success_criteria.join(', ')}`;
    }
  }
  if (approach) {
    contextInfo += `\nTECH STACK: ${approach.technologies?.join(', ') || 'Not specified'}`;
    contextInfo += `\nARCHITECTURE: ${approach.architecture || 'Not specified'}`;
  }

  return `You are decomposing a complex software task into smaller, independently completable subtasks.

ORIGINAL TASK
Title: ${task.title}
Description: ${taskDescription}
${prdContext ? `PRD Context: ${prdContext}` : ''}
${designContext ? `Design Context: ${designContext}` : ''}
${taskIntent ? `Task Intent: ${taskIntent}` : ''}
${taskApproach ? `Task Approach: ${taskApproach}` : ''}
${contextInfo}

COMPLEXITY ANALYSIS
Complexity Score: ${estimate.complexity_score}/10
Estimated Turns: ${estimate.estimated_turns}
Risk Factors: ${estimate.risk_factors.join(', ') || 'None'}
Reasoning: ${estimate.reasoning}

CONSTRAINTS
- Worker has maximum ${thresholds.workerMaxTurns} turns per task
- Each subtask should require AT MOST ${maxTurnsPerSubtask} turns
- Create between 2 and ${thresholds.maxSubtasks} subtasks
- Each subtask should be independently completable
- Subtasks can depend on other subtasks (specify dependencies)
- Earlier subtasks in your list should have lower indices
- Subtask with index 0 is the first subtask and cannot depend on anything

Break this task into smaller subtasks. For each subtask, specify:
1. A clear, actionable title
2. A description of what specifically needs to be done
3. Estimated complexity (1-5, not exceeding 5)
4. Estimated turns to complete (max ${maxTurnsPerSubtask})
5. Dependencies (which other subtask indices this depends on)

CRITICAL: Dependencies must use 0-based indices. If subtask 2 depends on subtask 0 and subtask 1, write "DEPENDS_ON: 0, 1"

Response format (EXACTLY this format):

REASONING: [Explain why you split it this way and the dependency chain]
---
SUBTASK_0:
TITLE: [Clear, actionable title]
DESCRIPTION: [What needs to be done]
COMPLEXITY: [1-5]
TURNS: [1-${maxTurnsPerSubtask}]
DEPENDS_ON: [comma-separated indices, or "none"]
---
SUBTASK_1:
TITLE: [Title]
DESCRIPTION: [Description]
COMPLEXITY: [1-5]
TURNS: [1-${maxTurnsPerSubtask}]
DEPENDS_ON: [indices or "none"]
---
[Continue for more subtasks...]

Guidelines for splitting:
- Natural boundaries: setup -> implementation -> integration -> testing
- Technical layers: database -> API -> UI
- Feature scope: core functionality first, then enhancements
- Each subtask should have clear deliverables
- Avoid circular dependencies`;
}

// ============================================================================
// Response Parsing
// ============================================================================

interface ParseResult {
  success: boolean;
  subtasks: Subtask[];
  reasoning: string;
  error?: string;
}

function parseDecompositionResponse(response: string, thresholds: DecompositionThresholds): ParseResult {
  const sections = response.split('---').map(s => s.trim()).filter(s => s.length > 0);

  if (sections.length < 2) {
    return {
      success: false,
      subtasks: [],
      reasoning: '',
      error: 'Response did not contain properly formatted sections',
    };
  }

  let reasoning = '';
  const subtasks: Subtask[] = [];

  for (const section of sections) {
    // Check for reasoning section
    if (section.startsWith('REASONING:')) {
      reasoning = section.replace('REASONING:', '').trim();
      continue;
    }

    // Check for subtask section
    if (section.includes('SUBTASK_')) {
      const subtask = parseSubtaskSection(section, thresholds.maxTurnsPerSubtask);
      if (subtask) {
        subtasks.push(subtask);
      }
    }
  }

  // Validate dependencies
  const validationResult = validateSubtaskDependencies(subtasks);
  if (!validationResult.valid) {
    return {
      success: false,
      subtasks: [],
      reasoning,
      error: validationResult.error,
    };
  }

  // Enforce max subtasks
  const finalSubtasks = subtasks.slice(0, thresholds.maxSubtasks);

  return {
    success: finalSubtasks.length >= 2,
    subtasks: finalSubtasks,
    reasoning,
    error: finalSubtasks.length < 2 ? 'Fewer than 2 subtasks parsed' : undefined,
  };
}

function parseSubtaskSection(section: string, maxTurns: number): Subtask | null {
  const lines = section.split('\n').map(l => l.trim());

  let title = '';
  let description = '';
  let complexity = 3;
  let turns = 5;
  let dependsOnIndices: number[] = [];

  for (const line of lines) {
    if (line.startsWith('TITLE:')) {
      title = line.replace('TITLE:', '').trim();
    } else if (line.startsWith('DESCRIPTION:')) {
      description = line.replace('DESCRIPTION:', '').trim();
    } else if (line.startsWith('COMPLEXITY:')) {
      const parsed = parseInt(line.replace('COMPLEXITY:', '').trim(), 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
        complexity = Math.min(parsed, 5); // Cap at 5 for subtasks
      }
    } else if (line.startsWith('TURNS:')) {
      const parsed = parseInt(line.replace('TURNS:', '').trim(), 10);
      if (!isNaN(parsed) && parsed >= 1) {
        turns = Math.min(parsed, maxTurns);
      }
    } else if (line.startsWith('DEPENDS_ON:')) {
      const depsStr = line.replace('DEPENDS_ON:', '').trim().toLowerCase();
      if (depsStr !== 'none' && depsStr !== '') {
        const indices = depsStr.split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n >= 0);
        dependsOnIndices = indices;
      }
    }
  }

  if (!title) {
    return null;
  }

  return {
    title,
    description: description || title,
    estimatedComplexity: complexity,
    estimatedTurns: turns,
    dependsOnIndices,
  };
}

function validateSubtaskDependencies(subtasks: Subtask[]): { valid: boolean; error?: string } {
  // Check that all dependency indices are valid
  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i];
    for (const depIdx of subtask.dependsOnIndices) {
      if (depIdx >= i) {
        // A subtask cannot depend on itself or a later subtask
        return {
          valid: false,
          error: `Subtask ${i} cannot depend on subtask ${depIdx} (must depend on earlier subtasks only)`,
        };
      }
      if (depIdx < 0 || depIdx >= subtasks.length) {
        return {
          valid: false,
          error: `Subtask ${i} has invalid dependency index ${depIdx}`,
        };
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Create subtasks in the database with proper dependencies.
 * Sets decomposed_from_task_id on each created subtask to enable idempotency checks.
 * Returns array of created task IDs.
 */
async function createSubtasks(originalTask: Task, subtasks: Subtask[]): Promise<string[]> {
  const createdIds: string[] = [];

  // First pass: create all subtasks without dependencies (but with decomposed_from_task_id)
  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i];

    const taskInput: CreateTaskInput = {
      outcome_id: originalTask.outcome_id,
      title: `[${i + 1}/${subtasks.length}] ${subtask.title}`,
      description: buildSubtaskDescription(subtask, originalTask, i, subtasks.length),
      prd_context: originalTask.prd_context || undefined,
      design_context: originalTask.design_context || undefined,
      priority: (originalTask.priority || 100) + i, // Slightly lower priority for later subtasks
      phase: subtask.phase || originalTask.phase,
      complexity_score: subtask.estimatedComplexity,
      estimated_turns: subtask.estimatedTurns,
      // Link this subtask to its parent task for idempotency tracking
      decomposed_from_task_id: originalTask.id,
      // Dependencies will be set in second pass
    };

    const created = createTask(taskInput);
    createdIds.push(created.id);
  }

  // Second pass: set dependencies using actual task IDs
  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i];
    if (subtask.dependsOnIndices.length > 0) {
      // Map indices to actual task IDs
      const dependencyIds = subtask.dependsOnIndices
        .filter(idx => idx >= 0 && idx < createdIds.length)
        .map(idx => createdIds[idx]);

      // Validate dependencies (should always pass since we validated indices earlier)
      const validation = validateDependencies(originalTask.outcome_id, dependencyIds);
      if (!validation.valid) {
        console.warn(`[TaskDecomposer] Dependency validation failed for subtask ${i}:`, validation.errors);
        continue;
      }

      // Check for circular dependencies (shouldn't happen with our index validation, but be safe)
      const circular = detectCircularDependencies(createdIds[i], dependencyIds);
      if (circular.length > 0) {
        console.warn(`[TaskDecomposer] Circular dependency detected for subtask ${i}, skipping:`, circular);
        continue;
      }

      // Update task with dependencies
      await updateTask(createdIds[i], { depends_on: dependencyIds });
    }
  }

  return createdIds;
}

function buildSubtaskDescription(
  subtask: Subtask,
  originalTask: Task,
  index: number,
  total: number
): string {
  let desc = subtask.description;

  desc += `\n\n---\nPart ${index + 1} of ${total} subtasks from: "${originalTask.title}"`;

  if (subtask.dependsOnIndices.length > 0) {
    desc += `\nDepends on completing: subtask(s) ${subtask.dependsOnIndices.map(i => i + 1).join(', ')}`;
  }

  desc += `\n\nEstimated complexity: ${subtask.estimatedComplexity}/5`;
  desc += `\nEstimated turns: ${subtask.estimatedTurns}`;

  return desc;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a task should be decomposed based on its complexity.
 */
export function shouldDecompose(
  estimate: ComplexityEstimate,
  thresholds: DecompositionThresholds = DEFAULT_THRESHOLDS
): boolean {
  return estimate.complexity_score >= thresholds.minComplexityToDecompose;
}

/**
 * Automatically decompose a task if its complexity exceeds thresholds.
 * Returns the decomposition result if decomposed, or null if not needed.
 */
export async function autoDecomposeIfNeeded(
  task: Task,
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null,
  thresholds: DecompositionThresholds = DEFAULT_THRESHOLDS
): Promise<DecompositionResult | null> {
  // First, estimate complexity
  const estimate = await estimateTaskComplexity(
    { task, outcomeIntent, outcomeApproach },
    {
      maxTurns: thresholds.workerMaxTurns,
      warningRatio: 0.7,
      splitThreshold: thresholds.minComplexityToDecompose,
    }
  );

  // Check if decomposition is needed
  if (!shouldDecompose(estimate, thresholds)) {
    return null;
  }

  // Decompose the task
  return decomposeTask(
    {
      task,
      complexityEstimate: estimate,
      outcomeIntent,
      outcomeApproach,
    },
    thresholds
  );
}

/**
 * Get the decomposition thresholds with custom overrides.
 */
export function getThresholds(overrides?: Partial<DecompositionThresholds>): DecompositionThresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...overrides,
  };
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Decompose multiple tasks that exceed complexity thresholds.
 * Returns a map of original task IDs to their decomposition results.
 */
export async function decomposeMultipleTasks(
  tasks: Task[],
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null,
  thresholds: DecompositionThresholds = DEFAULT_THRESHOLDS
): Promise<Map<string, DecompositionResult>> {
  const results = new Map<string, DecompositionResult>();

  // Process tasks sequentially to avoid overwhelming Claude
  for (const task of tasks) {
    const result = await autoDecomposeIfNeeded(task, outcomeIntent, outcomeApproach, thresholds);
    if (result) {
      results.set(task.id, result);
    }
  }

  return results;
}

// ============================================================================
// Proactive Decomposition (Bulk Data Detection)
// ============================================================================

/**
 * Result of proactive bulk data decomposition check.
 */
export interface ProactiveDecompositionResult {
  shouldDecompose: boolean;
  bulkDetection: BulkDetectionResult | null;
  decompositionResult: DecompositionResult | null;
  reasoning: string;
}

/**
 * Proactively check if a task should be decomposed based on bulk data patterns.
 * This should be called at task CREATION time (during planning phase) to prevent
 * workers from claiming tasks that are too large.
 *
 * Unlike autoDecomposeIfNeeded (which uses complexity estimation), this function
 * uses pattern-based detection to identify bulk operations before any work begins.
 *
 * @param task - The task to check for bulk patterns
 * @param outcomeIntent - Optional outcome intent for context
 * @param outcomeApproach - Optional outcome approach for context
 * @param thresholds - Decomposition thresholds
 * @returns Result indicating whether decomposition occurred
 */
export async function proactiveDecomposeIfBulk(
  task: Task,
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null,
  thresholds: DecompositionThresholds = DEFAULT_THRESHOLDS
): Promise<ProactiveDecompositionResult> {
  // Run bulk data detection
  const bulkDetection = detectBulkDataTask({
    task,
    outcomeIntent,
    outcomeApproach,
  });

  // If not a bulk task or low confidence, skip decomposition
  if (!bulkDetection.isBulkTask) {
    return {
      shouldDecompose: false,
      bulkDetection,
      decompositionResult: null,
      reasoning: bulkDetection.reasoning,
    };
  }

  // Low confidence bulk detection - skip unless we have explicit counts
  if (bulkDetection.confidence === 'low' && bulkDetection.estimatedItemCount === null) {
    return {
      shouldDecompose: false,
      bulkDetection,
      decompositionResult: null,
      reasoning: `Bulk patterns detected with low confidence and no explicit count. ${bulkDetection.reasoning}`,
    };
  }

  console.log(`[TaskDecomposer] Proactive bulk detection triggered for task ${task.id}: ${bulkDetection.reasoning}`);

  // Adjust decomposition thresholds based on bulk detection suggestion
  const adjustedThresholds = adjustThresholdsForBulk(thresholds, bulkDetection.suggestedDecomposition);

  // Force decomposition since bulk patterns were detected
  const decompositionResult = await decomposeTask(
    {
      task,
      outcomeIntent,
      outcomeApproach,
      forceDecompose: true, // Skip complexity threshold check - bulk detection already confirmed need
    },
    adjustedThresholds
  );

  return {
    shouldDecompose: true,
    bulkDetection,
    decompositionResult,
    reasoning: `Proactive decomposition triggered by bulk data patterns. ${bulkDetection.reasoning}`,
  };
}

/**
 * Adjust decomposition thresholds based on bulk detection suggestions.
 */
function adjustThresholdsForBulk(
  baseThresholds: DecompositionThresholds,
  suggestion: DecompositionSuggestion | null
): DecompositionThresholds {
  if (!suggestion) {
    return baseThresholds;
  }

  // Adjust max subtasks based on suggestion
  const maxSubtasks = Math.min(
    Math.max(suggestion.estimatedSubtaskCount, baseThresholds.maxSubtasks),
    8 // Hard cap at 8 subtasks for bulk operations
  );

  return {
    ...baseThresholds,
    maxSubtasks,
    // Lower the complexity threshold since bulk detection already identified the need
    minComplexityToDecompose: 1,
  };
}

/**
 * Proactively decompose multiple tasks based on bulk data detection.
 * Useful for scanning all newly created tasks during the planning phase.
 *
 * @param tasks - Array of tasks to check
 * @param outcomeIntent - Optional outcome intent for context
 * @param outcomeApproach - Optional outcome approach for context
 * @param thresholds - Decomposition thresholds
 * @returns Map of task ID to proactive decomposition results
 */
export async function proactiveDecomposeMultipleTasks(
  tasks: Task[],
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null,
  thresholds: DecompositionThresholds = DEFAULT_THRESHOLDS
): Promise<Map<string, ProactiveDecompositionResult>> {
  const results = new Map<string, ProactiveDecompositionResult>();

  // Process tasks sequentially to avoid overwhelming Claude
  for (const task of tasks) {
    const result = await proactiveDecomposeIfBulk(task, outcomeIntent, outcomeApproach, thresholds);
    results.set(task.id, result);
  }

  return results;
}

/**
 * Check if a task description indicates bulk operations without running full detection.
 * Quick pre-filter for deciding whether to run full bulk detection.
 *
 * @param taskDescription - The task description text
 * @returns True if bulk indicators are present
 */
export function hasProactiveBulkIndicators(taskDescription: string): boolean {
  // Quick check patterns - faster than full detection
  const quickPatterns = [
    /\b(?:all|every|each)\s+\w+s\b/i,       // "all items", "every record"
    /\b\d{2,}\s*\w+s?\b/i,                  // "50 files", "100 records"
    /\b(?:bulk|batch|mass)\b/i,             // "bulk update", "batch process"
    /\bfor\s+each\b/i,                      // "for each item"
    /\b(?:multiple|many|several)\s+\w+/i,   // "multiple files", "many users"
    /\bprocess(?:ing)?\s+(?:all|every)\b/i, // "process all", "processing every"
    /\b(?:import|export|migrate)\s+\w+/i,   // "import data", "migrate records"
  ];

  return quickPatterns.some(pattern => pattern.test(taskDescription));
}
