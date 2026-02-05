/**
 * Review Command
 *
 * Triggers the Reviewer agent to check outcome work against success criteria.
 * Displays pass/fail results for each criterion.
 *
 * Usage: flow review <outcome-id> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, OutputOptions } from '../utils/flags.js';

// ============================================================================
// Types
// ============================================================================

interface CriterionResult {
  criterion: string;
  passed: boolean;
  evidence?: string;
  notes?: string;
}

interface PRDItemResult {
  id: string;
  title: string;
  passed: boolean;
  criteria: CriterionResult[];
  summary?: string;
}

interface CriteriaEvaluation {
  outcomeId: string;
  outcomeName: string;
  allCriteriaPassed: boolean;
  totalCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  items: PRDItemResult[];
  globalCriteria?: CriterionResult[];
}

interface ReviewIssue {
  taskId?: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  prdContext?: string;
}

interface ConvergenceInfo {
  is_converging: boolean;
  consecutive_zero_issues: number;
  total_cycles: number;
  last_issues: number;
  trend?: string;
}

interface ReviewResponse {
  success: boolean;
  reviewCycleId?: string;
  issuesFound: number;
  tasksCreated: number;
  issues?: ReviewIssue[];
  convergence?: ConvergenceInfo;
  criteriaEvaluation?: CriteriaEvaluation;
  rawResponse?: string;
  message?: string;
  error?: string;
}

// ============================================================================
// Formatters
// ============================================================================

function formatSeverity(severity: string): string {
  switch (severity) {
    case 'critical':
      return chalk.red.bold('CRITICAL');
    case 'high':
      return chalk.red('HIGH');
    case 'medium':
      return chalk.yellow('MEDIUM');
    case 'low':
      return chalk.gray('LOW');
    default:
      return severity;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

/**
 * Creates a visual progress bar showing pass/fail ratio
 */
function createProgressBar(passed: number, total: number, width: number = 20): string {
  if (total === 0) return chalk.gray('░'.repeat(width));

  const passRatio = passed / total;
  const passedWidth = Math.round(passRatio * width);
  const failedWidth = width - passedWidth;

  const passedBar = chalk.green('█'.repeat(passedWidth));
  const failedBar = failedWidth > 0 ? chalk.red('█'.repeat(failedWidth)) : '';

  return passedBar + failedBar;
}

/**
 * Formats a percentage with appropriate coloring
 */
function formatPercentage(passed: number, total: number): string {
  if (total === 0) return chalk.gray('N/A');

  const pct = Math.round((passed / total) * 100);

  if (pct === 100) return chalk.green.bold(`${pct}%`);
  if (pct >= 80) return chalk.green(`${pct}%`);
  if (pct >= 50) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}

// ============================================================================
// Command
// ============================================================================

interface ReviewOptions extends OutputOptions {
  criteriaOnly?: boolean;
  verbose?: boolean;
}

const command = new Command('review')
  .description('Review outcome work against success criteria')
  .argument('<outcome-id>', 'Outcome ID to review')
  .option('--criteria-only', 'Only evaluate criteria (no issue tracking or task creation)', false)
  .option('--verbose', 'Show detailed evidence and notes for each criterion', false);

addOutputFlags(command);

export const reviewCommand = command
  .action(async (outcomeId: string, options: ReviewOptions) => {
    try {
      console.log();
      console.log(chalk.gray('Running review...'));

      // Build query string
      const queryParams = options.criteriaOnly ? '?criteriaOnly=true' : '';

      // Call the review API
      const response = await api.post<ReviewResponse>(
        `/outcomes/${outcomeId}/review${queryParams}`,
        {},
        { timeout: 180000 } // 3 minute timeout for review
      );

      // Handle JSON/quiet output
      if (options.json || options.quiet) {
        if (handleOutput(response, options, outcomeId)) {
          return;
        }
      }

      // Clear the "Running review..." line
      console.log();

      // Check for errors
      if (!response.success) {
        console.error(chalk.red('Review failed:'), response.error || 'Unknown error');
        process.exit(1);
      }

      // Display results header
      const evaluation = response.criteriaEvaluation;
      if (evaluation) {
        console.log(chalk.bold.white(evaluation.outcomeName));
        console.log(chalk.gray('─'.repeat(60)));
        console.log();

        // Overall status with progress bar
        const progressBar = createProgressBar(evaluation.passedCriteria, evaluation.totalCriteria);
        const percentage = formatPercentage(evaluation.passedCriteria, evaluation.totalCriteria);

        if (evaluation.allCriteriaPassed) {
          console.log(chalk.green.bold('✓ ALL CRITERIA PASSED'));
        } else {
          console.log(chalk.red.bold('✗ SOME CRITERIA FAILED'));
        }
        console.log();

        // Visual progress bar with stats
        console.log(`  ${progressBar}  ${percentage}`);
        console.log(`  ${chalk.green(evaluation.passedCriteria.toString())} passed ${chalk.gray('/')} ${evaluation.failedCriteria > 0 ? chalk.red(evaluation.failedCriteria.toString()) : chalk.gray('0')} failed ${chalk.gray('/')} ${chalk.white(evaluation.totalCriteria.toString())} total`);
        console.log();

        // PRD Items
        if (evaluation.items.length > 0) {
          console.log(chalk.bold.cyan('PRD Items'));
          console.log();

          for (const item of evaluation.items) {
            // Item header with status
            const statusIcon = item.passed ? chalk.green('✓') : chalk.red('✗');
            const itemPassedCount = item.criteria.filter(c => c.passed).length;
            const itemTotalCount = item.criteria.length;
            const itemStats = itemTotalCount > 0
              ? chalk.gray(` (${itemPassedCount}/${itemTotalCount})`)
              : '';

            console.log(`  ${statusIcon} ${chalk.bold.white(item.title)} ${chalk.gray(`[${item.id}]`)}${itemStats}`);

            if (item.summary && options.verbose) {
              console.log(chalk.gray(`    ${item.summary}`));
            }

            // Show criteria for this item
            if (item.criteria.length > 0) {
              for (const criterion of item.criteria) {
                const criterionStatus = criterion.passed
                  ? chalk.green('✓')
                  : chalk.red('✗');
                const criterionColor = criterion.passed ? chalk.white : chalk.gray;
                const criterionText = truncate(criterion.criterion, 52);

                console.log(`    ${criterionStatus} ${criterionColor(criterionText)}`);

                if (options.verbose) {
                  if (criterion.evidence) {
                    console.log(chalk.gray(`       Evidence: ${truncate(criterion.evidence, 60)}`));
                  }
                  if (criterion.notes) {
                    console.log(chalk.gray(`       Notes: ${truncate(criterion.notes, 60)}`));
                  }
                }
              }
            }
            console.log();
          }
        }

        // Global criteria
        if (evaluation.globalCriteria && evaluation.globalCriteria.length > 0) {
          console.log(chalk.bold.cyan('Global Success Criteria'));
          console.log();

          for (const criterion of evaluation.globalCriteria) {
            const criterionStatus = criterion.passed
              ? chalk.green('✓')
              : chalk.red('✗');
            const criterionColor = criterion.passed ? chalk.white : chalk.gray;

            console.log(`  ${criterionStatus} ${criterionColor(truncate(criterion.criterion, 55))}`);

            if (options.verbose) {
              if (criterion.evidence) {
                console.log(chalk.gray(`     Evidence: ${truncate(criterion.evidence, 60)}`));
              }
              if (criterion.notes) {
                console.log(chalk.gray(`     Notes: ${truncate(criterion.notes, 60)}`));
              }
            }
          }
          console.log();
        }
      }

      // Show issues found (if full review was run)
      if (!options.criteriaOnly && response.issuesFound !== undefined) {
        console.log(chalk.bold.cyan('Review Results'));

        if (response.issuesFound === 0) {
          console.log(`  ${chalk.green('✓')} No issues found`);
        } else {
          console.log(`  Issues found: ${chalk.yellow(response.issuesFound.toString())}`);
          console.log(`  Tasks created: ${chalk.white(response.tasksCreated?.toString() || '0')}`);

          if (response.issues && response.issues.length > 0 && options.verbose) {
            console.log();
            console.log(chalk.bold('  Issues:'));
            for (const issue of response.issues) {
              console.log(`    ${formatSeverity(issue.severity)} ${chalk.white(issue.title)}`);
              if (issue.description) {
                console.log(chalk.gray(`      ${truncate(issue.description, 65)}`));
              }
              if (issue.prdContext) {
                console.log(chalk.gray(`      PRD: ${issue.prdContext}`));
              }
            }
          }
        }

        if (response.reviewCycleId) {
          console.log(chalk.gray(`  Review cycle: ${response.reviewCycleId}`));
        }
        console.log();

        // Convergence status
        if (response.convergence) {
          const conv = response.convergence;
          console.log(chalk.bold.cyan('Convergence'));
          if (conv.is_converging) {
            console.log(`  ${chalk.green('✓')} Work is converging`);
          } else {
            console.log(`  ${chalk.gray('○')} Not yet converging`);
          }
          console.log(`  Clean reviews: ${chalk.white(conv.consecutive_zero_issues?.toString() || '0')}/2`);
          console.log(`  Total cycles: ${chalk.white(conv.total_cycles?.toString() || '0')}`);
          if (conv.trend) {
            console.log(`  Trend: ${chalk.white(conv.trend)}`);
          }
          console.log();
        }
      }

      // Final message
      if (response.message) {
        console.log(chalk.gray(response.message));
        console.log();
      }

    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        if (error.status === 404) {
          console.error(chalk.red('Error:'), `Outcome not found: ${outcomeId}`);
        } else {
          console.error(chalk.red('API Error:'), error.message);
        }
        process.exit(1);
      }
      throw error;
    }
  });

export default reviewCommand;
