/**
 * Review Agent
 *
 * Periodically reviews completed work against PRD acceptance criteria.
 * Creates new tasks for issues found and tracks convergence.
 */

import { claudeComplete } from '../claude/client';
import { getOutcomeById } from '../db/outcomes';
import { getTasksByOutcome, createTask } from '../db/tasks';
import { getWorkersByOutcome } from '../db/workers';
import {
  createReviewCycle,
  getConvergenceStatus,
  hasConverged,
  type ConvergenceStatus,
} from '../db/review-cycles';
import type { Task, Intent, VerificationResult } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface ReviewIssue {
  taskId?: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  prdContext?: string;
}

export interface ReviewResult {
  success: boolean;
  outcomeId: string;
  reviewCycleId?: string;
  issuesFound: number;
  tasksCreated: number;
  issues: ReviewIssue[];
  convergence: ConvergenceStatus;
  verification?: VerificationResult;
  error?: string;
}

// ============================================================================
// Main Review Function
// ============================================================================

/**
 * Run a review cycle for an outcome.
 * Reviews completed tasks against PRD, creates tasks for issues.
 */
export async function reviewOutcome(
  outcomeId: string,
  options?: {
    workerId?: string;
    iteration?: number;
  }
): Promise<ReviewResult> {
  try {
    // Get outcome with intent
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return {
        success: false,
        outcomeId,
        issuesFound: 0,
        tasksCreated: 0,
        issues: [],
        convergence: getConvergenceStatus(outcomeId),
        error: 'Outcome not found',
      };
    }

    // Parse intent (PRD)
    let intent: Intent | null = null;
    if (outcome.intent) {
      try {
        intent = JSON.parse(outcome.intent) as Intent;
      } catch {
        // Intent might not be valid JSON
      }
    }

    // Get all tasks for this outcome
    const tasks = getTasksByOutcome(outcomeId);
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const failedTasks = tasks.filter(t => t.status === 'failed');

    // Build context for review
    const reviewContext = buildReviewContext(outcome.name, intent, completedTasks, failedTasks);

    // Run Claude review
    const reviewPrompt = buildReviewPrompt(reviewContext);
    const result = await claudeComplete({
      prompt: reviewPrompt,
      timeout: 120000, // 2 minutes for review
      maxTurns: 1,
    });

    if (!result.success || !result.text) {
      return {
        success: false,
        outcomeId,
        issuesFound: 0,
        tasksCreated: 0,
        issues: [],
        convergence: getConvergenceStatus(outcomeId),
        error: result.error || 'Review failed',
      };
    }

    // Parse issues from Claude's response
    const issues = parseReviewResponse(result.text);

    // Create tasks for each issue
    const createdTasks: Task[] = [];
    for (const issue of issues) {
      const task = createTask({
        outcome_id: outcomeId,
        title: `Fix: ${issue.title}`,
        description: issue.description,
        prd_context: issue.prdContext,
        priority: issue.severity === 'critical' ? 10 :
                  issue.severity === 'high' ? 30 :
                  issue.severity === 'medium' ? 60 : 90,
        from_review: true,
      });
      createdTasks.push(task);
    }

    // Run verification checks
    const verification = await runVerification(outcomeId, tasks);

    // Get current worker iteration
    const workers = getWorkersByOutcome(outcomeId);
    const activeWorker = workers.find(w => w.status === 'running');
    const iterationAt = options?.iteration || activeWorker?.iteration || 0;

    // Create review cycle record
    const reviewCycle = createReviewCycle({
      outcome_id: outcomeId,
      worker_id: options?.workerId || activeWorker?.id,
      iteration_at: iterationAt,
      issues_found: issues.length,
      tasks_added: createdTasks.length,
      verification,
    });

    // Get updated convergence status
    const convergence = getConvergenceStatus(outcomeId);

    return {
      success: true,
      outcomeId,
      reviewCycleId: reviewCycle.id,
      issuesFound: issues.length,
      tasksCreated: createdTasks.length,
      issues,
      convergence,
      verification,
    };
  } catch (error) {
    return {
      success: false,
      outcomeId,
      issuesFound: 0,
      tasksCreated: 0,
      issues: [],
      convergence: getConvergenceStatus(outcomeId),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Context Building
// ============================================================================

interface ReviewContext {
  outcomeName: string;
  prdItems: { id: string; title: string; criteria: string[] }[];
  completedTasks: { id: string; title: string; description?: string }[];
  failedTasks: { id: string; title: string; description?: string }[];
}

function buildReviewContext(
  outcomeName: string,
  intent: Intent | null,
  completedTasks: Task[],
  failedTasks: Task[]
): ReviewContext {
  return {
    outcomeName,
    prdItems: intent?.items.map(item => ({
      id: item.id,
      title: item.title,
      criteria: item.acceptance_criteria,
    })) || [],
    completedTasks: completedTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || undefined,
    })),
    failedTasks: failedTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || undefined,
    })),
  };
}

function buildReviewPrompt(context: ReviewContext): string {
  const prdSection = context.prdItems.length > 0
    ? context.prdItems.map(item =>
        `## ${item.id}: ${item.title}\nAcceptance Criteria:\n${item.criteria.map(c => `- ${c}`).join('\n')}`
      ).join('\n\n')
    : 'No specific PRD items defined.';

  const completedSection = context.completedTasks.length > 0
    ? context.completedTasks.map(t =>
        `- [${t.id}] ${t.title}${t.description ? `: ${t.description}` : ''}`
      ).join('\n')
    : 'No tasks completed yet.';

  const failedSection = context.failedTasks.length > 0
    ? context.failedTasks.map(t =>
        `- [${t.id}] ${t.title}${t.description ? `: ${t.description}` : ''}`
      ).join('\n')
    : 'No failed tasks.';

  return `You are reviewing work for: ${context.outcomeName}

## PRD Requirements
${prdSection}

## Completed Tasks
${completedSection}

## Failed Tasks
${failedSection}

---

Review the completed work against the PRD requirements and acceptance criteria.
Identify any issues that need to be fixed.

For each issue found, respond in this format:
ISSUE: [severity: critical|high|medium|low]
TITLE: Brief title of the issue
DESCRIPTION: Detailed description of what needs to be fixed
PRD_CONTEXT: Which PRD item this relates to (if applicable)
---

If everything looks good and meets the acceptance criteria, respond with:
NO_ISSUES

Be thorough but fair. Only report genuine issues that would prevent the work from meeting requirements.`;
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseReviewResponse(response: string): ReviewIssue[] {
  if (response.includes('NO_ISSUES')) {
    return [];
  }

  const issues: ReviewIssue[] = [];
  const issueBlocks = response.split('---').filter(block => block.includes('ISSUE:'));

  for (const block of issueBlocks) {
    const lines = block.split('\n').map(l => l.trim());

    let severity: ReviewIssue['severity'] = 'medium';
    let title = '';
    let description = '';
    let prdContext: string | undefined;

    for (const line of lines) {
      if (line.startsWith('ISSUE:')) {
        const severityMatch = line.match(/severity:\s*(critical|high|medium|low)/i);
        if (severityMatch) {
          severity = severityMatch[1].toLowerCase() as ReviewIssue['severity'];
        }
      } else if (line.startsWith('TITLE:')) {
        title = line.replace('TITLE:', '').trim();
      } else if (line.startsWith('DESCRIPTION:')) {
        description = line.replace('DESCRIPTION:', '').trim();
      } else if (line.startsWith('PRD_CONTEXT:')) {
        prdContext = line.replace('PRD_CONTEXT:', '').trim();
      }
    }

    if (title) {
      issues.push({
        title,
        description: description || title,
        severity,
        prdContext,
      });
    }
  }

  return issues;
}

// ============================================================================
// Verification
// ============================================================================

async function runVerification(outcomeId: string, tasks: Task[]): Promise<VerificationResult> {
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const totalCount = tasks.length;

  // Basic verification - more sophisticated checks could be added
  // e.g., running actual build/test commands
  return {
    build: true, // Would run actual build check
    test: true,  // Would run actual test check
    lint: true,  // Would run actual lint check
    functionality: true, // Would test functionality
    prd_complete: completedCount === totalCount && totalCount > 0,
    tasks_complete: completedCount === totalCount,
    review_clean: false, // Will be updated based on review results
    converged: hasConverged(outcomeId),
    checked_at: Date.now(),
  };
}

// ============================================================================
// Scheduled Review
// ============================================================================

/**
 * Check if a review is needed for an outcome.
 * Reviews are triggered after every N iterations.
 */
export function needsReview(
  outcomeId: string,
  currentIteration: number,
  reviewInterval: number = 5
): boolean {
  // Check if we've done enough iterations since last review
  const workers = getWorkersByOutcome(outcomeId);
  const activeWorker = workers.find(w => w.status === 'running');

  if (!activeWorker) return false;

  // Get convergence status to see if we should even bother
  const convergence = getConvergenceStatus(outcomeId);
  if (convergence.consecutive_zero_issues >= 2) {
    // Already converged, no need for more reviews
    return false;
  }

  // Review every N iterations
  return currentIteration > 0 && currentIteration % reviewInterval === 0;
}

/**
 * Get review summary for display.
 */
export function getReviewSummary(outcomeId: string): {
  totalCycles: number;
  lastIssues: number;
  isConverging: boolean;
  convergenceMessage: string;
} {
  const convergence = getConvergenceStatus(outcomeId);

  let message: string;
  if (convergence.consecutive_zero_issues >= 2) {
    message = 'Work has converged! Ready to complete.';
  } else if (convergence.is_converging) {
    message = 'Work is converging. Close to completion.';
  } else if (convergence.trend === 'improving') {
    message = 'Making progress. Issues decreasing.';
  } else if (convergence.trend === 'worsening') {
    message = 'Issues increasing. May need intervention.';
  } else if (convergence.trend === 'stable') {
    message = 'Progress stable. Continue working.';
  } else {
    message = 'Not enough data to determine trend.';
  }

  return {
    totalCycles: convergence.total_cycles,
    lastIssues: convergence.last_issues,
    isConverging: convergence.is_converging,
    convergenceMessage: message,
  };
}
