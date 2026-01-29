/**
 * Orchestrator
 *
 * Manages multi-phase execution for outcomes with infrastructure needs.
 * Phase 1: Build skills and tools in parallel
 * Phase 2: Execute main tasks with skills loaded
 */

import { getOutcomeById, getOutcomeWithRelations, updateOutcome } from '../db/outcomes';
import {
  getTasksByPhase,
  getPendingInfrastructureTasks,
  isPhaseComplete,
  getPhaseStats,
  claimNextTask,
  startTask,
  completeTask,
  failTask,
} from '../db/tasks';
import { createWorker, updateWorker, getActiveWorkersByOutcome } from '../db/workers';
import {
  analyzeApproachForInfrastructure,
  createInfrastructureTasks,
  hasInfrastructureNeeds,
} from '../agents/infrastructure-planner';
import { validateSkill, loadOutcomeSkills, getSkillContent } from '../agents/skill-builder';
import { validateToolSyntax, loadOutcomeTools } from '../agents/tool-builder';
import { getWorkspacePath, ensureWorkspaceExists } from '../workspace/detector';
import { runWorkerLoop } from './worker';
import { loadEnvKeysIntoProcess, hasAnyApiKeys, listConfiguredKeys } from '../utils/env-keys';
import type { Outcome, Task, TaskPhase } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface OrchestrationState {
  outcomeId: string;
  currentPhase: 'infrastructure' | 'execution' | 'complete';
  infrastructureWorkers: string[];
  executionWorkers: string[];
}

export interface OrchestrationOptions {
  maxInfrastructureWorkers?: number;  // Default 3
  maxExecutionWorkers?: number;       // Default 1
  skipValidation?: boolean;           // Skip skill/tool validation
}

export interface OrchestrationResult {
  success: boolean;
  phase: TaskPhase | 'complete';
  message: string;
  errors?: string[];
}

// ============================================================================
// Main Orchestration
// ============================================================================

/**
 * Run orchestrated execution for an outcome.
 * Handles infrastructure phase first if needed, then execution.
 */
export async function runOrchestrated(
  outcomeId: string,
  options: OrchestrationOptions = {}
): Promise<OrchestrationResult> {
  const {
    maxInfrastructureWorkers = 3,
    maxExecutionWorkers = 1,
    skipValidation = false,
  } = options;

  console.log(`[Orchestrator] Starting orchestrated run for outcome ${outcomeId}`);

  // Get outcome with relations to access design_doc
  const outcomeWithRelations = getOutcomeWithRelations(outcomeId);
  if (!outcomeWithRelations) {
    return {
      success: false,
      phase: 'infrastructure',
      message: 'Outcome not found',
    };
  }

  const outcome = outcomeWithRelations;
  const approach = outcomeWithRelations.design_doc?.approach;

  // Check if we need to analyze for infrastructure
  if (outcome.infrastructure_ready === 0 && approach) {
    const needsInfra = hasInfrastructureNeeds(approach);
    if (needsInfra) {
      console.log('[Orchestrator] Analyzing approach for infrastructure needs...');
      const intent = outcome.intent ? JSON.parse(outcome.intent) : null;
      const plan = await analyzeApproachForInfrastructure(
        approach,
        intent,
        outcomeId
      );

      if (plan.hasInfrastructure) {
        console.log(`[Orchestrator] Found ${plan.needs.length} infrastructure needs`);
        createInfrastructureTasks(outcomeId, plan);
      } else {
        // No infrastructure needed, mark as ready
        updateOutcome(outcomeId, { infrastructure_ready: 2 });
      }
    } else {
      // No infrastructure patterns found
      updateOutcome(outcomeId, { infrastructure_ready: 2 });
    }
  }

  // Refresh outcome after potential updates
  const updatedOutcome = getOutcomeById(outcomeId)!;

  // Phase 1: Infrastructure
  if (updatedOutcome.infrastructure_ready < 2) {
    console.log('[Orchestrator] Running infrastructure phase...');
    updateOutcome(outcomeId, { infrastructure_ready: 1 });

    const infraResult = await runInfrastructurePhase(
      outcomeId,
      maxInfrastructureWorkers
    );

    if (!infraResult.success) {
      return infraResult;
    }

    // Validate infrastructure if not skipped
    if (!skipValidation) {
      const validationResult = await validateInfrastructure(outcomeId);
      if (!validationResult.valid) {
        return {
          success: false,
          phase: 'infrastructure',
          message: 'Infrastructure validation failed',
          errors: validationResult.errors,
        };
      }
    }

    // Mark infrastructure as ready
    updateOutcome(outcomeId, { infrastructure_ready: 2 });
    console.log('[Orchestrator] Infrastructure phase complete');
  }

  // Phase 2: Execution
  console.log('[Orchestrator] Running execution phase...');

  // Load API keys from .env.local into process.env
  loadEnvKeysIntoProcess();

  // Check if any API keys are configured
  if (!hasAnyApiKeys()) {
    console.warn('[Orchestrator] Warning: No API keys configured in .env.local');
    console.warn('[Orchestrator] Skills that require external APIs may not work correctly');
    console.warn('[Orchestrator] Configure API keys at /skills page to enable full functionality');
  } else {
    const configuredKeys = listConfiguredKeys();
    console.log(`[Orchestrator] Loaded ${configuredKeys.length} API keys: ${configuredKeys.join(', ')}`);
  }

  const execResult = await runExecutionPhase(outcomeId, maxExecutionWorkers);

  return execResult;
}

// ============================================================================
// Phase Execution
// ============================================================================

/**
 * Run the infrastructure phase - build skills and tools in parallel
 */
async function runInfrastructurePhase(
  outcomeId: string,
  maxWorkers: number
): Promise<OrchestrationResult> {
  const infraTasks = getPendingInfrastructureTasks(outcomeId);

  if (infraTasks.length === 0) {
    return {
      success: true,
      phase: 'infrastructure',
      message: 'No infrastructure tasks to run',
    };
  }

  console.log(`[Orchestrator] ${infraTasks.length} infrastructure tasks to run`);

  // Ensure workspace exists
  ensureWorkspaceExists(outcomeId);

  // Create workers for parallel execution (up to max)
  const workerCount = Math.min(infraTasks.length, maxWorkers);
  const workerPromises: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    workerPromises.push(runInfrastructureWorker(outcomeId, i));
  }

  // Wait for all workers to complete
  await Promise.all(workerPromises);

  // Check if all infrastructure tasks are complete
  if (isPhaseComplete(outcomeId, 'infrastructure')) {
    return {
      success: true,
      phase: 'infrastructure',
      message: 'All infrastructure tasks completed',
    };
  } else {
    const stats = getPhaseStats(outcomeId);
    return {
      success: false,
      phase: 'infrastructure',
      message: `Infrastructure phase incomplete: ${stats.infrastructure.failed} failed`,
      errors: [`${stats.infrastructure.failed} infrastructure tasks failed`],
    };
  }
}

/**
 * Run a single infrastructure worker that processes tasks until none remain
 */
async function runInfrastructureWorker(
  outcomeId: string,
  workerIndex: number
): Promise<void> {
  // Create worker record
  const worker = createWorker({
    outcome_id: outcomeId,
    name: `Infrastructure Worker ${workerIndex + 1}`,
  });

  console.log(`[Orchestrator] Infrastructure worker ${workerIndex} started: ${worker.id}`);

  try {
    // Process tasks until none remain
    while (true) {
      // Claim next infrastructure task
      const claimResult = claimNextTask(outcomeId, worker.id, 'infrastructure');

      if (!claimResult.success || !claimResult.task) {
        console.log(`[Orchestrator] Worker ${workerIndex}: No more infrastructure tasks`);
        break;
      }

      const task = claimResult.task;
      console.log(`[Orchestrator] Worker ${workerIndex} processing: ${task.title}`);

      // Start task
      startTask(task.id);
      updateWorker(worker.id, { status: 'running' });

      // Run the worker loop for this single task
      try {
        await runWorkerLoop(outcomeId, worker.id, {
          singleTask: true,
          phase: 'infrastructure',
        });

        // Task should be marked complete by worker loop
        console.log(`[Orchestrator] Worker ${workerIndex} completed: ${task.title}`);
      } catch (error) {
        console.error(`[Orchestrator] Worker ${workerIndex} error:`, error);
        failTask(task.id);
      }
    }
  } finally {
    updateWorker(worker.id, { status: 'completed' });
    console.log(`[Orchestrator] Infrastructure worker ${workerIndex} stopped`);
  }
}

/**
 * Run the execution phase with skills loaded
 */
async function runExecutionPhase(
  outcomeId: string,
  maxWorkers: number
): Promise<OrchestrationResult> {
  // Load built skills and tools
  const skills = loadOutcomeSkills(outcomeId);
  const tools = loadOutcomeTools(outcomeId);

  console.log(`[Orchestrator] Loaded ${skills.length} skills and ${tools.length} tools`);

  // Build skill context for workers
  const skillContext = buildSkillContext(outcomeId, skills);

  // Create and run execution workers
  const workerCount = Math.min(1, maxWorkers); // Start with 1 for now

  for (let i = 0; i < workerCount; i++) {
    const worker = createWorker({
      outcome_id: outcomeId,
      name: `Execution Worker ${i + 1}`,
    });

    console.log(`[Orchestrator] Execution worker started: ${worker.id}`);

    // Run worker with skill context
    await runWorkerLoop(outcomeId, worker.id, {
      phase: 'execution',
      skillContext,
    });

    updateWorker(worker.id, { status: 'completed' });
  }

  // Check completion
  if (isPhaseComplete(outcomeId, 'execution')) {
    return {
      success: true,
      phase: 'complete',
      message: 'All tasks completed successfully',
    };
  } else {
    const stats = getPhaseStats(outcomeId);
    return {
      success: stats.execution.failed === 0,
      phase: 'execution',
      message: `Execution phase: ${stats.execution.completed}/${stats.execution.total} completed`,
    };
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate all infrastructure (skills and tools) created during phase 1
 */
async function validateInfrastructure(outcomeId: string): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const workspacePath = getWorkspacePath(outcomeId);

  // Validate skills
  const skills = loadOutcomeSkills(outcomeId);
  for (const skill of skills) {
    const skillPath = `${workspacePath}/skills/${skill.name.toLowerCase().replace(/\s+/g, '-')}.md`;
    const result = await validateSkill(skillPath);
    if (!result.valid) {
      errors.push(`Skill "${skill.name}": ${result.errors.join(', ')}`);
    }
    warnings.push(...result.warnings.map(w => `Skill "${skill.name}": ${w}`));
  }

  // Validate tools
  const tools = loadOutcomeTools(outcomeId);
  for (const tool of tools) {
    const result = validateToolSyntax(tool.path);
    if (!result.valid) {
      errors.push(`Tool "${tool.name}": ${result.errors.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Skill Context
// ============================================================================

/**
 * Build skill context to inject into worker CLAUDE.md
 *
 * Strategy: Include summaries with triggers, let Claude read full skill when relevant.
 * This avoids context bloat while ensuring skills are discoverable.
 */
function buildSkillContext(
  outcomeId: string,
  skills: { name: string; triggers: string[] }[]
): string {
  if (skills.length === 0) {
    return '';
  }

  const lines = ['## Available Skills\n'];
  lines.push('The following skills have been built for this outcome:\n');

  for (const skill of skills) {
    const content = getSkillContent(outcomeId, skill.name);
    if (content) {
      // Extract purpose section for summary
      const purposeMatch = content.match(/## Purpose\n([\s\S]*?)(?=\n##|$)/);
      const purpose = purposeMatch
        ? purposeMatch[1].trim().split('\n')[0]
        : 'Skill for ' + skill.name;

      // Extract methodology section headers for preview
      const methodologyMatch = content.match(/## Methodology\n([\s\S]*?)(?=\n## |$)/);
      let methodologyPreview = '';
      if (methodologyMatch) {
        const steps = methodologyMatch[1].match(/### Step \d+[^\n]*/g);
        if (steps) {
          methodologyPreview = steps.slice(0, 3).join(', ');
          if (steps.length > 3) methodologyPreview += '...';
        }
      }

      const kebabName = skill.name.toLowerCase().replace(/\s+/g, '-');
      lines.push(`### ${skill.name}`);
      lines.push(`**Triggers:** ${skill.triggers.join(', ') || 'N/A'}`);
      lines.push(`**Purpose:** ${purpose}`);
      if (methodologyPreview) {
        lines.push(`**Methodology:** ${methodologyPreview}`);
      }
      // Use ../ because worker runs in {outcomeId}/{taskId}/
      lines.push(`**Read full skill:** \`../skills/${kebabName}.md\`\n`);
    }
  }

  lines.push(`
**How to use skills:**
1. Check if your current task matches any skill triggers above
2. If relevant, READ the full skill file using the path provided
3. Follow the skill's methodology step-by-step
4. Use the skill's output template for deliverables
`);

  return lines.join('\n');
}

// ============================================================================
// Status Queries
// ============================================================================

/**
 * Get current orchestration state for an outcome
 */
export function getOrchestrationState(outcomeId: string): OrchestrationState | null {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) return null;

  const activeWorkers = getActiveWorkersByOutcome(outcomeId);
  const stats = getPhaseStats(outcomeId);

  let currentPhase: 'infrastructure' | 'execution' | 'complete' = 'execution';

  if (outcome.infrastructure_ready === 0 || outcome.infrastructure_ready === 1) {
    currentPhase = 'infrastructure';
  } else if (
    stats.execution.total > 0 &&
    stats.execution.completed === stats.execution.total
  ) {
    currentPhase = 'complete';
  }

  // Categorize workers by what phase they're working on
  const infrastructureWorkers: string[] = [];
  const executionWorkers: string[] = [];

  for (const worker of activeWorkers) {
    // Check worker's current task phase
    const tasks = getTasksByPhase(outcomeId, 'infrastructure');
    const workerInfraTasks = tasks.filter(
      t => t.claimed_by === worker.id && t.status !== 'completed'
    );

    if (workerInfraTasks.length > 0) {
      infrastructureWorkers.push(worker.id);
    } else {
      executionWorkers.push(worker.id);
    }
  }

  return {
    outcomeId,
    currentPhase,
    infrastructureWorkers,
    executionWorkers,
  };
}

/**
 * Check if an outcome is ready for execution
 */
export function isReadyForExecution(outcomeId: string): boolean {
  const outcome = getOutcomeById(outcomeId);
  return outcome?.infrastructure_ready === 2;
}

/**
 * Check if orchestration is complete
 */
export function isOrchestrationComplete(outcomeId: string): boolean {
  const state = getOrchestrationState(outcomeId);
  return state?.currentPhase === 'complete';
}
