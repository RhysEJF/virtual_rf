/**
 * Task Complexity Estimator
 *
 * Analyzes a task's title, description, and context to estimate complexity
 * and required turns. Uses Claude to analyze task scope and compare against
 * worker turn limits to prevent turn limit exhaustion.
 *
 * Part of the Worker Resilience & Feedback Loop outcome.
 */

import { claudeComplete } from '../claude/client';
import type { Task, Intent, Approach } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface ComplexityEstimate {
  complexity_score: number;      // 1-10 scale
  estimated_turns: number;       // Predicted turns to complete
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;             // Why this estimate
  risk_factors: string[];        // Factors that could increase complexity
  recommendations: string[];     // Suggestions to reduce complexity if needed
}

export interface TaskContext {
  task: Task;
  outcomeIntent?: Intent | null;
  outcomeApproach?: Approach | null;
  relatedTasksCount?: number;
  priorTaskFailures?: number;
}

export interface ComplexityThresholds {
  maxTurns: number;              // Worker's turn limit (e.g., 20)
  warningRatio: number;          // Warn if estimated > maxTurns * ratio (e.g., 0.7)
  splitThreshold: number;        // Suggest splitting if complexity > this (e.g., 7)
}

const DEFAULT_THRESHOLDS: ComplexityThresholds = {
  maxTurns: 20,
  warningRatio: 0.7,
  splitThreshold: 7,
};

// ============================================================================
// Complexity Estimation
// ============================================================================

/**
 * Estimate the complexity of a task using Claude.
 * Returns a complexity score (1-10), estimated turns, and reasoning.
 */
export async function estimateTaskComplexity(
  context: TaskContext,
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS
): Promise<ComplexityEstimate> {
  const { task, outcomeIntent, outcomeApproach, relatedTasksCount, priorTaskFailures } = context;

  // Build prompt for Claude
  const prompt = buildComplexityPrompt(task, outcomeIntent, outcomeApproach, relatedTasksCount, priorTaskFailures, thresholds);

  try {
    const result = await claudeComplete({
      prompt,
      maxTurns: 1,
      timeout: 30000,
      description: `Complexity estimation for task: ${task.title}`,
    });

    if (!result.success || !result.text) {
      // Fallback to heuristic estimation if Claude fails
      return estimateComplexityHeuristically(task, thresholds);
    }

    // Parse Claude's response
    return parseComplexityResponse(result.text, thresholds);
  } catch (error) {
    console.error('[ComplexityEstimator] Claude estimation failed:', error);
    // Fallback to heuristic estimation
    return estimateComplexityHeuristically(task, thresholds);
  }
}

/**
 * Build the prompt for Claude to estimate complexity.
 */
function buildComplexityPrompt(
  task: Task,
  intent: Intent | null | undefined,
  approach: Approach | null | undefined,
  relatedTasksCount: number | undefined,
  priorTaskFailures: number | undefined,
  thresholds: ComplexityThresholds
): string {
  const taskDescription = task.description || 'No description provided';
  const prdContext = task.prd_context || 'No PRD context';
  const designContext = task.design_context || 'No design context';
  const taskApproach = task.task_approach || '';
  const taskIntent = task.task_intent || '';

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

  if (relatedTasksCount !== undefined) {
    contextInfo += `\nRELATED TASKS IN OUTCOME: ${relatedTasksCount}`;
  }

  if (priorTaskFailures !== undefined && priorTaskFailures > 0) {
    contextInfo += `\nPRIOR FAILURES: This task has failed ${priorTaskFailures} time(s) previously`;
  }

  return `You are estimating the complexity of a software development task to help prevent worker turn limit exhaustion.

TASK TITLE: ${task.title}

TASK DESCRIPTION:
${taskDescription}

PRD CONTEXT: ${prdContext}
DESIGN CONTEXT: ${designContext}
${taskIntent ? `TASK INTENT: ${taskIntent}` : ''}
${taskApproach ? `TASK APPROACH: ${taskApproach}` : ''}
${contextInfo}

CONSTRAINTS:
- Worker has a maximum of ${thresholds.maxTurns} turns to complete this task
- A "turn" is one Claude CLI invocation with tool use
- Complex tasks with many files, dependencies, or unknowns consume more turns

Analyze this task and provide an estimate in this EXACT format:

COMPLEXITY_SCORE: [1-10 number]
ESTIMATED_TURNS: [number]
CONFIDENCE: [high|medium|low]
REASONING: [1-2 sentences explaining the estimate]
RISK_FACTORS: [comma-separated list of factors that could increase complexity]
RECOMMENDATIONS: [comma-separated list of suggestions, or "none" if straightforward]

Guidelines for scoring:
1-2: Trivial (single file change, small fix, config update)
3-4: Simple (clear scope, 1-3 files, well-understood domain)
5-6: Moderate (multiple files, some integration, might need exploration)
7-8: Complex (many files, cross-cutting concerns, significant exploration needed)
9-10: Very Complex (architectural changes, many unknowns, high risk of scope creep)

Be conservative - it's better to overestimate than underestimate.`;
}

/**
 * Parse Claude's complexity estimation response.
 */
function parseComplexityResponse(
  response: string,
  thresholds: ComplexityThresholds
): ComplexityEstimate {
  const lines = response.split('\n').map(l => l.trim());

  let complexity_score = 5;
  let estimated_turns = 10;
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let reasoning = 'Unable to parse Claude response';
  let risk_factors: string[] = [];
  let recommendations: string[] = [];

  for (const line of lines) {
    if (line.startsWith('COMPLEXITY_SCORE:')) {
      const scoreStr = line.replace('COMPLEXITY_SCORE:', '').trim();
      const parsed = parseInt(scoreStr, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
        complexity_score = parsed;
      }
    } else if (line.startsWith('ESTIMATED_TURNS:')) {
      const turnsStr = line.replace('ESTIMATED_TURNS:', '').trim();
      const parsed = parseInt(turnsStr, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        estimated_turns = parsed;
      }
    } else if (line.startsWith('CONFIDENCE:')) {
      const conf = line.replace('CONFIDENCE:', '').trim().toLowerCase();
      if (conf === 'high' || conf === 'medium' || conf === 'low') {
        confidence = conf;
      }
    } else if (line.startsWith('REASONING:')) {
      reasoning = line.replace('REASONING:', '').trim();
    } else if (line.startsWith('RISK_FACTORS:')) {
      const factors = line.replace('RISK_FACTORS:', '').trim();
      if (factors.toLowerCase() !== 'none') {
        risk_factors = factors.split(',').map(f => f.trim()).filter(f => f.length > 0);
      }
    } else if (line.startsWith('RECOMMENDATIONS:')) {
      const recs = line.replace('RECOMMENDATIONS:', '').trim();
      if (recs.toLowerCase() !== 'none') {
        recommendations = recs.split(',').map(r => r.trim()).filter(r => r.length > 0);
      }
    }
  }

  // Add automatic recommendations based on thresholds
  if (estimated_turns > thresholds.maxTurns * thresholds.warningRatio) {
    if (!recommendations.includes('Consider breaking into smaller tasks')) {
      recommendations.push('Consider breaking into smaller tasks');
    }
  }

  if (complexity_score >= thresholds.splitThreshold) {
    if (!recommendations.includes('Task may benefit from decomposition')) {
      recommendations.push('Task may benefit from decomposition');
    }
  }

  return {
    complexity_score,
    estimated_turns,
    confidence,
    reasoning,
    risk_factors,
    recommendations,
  };
}

/**
 * Fallback heuristic estimation when Claude is unavailable.
 * Uses simple text analysis to estimate complexity.
 */
function estimateComplexityHeuristically(
  task: Task,
  thresholds: ComplexityThresholds
): ComplexityEstimate {
  const title = task.title.toLowerCase();
  const description = (task.description || '').toLowerCase();
  const combined = `${title} ${description}`;

  let score = 5; // Default moderate complexity
  const risk_factors: string[] = [];
  const recommendations: string[] = [];

  // Indicators of lower complexity
  const simpleIndicators = [
    'fix typo', 'update comment', 'rename', 'add logging',
    'config', 'constant', 'simple', 'minor', 'small',
  ];

  // Indicators of higher complexity
  const complexIndicators = [
    'refactor', 'redesign', 'architect', 'migrate', 'integrate',
    'complex', 'multiple', 'across', 'system', 'framework',
    'database', 'schema', 'api', 'authentication', 'security',
  ];

  // Indicators of very high complexity
  const veryComplexIndicators = [
    'rewrite', 'overhaul', 'new system', 'breaking change',
    'migration', 'distributed', 'concurrent', 'performance optimization',
  ];

  // Score adjustments
  for (const indicator of simpleIndicators) {
    if (combined.includes(indicator)) {
      score = Math.max(1, score - 1);
    }
  }

  for (const indicator of complexIndicators) {
    if (combined.includes(indicator)) {
      score = Math.min(10, score + 1);
      risk_factors.push(`Contains "${indicator}" keyword`);
    }
  }

  for (const indicator of veryComplexIndicators) {
    if (combined.includes(indicator)) {
      score = Math.min(10, score + 2);
      risk_factors.push(`Contains high-complexity keyword "${indicator}"`);
    }
  }

  // Adjust for description length (longer = potentially more complex)
  if (description.length > 500) {
    score = Math.min(10, score + 1);
    risk_factors.push('Long task description');
  }

  // Check for multiple acceptance criteria (if in PRD context)
  const prdContext = task.prd_context || '';
  const criteriaCount = (prdContext.match(/criteria|requirement|must|should/gi) || []).length;
  if (criteriaCount > 3) {
    score = Math.min(10, score + 1);
    risk_factors.push(`Multiple requirements (${criteriaCount} found)`);
  }

  // Adjust for prior failures
  if (task.attempts > 0) {
    score = Math.min(10, score + task.attempts);
    risk_factors.push(`${task.attempts} prior attempt(s)`);
    recommendations.push('Review prior failure reasons before starting');
  }

  // Estimate turns based on complexity score
  // Roughly: turns = score * 2 + base variance
  const estimated_turns = Math.max(3, Math.min(thresholds.maxTurns + 5, score * 2 + 2));

  // Add recommendations for high estimates
  if (estimated_turns > thresholds.maxTurns * thresholds.warningRatio) {
    recommendations.push('Consider breaking into smaller tasks');
  }

  if (score >= thresholds.splitThreshold) {
    recommendations.push('Task may benefit from decomposition');
  }

  return {
    complexity_score: score,
    estimated_turns,
    confidence: 'low', // Heuristic is lower confidence than Claude
    reasoning: 'Estimated via heuristic analysis (Claude unavailable)',
    risk_factors,
    recommendations,
  };
}

// ============================================================================
// Batch Estimation
// ============================================================================

/**
 * Estimate complexity for multiple tasks in batch.
 * More efficient than individual calls for outcome-wide analysis.
 */
export async function estimateMultipleTaskComplexity(
  tasks: Task[],
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null,
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS
): Promise<Map<string, ComplexityEstimate>> {
  const results = new Map<string, ComplexityEstimate>();

  // Process tasks in parallel (with concurrency limit)
  const BATCH_SIZE = 3;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(task =>
      estimateTaskComplexity(
        {
          task,
          outcomeIntent,
          outcomeApproach,
          relatedTasksCount: tasks.length,
        },
        thresholds
      ).then(estimate => ({ taskId: task.id, estimate }))
    );

    const batchResults = await Promise.all(batchPromises);
    for (const { taskId, estimate } of batchResults) {
      results.set(taskId, estimate);
    }
  }

  return results;
}

// ============================================================================
// Risk Assessment
// ============================================================================

export interface TurnLimitRiskAssessment {
  atRisk: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  estimatedTurns: number;
  maxTurns: number;
  utilizationRatio: number;
  message: string;
}

/**
 * Assess the risk of a task exceeding the turn limit.
 */
export function assessTurnLimitRisk(
  estimate: ComplexityEstimate,
  maxTurns: number
): TurnLimitRiskAssessment {
  const ratio = estimate.estimated_turns / maxTurns;

  let riskLevel: TurnLimitRiskAssessment['riskLevel'];
  let message: string;

  if (ratio <= 0.5) {
    riskLevel = 'none';
    message = 'Task is well within turn limits';
  } else if (ratio <= 0.7) {
    riskLevel = 'low';
    message = 'Task should complete within limits with some margin';
  } else if (ratio <= 0.9) {
    riskLevel = 'medium';
    message = 'Task may approach turn limits; monitor closely';
  } else if (ratio <= 1.0) {
    riskLevel = 'high';
    message = 'Task is at high risk of hitting turn limit';
  } else {
    riskLevel = 'critical';
    message = 'Task is likely to exceed turn limit; consider splitting';
  }

  return {
    atRisk: riskLevel !== 'none' && riskLevel !== 'low',
    riskLevel,
    estimatedTurns: estimate.estimated_turns,
    maxTurns,
    utilizationRatio: ratio,
    message,
  };
}

// ============================================================================
// Task Splitting Suggestions
// ============================================================================

export interface TaskSplitSuggestion {
  originalTaskId: string;
  suggestedSplits: {
    title: string;
    description: string;
    estimatedComplexity: number;
  }[];
  reasoning: string;
}

/**
 * Suggest how to split a complex task into smaller subtasks.
 * Uses Claude to analyze the task and propose a breakdown.
 */
export async function suggestTaskSplit(
  task: Task,
  estimate: ComplexityEstimate
): Promise<TaskSplitSuggestion | null> {
  // Only suggest splitting for complex tasks
  if (estimate.complexity_score < 6) {
    return null;
  }

  const prompt = `A software task has been identified as too complex (complexity score: ${estimate.complexity_score}/10, estimated ${estimate.estimated_turns} turns).

TASK TITLE: ${task.title}

TASK DESCRIPTION:
${task.description || 'No description provided'}

RISK FACTORS: ${estimate.risk_factors.join(', ') || 'None identified'}

Please suggest how to break this task into 2-4 smaller, more manageable subtasks.

Respond in this EXACT format:

REASONING: [Why this split makes sense]
---
SUBTASK_1_TITLE: [Title]
SUBTASK_1_DESC: [Brief description]
SUBTASK_1_COMPLEXITY: [1-5 estimated complexity]
---
SUBTASK_2_TITLE: [Title]
SUBTASK_2_DESC: [Brief description]
SUBTASK_2_COMPLEXITY: [1-5 estimated complexity]
---
[Continue for additional subtasks if needed]

Each subtask should:
1. Be independently completable
2. Have clear boundaries
3. Take fewer than 10 turns to complete`;

  try {
    const result = await claudeComplete({
      prompt,
      maxTurns: 1,
      timeout: 30000,
      description: `Task split suggestion for: ${task.title}`,
    });

    if (!result.success || !result.text) {
      return null;
    }

    return parseTaskSplitResponse(task.id, result.text);
  } catch (error) {
    console.error('[ComplexityEstimator] Task split suggestion failed:', error);
    return null;
  }
}

/**
 * Parse Claude's task split suggestion response.
 */
function parseTaskSplitResponse(
  taskId: string,
  response: string
): TaskSplitSuggestion | null {
  const sections = response.split('---').map(s => s.trim()).filter(s => s.length > 0);

  if (sections.length < 2) {
    return null;
  }

  let reasoning = '';
  const suggestedSplits: TaskSplitSuggestion['suggestedSplits'] = [];

  for (const section of sections) {
    const lines = section.split('\n').map(l => l.trim());

    // Check if this is the reasoning section
    if (section.startsWith('REASONING:')) {
      reasoning = section.replace('REASONING:', '').trim();
      continue;
    }

    // Parse subtask
    let title = '';
    let description = '';
    let complexity = 3;

    for (const line of lines) {
      if (line.includes('_TITLE:')) {
        title = line.split(':').slice(1).join(':').trim();
      } else if (line.includes('_DESC:')) {
        description = line.split(':').slice(1).join(':').trim();
      } else if (line.includes('_COMPLEXITY:')) {
        const compStr = line.split(':').slice(1).join(':').trim();
        const parsed = parseInt(compStr, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
          complexity = parsed;
        }
      }
    }

    if (title) {
      suggestedSplits.push({
        title,
        description,
        estimatedComplexity: complexity,
      });
    }
  }

  if (suggestedSplits.length === 0) {
    return null;
  }

  return {
    originalTaskId: taskId,
    suggestedSplits,
    reasoning,
  };
}
