/**
 * Orchestrator
 *
 * Manages multi-phase execution for outcomes with capability needs.
 * Phase 1: Build skills and tools in parallel (Capability Phase)
 * Phase 2: Execute main tasks with skills loaded (Execution Phase)
 */

import { getOutcomeById, getOutcomeWithRelations, updateOutcome } from '../db/outcomes';
import {
  getTasksByPhase,
  getPendingCapabilityTasks,
  isPhaseComplete,
  getPhaseStats,
  claimNextTask,
  startTask,
  completeTask,
  failTask,
} from '../db/tasks';
import { createWorker, updateWorker, getActiveWorkersByOutcome } from '../db/workers';
import {
  analyzeApproachForCapabilities,
  createCapabilityTasks,
  hasCapabilityNeeds,
} from '../agents/capability-planner';
import { validateSkill, loadOutcomeSkills, getSkillContent } from '../agents/skill-builder';
import { validateToolSyntax, loadOutcomeTools } from '../agents/tool-builder';
import { getWorkspacePath, ensureWorkspaceExists } from '../workspace/detector';
import { runWorkerLoop, isWorkerPaused } from './worker';
import { loadEnvKeysIntoProcess, hasAnyApiKeys, listConfiguredKeys } from '../utils/env-keys';
import type { Outcome, Task, TaskPhase } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface OrchestrationState {
  outcomeId: string;
  currentPhase: 'capability' | 'execution' | 'complete';
  capabilityWorkers: string[];
  executionWorkers: string[];
}

export interface OrchestrationOptions {
  maxCapabilityWorkers?: number;      // Default 3
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
 * Handles capability phase first if needed, then execution.
 */
export async function runOrchestrated(
  outcomeId: string,
  options: OrchestrationOptions = {}
): Promise<OrchestrationResult> {
  const {
    maxCapabilityWorkers = 3,
    maxExecutionWorkers = 1,
    skipValidation = false,
  } = options;

  console.log(`[Orchestrator] Starting orchestrated run for outcome ${outcomeId}`);

  // Get outcome with relations to access design_doc
  const outcomeWithRelations = getOutcomeWithRelations(outcomeId);
  if (!outcomeWithRelations) {
    return {
      success: false,
      phase: 'capability',
      message: 'Outcome not found',
    };
  }

  const outcome = outcomeWithRelations;
  const approach = outcomeWithRelations.design_doc?.approach;

  // Check if we need to analyze for capabilities
  if (outcome.capability_ready === 0 && approach) {
    const needsCapabilities = hasCapabilityNeeds(approach);
    if (needsCapabilities) {
      console.log('[Orchestrator] Analyzing approach for capability needs...');
      const intent = outcome.intent ? JSON.parse(outcome.intent) : null;
      const plan = await analyzeApproachForCapabilities(
        approach,
        intent,
        outcomeId
      );

      if (plan.hasCapabilities) {
        console.log(`[Orchestrator] Found ${plan.needs.length} capability needs`);
        createCapabilityTasks(outcomeId, plan);
      } else {
        // No capabilities needed, mark as ready
        updateOutcome(outcomeId, { capability_ready: 2 });
      }
    } else {
      // No capability patterns found
      updateOutcome(outcomeId, { capability_ready: 2 });
    }
  }

  // Refresh outcome after potential updates
  const updatedOutcome = getOutcomeById(outcomeId)!;

  // Phase 1: Capability
  if (updatedOutcome.capability_ready < 2) {
    console.log('[Orchestrator] Running capability phase...');
    updateOutcome(outcomeId, { capability_ready: 1 });

    const capabilityResult = await runCapabilityPhase(
      outcomeId,
      maxCapabilityWorkers
    );

    if (!capabilityResult.success) {
      return capabilityResult;
    }

    // Validate capabilities if not skipped
    if (!skipValidation) {
      const validationResult = await validateCapabilities(outcomeId);
      if (!validationResult.valid) {
        return {
          success: false,
          phase: 'capability',
          message: 'Capability validation failed',
          errors: validationResult.errors,
        };
      }
    }

    // Mark capability phase as ready
    updateOutcome(outcomeId, { capability_ready: 2 });
    console.log('[Orchestrator] Capability phase complete');
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
 * Run the capability phase - build skills and tools in parallel
 */
async function runCapabilityPhase(
  outcomeId: string,
  maxWorkers: number
): Promise<OrchestrationResult> {
  const capabilityTasks = getPendingCapabilityTasks(outcomeId);

  if (capabilityTasks.length === 0) {
    return {
      success: true,
      phase: 'capability',
      message: 'No capability tasks to run',
    };
  }

  console.log(`[Orchestrator] ${capabilityTasks.length} capability tasks to run`);

  // Ensure workspace exists
  ensureWorkspaceExists(outcomeId);

  // Create workers for parallel execution (up to max)
  const workerCount = Math.min(capabilityTasks.length, maxWorkers);
  const workerPromises: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    workerPromises.push(runCapabilityWorker(outcomeId, i));
  }

  // Wait for all workers to complete
  await Promise.all(workerPromises);

  // Check if all capability tasks are complete
  if (isPhaseComplete(outcomeId, 'capability')) {
    return {
      success: true,
      phase: 'capability',
      message: 'All capability tasks completed',
    };
  } else {
    const stats = getPhaseStats(outcomeId);
    return {
      success: false,
      phase: 'capability',
      message: `Capability phase incomplete: ${stats.capability.failed} failed`,
      errors: [`${stats.capability.failed} capability tasks failed`],
    };
  }
}

/**
 * Run a single capability worker that processes tasks until none remain
 */
async function runCapabilityWorker(
  outcomeId: string,
  workerIndex: number
): Promise<void> {
  // Create worker record
  const worker = createWorker({
    outcome_id: outcomeId,
    name: `Capability Worker ${workerIndex + 1}`,
  });

  console.log(`[Orchestrator] Capability worker ${workerIndex} started: ${worker.id}`);

  try {
    // Process tasks until none remain
    while (true) {
      // Check if worker has been paused
      if (isWorkerPaused(worker.id)) {
        console.log(`[Orchestrator] Worker ${workerIndex}: Paused - stopping`);
        break;
      }

      // Claim next capability task
      const claimResult = claimNextTask(outcomeId, worker.id, 'capability');

      if (!claimResult.success || !claimResult.task) {
        console.log(`[Orchestrator] Worker ${workerIndex}: No more capability tasks`);
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
          phase: 'capability',
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
    console.log(`[Orchestrator] Capability worker ${workerIndex} stopped`);
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
 * Validate all capabilities (skills and tools) created during phase 1
 */
async function validateCapabilities(outcomeId: string): Promise<{
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

  let currentPhase: 'capability' | 'execution' | 'complete' = 'execution';

  if (outcome.capability_ready === 0 || outcome.capability_ready === 1) {
    currentPhase = 'capability';
  } else if (
    stats.execution.total > 0 &&
    stats.execution.completed === stats.execution.total
  ) {
    currentPhase = 'complete';
  }

  // Categorize workers by what phase they're working on
  const capabilityWorkers: string[] = [];
  const executionWorkers: string[] = [];

  for (const worker of activeWorkers) {
    // Check worker's current task phase
    const tasks = getTasksByPhase(outcomeId, 'capability');
    const workerCapabilityTasks = tasks.filter(
      t => t.claimed_by === worker.id && t.status !== 'completed'
    );

    if (workerCapabilityTasks.length > 0) {
      capabilityWorkers.push(worker.id);
    } else {
      executionWorkers.push(worker.id);
    }
  }

  return {
    outcomeId,
    currentPhase,
    capabilityWorkers,
    executionWorkers,
  };
}

/**
 * Check if an outcome is ready for execution
 */
export function isReadyForExecution(outcomeId: string): boolean {
  const outcome = getOutcomeById(outcomeId);
  return outcome?.capability_ready === 2;
}

/**
 * Check if orchestration is complete
 */
export function isOrchestrationComplete(outcomeId: string): boolean {
  const state = getOrchestrationState(outcomeId);
  return state?.currentPhase === 'complete';
}
