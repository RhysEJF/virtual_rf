/**
 * Review Agent
 *
 * Periodically reviews completed work against PRD acceptance criteria.
 * Creates new tasks for issues found and tracks convergence.
 */

import { spawn } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { claudeComplete } from '../claude/client';
import { getOutcomeById } from '../db/outcomes';
import { getTasksByOutcome, createTask } from '../db/tasks';
import { getWorkersByOutcome } from '../db/workers';
import {
  createReviewCycle,
  getConvergenceStatus,
  type ConvergenceStatus,
} from '../db/review-cycles';
import { logReviewCompleted } from '../db/activity';
import { paths } from '../config/paths';
import type { Task, Intent } from '../db/schema';

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

export interface CriterionResult {
  criterion: string;
  passed: boolean;
  evidence?: string;
  notes?: string;
}

export interface PRDItemResult {
  id: string;
  title: string;
  passed: boolean;
  criteria: CriterionResult[];
  summary?: string;
}

export interface CriteriaEvaluationResult {
  success: boolean;
  outcomeId: string;
  outcomeName: string;
  allCriteriaPassed: boolean;
  totalCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  items: PRDItemResult[];
  globalCriteria?: CriterionResult[];
  rawResponse?: string;
  error?: string;
}

export interface ReviewResult {
  success: boolean;
  outcomeId: string;
  reviewCycleId?: string;
  issuesFound: number;
  tasksCreated: number;
  issues: ReviewIssue[];
  convergence: ConvergenceStatus;
  criteriaEvaluation?: CriteriaEvaluationResult;
  rawResponse?: string;  // Claude's full reasoning/analysis
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

    // Build review prompt
    const reviewPrompt = buildReviewPrompt(reviewContext);
    console.log('[Reviewer] Starting workspace-aware review for outcome:', outcomeId);

    // Use workspace-aware review (spawns Claude with file access)
    const result = await reviewWithFileAccess(outcomeId, reviewPrompt);

    console.log('[Reviewer] Claude result:', { success: result.success, error: result.error, textLength: result.text?.length });

    if (!result.success || !result.text) {
      return {
        success: false,
        outcomeId,
        issuesFound: 0,
        tasksCreated: 0,
        issues: [],
        convergence: getConvergenceStatus(outcomeId),
        error: result.error || 'Review failed - no response from Claude',
      };
    }

    // Parse issues from Claude's response
    const issues = parseReviewResponse(result.text);

    // Create a SINGLE investigation task instead of per-issue fix tasks.
    // This task instructs a worker to investigate each issue and create well-specified subtasks.
    let tasksCreated = 0;
    if (issues.length > 0) {
      const issueList = issues.map((issue, i) =>
        `${i + 1}. **${issue.title}** [${issue.severity}]\n   ${issue.description}${issue.prdContext ? `\n   PRD: ${issue.prdContext}` : ''}`
      ).join('\n\n');

      createTask({
        outcome_id: outcomeId,
        title: `Review: Investigate and fix ${issues.length} issue(s) from review cycle`,
        description: `The following issues were found during review:\n\n${issueList}`,
        task_intent: `Investigate each issue, determine root cause, design targeted fixes, and create well-specified fix tasks.`,
        task_approach: [
          'For each issue:',
          '1. Investigate the root cause and all affected files',
          '2. Design a pass/fail acceptance criterion',
          '3. Design a targeted fix',
          '4. Create a new task with full context (title, description, task_intent, task_approach)',
          '',
          'After creating all tasks:',
          '- Review for duplicates and overlap',
          '- Remove tasks made redundant by others',
          '- Ensure no circular dependencies',
          '- Verify only the needed tasks remain',
        ].join('\n'),
        priority: 10,
        from_review: true,
      });
      tasksCreated = 1;
    }

    // Get current worker iteration
    const workers = getWorkersByOutcome(outcomeId);
    const activeWorker = workers.find(w => w.status === 'running');
    const iterationAt = options?.iteration || activeWorker?.iteration || 0;

    // Create review cycle record with Claude's full response
    const reviewCycle = createReviewCycle({
      outcome_id: outcomeId,
      worker_id: options?.workerId || activeWorker?.id,
      iteration_at: iterationAt,
      issues_found: issues.length,
      tasks_added: tasksCreated,
      raw_response: result.text,
    });

    // Log activity
    logReviewCompleted(outcomeId, outcome.name, issues.length, tasksCreated);

    // Get updated convergence status
    const convergence = getConvergenceStatus(outcomeId);

    return {
      success: true,
      outcomeId,
      reviewCycleId: reviewCycle.id,
      issuesFound: issues.length,
      tasksCreated,
      issues,
      convergence,
      rawResponse: result.text,
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
    prdItems: (intent?.items || []).map(item => ({
      id: item.id,
      title: item.title,
      criteria: item.acceptance_criteria || [],
    })),
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
        `## ${item.id}: ${item.title}\nAcceptance Criteria:\n${(item.criteria || []).map(c => `- ${c}`).join('\n') || '- None specified'}`
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

  return `You are reviewing completed work for: ${context.outcomeName}

## PRD Requirements
${prdSection}

## Completed Tasks
${completedSection}

## Failed Tasks
${failedSection}

## Workspace
You have access to the workspace filesystem. Use it to:
1. List files created/modified by workers (ls, find)
2. Read key source files to verify implementation quality
3. Check for obvious issues (syntax errors, missing exports, broken imports)
4. Verify outputs exist where expected
5. Run build/lint/test commands if package.json exists

## Instructions
Review the actual work product — not just task descriptions.
For each issue, include:
- What file(s) are affected
- What specifically is wrong (quote code if relevant)
- Which PRD criterion this violates
- Severity: critical | high | medium | low

For each issue found, respond in this format:
ISSUE: [severity: critical|high|medium|low]
TITLE: Brief title of the issue
DESCRIPTION: Detailed description of what needs to be fixed, referencing specific files
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
// Workspace-Aware Review
// ============================================================================

/**
 * Spawn a Claude Code session with cwd set to the outcome workspace,
 * giving the reviewer actual file access to inspect work products.
 */
async function reviewWithFileAccess(
  outcomeId: string,
  reviewPrompt: string,
): Promise<{ text: string; success: boolean; error?: string; cost?: number }> {
  const workspacePath = join(paths.workspaces, outcomeId);

  // If workspace doesn't exist, fall back to regular claudeComplete
  if (!existsSync(workspacePath)) {
    console.log('[Reviewer] Workspace not found, falling back to non-file review');
    return claudeComplete({
      prompt: reviewPrompt,
      timeout: 180000,
      maxTurns: 5,
    });
  }

  // Write a temporary review instructions file
  const reviewFilePath = join(workspacePath, 'REVIEW_INSTRUCTIONS.md');
  writeFileSync(reviewFilePath, reviewPrompt, 'utf-8');

  return new Promise((resolve) => {
    const args = [
      '-p', `Read REVIEW_INSTRUCTIONS.md for your review instructions. Inspect the workspace files to verify the actual work product.`,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--max-turns', '15',
    ];

    // Strip CLAUDECODE env var to prevent nested session detection
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const claude = spawn('claude', args, {
      cwd: workspacePath,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      claude.kill('SIGTERM');
      cleanupReviewFile(reviewFilePath);
      resolve({
        text: '',
        success: false,
        error: 'Review timed out after 3 minutes',
      });
    }, 180000);

    claude.on('close', (code) => {
      clearTimeout(timeoutId);
      cleanupReviewFile(reviewFilePath);

      if (code === 0) {
        try {
          // Parse JSON result (same approach as claudeComplete)
          const lines = stdout.trim().split('\n').filter(l => l.trim());
          let text = '';
          let cost = 0;

          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(lines[i]);
              if (parsed.type === 'result') {
                text = parsed.result || '';
                cost = parsed.total_cost_usd || 0;
                break;
              }
            } catch {
              // Skip non-JSON lines
            }
          }

          if (!text && lines.length > 0) {
            try {
              const parsed = JSON.parse(stdout);
              text = parsed.result || parsed.text || '';
              cost = parsed.total_cost_usd || 0;
            } catch {
              text = stdout.trim();
            }
          }

          resolve({ text, success: true, cost });
        } catch {
          resolve({ text: stdout.trim(), success: true });
        }
      } else {
        resolve({
          text: stdout.trim(),
          success: false,
          error: stderr.trim() || `Claude CLI exited with code ${code}`,
        });
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeoutId);
      cleanupReviewFile(reviewFilePath);
      resolve({
        text: '',
        success: false,
        error: `Failed to spawn Claude CLI: ${err.message}`,
      });
    });
  });
}

/**
 * Clean up the temporary review instructions file (best effort).
 */
function cleanupReviewFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Non-critical cleanup failure
  }
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

// ============================================================================
// Criteria Evaluation
// ============================================================================

/**
 * Evaluate outcome against success criteria.
 * Returns structured pass/fail results for each criterion.
 */
export async function evaluateCriteria(
  outcomeId: string
): Promise<CriteriaEvaluationResult> {
  try {
    // Get outcome with intent
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return {
        success: false,
        outcomeId,
        outcomeName: '',
        allCriteriaPassed: false,
        totalCriteria: 0,
        passedCriteria: 0,
        failedCriteria: 0,
        items: [],
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

    if (!intent || (intent.items.length === 0 && (!intent.success_criteria || intent.success_criteria.length === 0))) {
      return {
        success: true,
        outcomeId,
        outcomeName: outcome.name,
        allCriteriaPassed: true,
        totalCriteria: 0,
        passedCriteria: 0,
        failedCriteria: 0,
        items: [],
        globalCriteria: [],
        rawResponse: 'No criteria defined for this outcome.',
      };
    }

    // Get all tasks for context
    const tasks = getTasksByOutcome(outcomeId);
    const completedTasks = tasks.filter(t => t.status === 'completed');

    // Build prompt for criteria evaluation
    const prompt = buildCriteriaEvaluationPrompt(outcome.name, intent, completedTasks);

    console.log('[Reviewer] Starting criteria evaluation for outcome:', outcomeId);

    const result = await claudeComplete({
      prompt,
      timeout: 120000,
      maxTurns: 5,
    });

    if (!result.success || !result.text) {
      return {
        success: false,
        outcomeId,
        outcomeName: outcome.name,
        allCriteriaPassed: false,
        totalCriteria: 0,
        passedCriteria: 0,
        failedCriteria: 0,
        items: [],
        error: result.error || 'Criteria evaluation failed - no response from Claude',
      };
    }

    // Parse the structured response
    const evaluation = parseCriteriaEvaluationResponse(result.text, intent);

    return {
      success: true,
      outcomeId,
      outcomeName: outcome.name,
      ...evaluation,
      rawResponse: result.text,
    };
  } catch (error) {
    return {
      success: false,
      outcomeId,
      outcomeName: '',
      allCriteriaPassed: false,
      totalCriteria: 0,
      passedCriteria: 0,
      failedCriteria: 0,
      items: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildCriteriaEvaluationPrompt(
  outcomeName: string,
  intent: Intent,
  completedTasks: Task[]
): string {
  // Build PRD items section with criteria
  const prdSection = intent.items.length > 0
    ? intent.items.map((item, idx) => {
        const criteriaList = (item.acceptance_criteria || [])
          .map((c, cIdx) => `    ${idx + 1}.${cIdx + 1}. ${c}`)
          .join('\n');
        return `${idx + 1}. [${item.id}] ${item.title}\n   Acceptance Criteria:\n${criteriaList || '    (No criteria specified)'}`;
      }).join('\n\n')
    : 'No PRD items defined.';

  // Build global success criteria section
  const globalCriteriaSection = (intent.success_criteria || []).length > 0
    ? intent.success_criteria.map((c, idx) => `  G${idx + 1}. ${c}`).join('\n')
    : 'No global success criteria defined.';

  // Build completed tasks section
  const completedSection = completedTasks.length > 0
    ? completedTasks.map(t =>
        `- [${t.id}] ${t.title}${t.description ? `: ${t.description}` : ''}`
      ).join('\n')
    : 'No tasks completed yet.';

  return `You are evaluating work for: ${outcomeName}

## PRD Items and Acceptance Criteria
${prdSection}

## Global Success Criteria
${globalCriteriaSection}

## Completed Tasks
${completedSection}

---

Evaluate each acceptance criterion and global success criterion.
For EACH criterion, determine if it PASSES or FAILS based on the completed work.

Respond in this EXACT format (one block per PRD item, followed by global criteria):

ITEM: [item_id]
TITLE: [item title]
ITEM_PASSED: [true/false]
ITEM_SUMMARY: [Brief summary of this item's status]
CRITERIA:
- CRITERION: [exact criterion text]
  PASSED: [true/false]
  EVIDENCE: [What evidence supports this determination]
  NOTES: [Any additional notes]
---

After all items, evaluate global criteria:

GLOBAL_CRITERIA:
- CRITERION: [exact criterion text]
  PASSED: [true/false]
  EVIDENCE: [What evidence supports this determination]
  NOTES: [Any additional notes]
---

Be fair but thorough. Mark a criterion as PASSED only if there is clear evidence the work meets it.
If uncertain, mark as FAILED with notes explaining what's missing.`;
}

interface ParsedEvaluation {
  allCriteriaPassed: boolean;
  totalCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  items: PRDItemResult[];
  globalCriteria: CriterionResult[];
}

/**
 * Helper function to match all occurrences of a regex pattern
 * Compatible with older ES targets that don't support matchAll
 */
function matchAllCriteria(text: string, pattern: RegExp): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  // Create a new regex with global flag to iterate
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((match = globalPattern.exec(text)) !== null) {
    results.push(match);
  }
  return results;
}

function parseCriteriaEvaluationResponse(response: string, intent: Intent): ParsedEvaluation {
  const items: PRDItemResult[] = [];
  const globalCriteria: CriterionResult[] = [];

  // Pattern for parsing criteria entries
  const criteriaPattern = /- CRITERION:\s*(.+?)\s*\n\s*PASSED:\s*(true|false)\s*\n\s*EVIDENCE:\s*(.+?)\s*\n\s*NOTES:\s*(.+?)(?=\n\s*- CRITERION:|$)/gi;

  // Split response into item blocks and global criteria block
  const blocks = response.split('---').map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    if (block.startsWith('GLOBAL_CRITERIA:')) {
      // Parse global criteria
      const criteriaMatches = matchAllCriteria(block, criteriaPattern);
      for (const match of criteriaMatches) {
        globalCriteria.push({
          criterion: match[1].trim(),
          passed: match[2].toLowerCase() === 'true',
          evidence: match[3].trim(),
          notes: match[4].trim(),
        });
      }
    } else if (block.includes('ITEM:')) {
      // Parse item block
      const itemIdMatch = block.match(/ITEM:\s*(.+)/i);
      const titleMatch = block.match(/TITLE:\s*(.+)/i);
      const passedMatch = block.match(/ITEM_PASSED:\s*(true|false)/i);
      const summaryMatch = block.match(/ITEM_SUMMARY:\s*(.+)/i);

      if (itemIdMatch) {
        const itemCriteria: CriterionResult[] = [];

        // Parse criteria within the item
        const criteriaSection = block.match(/CRITERIA:([\s\S]*?)$/i);
        if (criteriaSection) {
          const criteriaMatches = matchAllCriteria(criteriaSection[1], criteriaPattern);
          for (const match of criteriaMatches) {
            itemCriteria.push({
              criterion: match[1].trim(),
              passed: match[2].toLowerCase() === 'true',
              evidence: match[3].trim(),
              notes: match[4].trim(),
            });
          }
        }

        items.push({
          id: itemIdMatch[1].trim(),
          title: titleMatch?.[1]?.trim() || '',
          passed: passedMatch?.[1]?.toLowerCase() === 'true',
          criteria: itemCriteria,
          summary: summaryMatch?.[1]?.trim(),
        });
      }
    }
  }

  // If parsing didn't find items, try to match against intent structure
  // and use simpler parsing as fallback
  if (items.length === 0 && intent.items.length > 0) {
    for (const item of intent.items) {
      const itemCriteria: CriterionResult[] = [];
      for (const criterion of item.acceptance_criteria || []) {
        // Try to find this criterion in the response
        const criterionEscaped = criterion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const criterionMatch = response.match(new RegExp(`${criterionEscaped}[\\s\\S]*?PASSED:\\s*(true|false)`, 'i'));

        itemCriteria.push({
          criterion,
          passed: criterionMatch?.[1]?.toLowerCase() === 'true' || false,
          notes: 'Parsed from unstructured response',
        });
      }

      items.push({
        id: item.id,
        title: item.title,
        passed: itemCriteria.length > 0 ? itemCriteria.every(c => c.passed) : true,
        criteria: itemCriteria,
      });
    }
  }

  // Handle global success criteria fallback
  if (globalCriteria.length === 0 && (intent.success_criteria || []).length > 0) {
    for (const criterion of intent.success_criteria) {
      const criterionEscaped = criterion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const criterionMatch = response.match(new RegExp(`${criterionEscaped}[\\s\\S]*?PASSED:\\s*(true|false)`, 'i'));

      globalCriteria.push({
        criterion,
        passed: criterionMatch?.[1]?.toLowerCase() === 'true' || false,
        notes: 'Parsed from unstructured response',
      });
    }
  }

  // Calculate totals
  const allItemCriteria = items.flatMap(i => i.criteria);
  const allCriteria = [...allItemCriteria, ...globalCriteria];
  const totalCriteria = allCriteria.length;
  const passedCriteria = allCriteria.filter(c => c.passed).length;
  const failedCriteria = totalCriteria - passedCriteria;
  const allCriteriaPassed = failedCriteria === 0;

  return {
    allCriteriaPassed,
    totalCriteria,
    passedCriteria,
    failedCriteria,
    items,
    globalCriteria,
  };
}
