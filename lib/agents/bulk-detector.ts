/**
 * Bulk Data Pattern Detector
 *
 * Proactively detects tasks that involve bulk data operations during the planning phase,
 * allowing the system to decompose them BEFORE workers attempt execution. This prevents
 * turn limit exhaustion on tasks that are inherently too large for a single worker.
 *
 * Detection patterns:
 * - Quantity keywords: "all", "every", "100+", "multiple", etc.
 * - Collection references: "list of", "batch of", "set of", etc.
 * - Iterative language: "for each", "iterate over", "process all", etc.
 * - Scale indicators: numbers > 10, "bulk", "mass", etc.
 *
 * Part of the self-improvement outcome addressing "bulk_data_tasks_underscoped" pattern.
 */

import type { Task, Intent, Approach } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface BulkDetectionResult {
  isBulkTask: boolean;
  confidence: 'high' | 'medium' | 'low';
  estimatedItemCount: number | null;
  detectedPatterns: DetectedPattern[];
  suggestedDecomposition: DecompositionSuggestion | null;
  reasoning: string;
}

export interface DetectedPattern {
  type: BulkPatternType;
  match: string;
  context: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export type BulkPatternType =
  | 'explicit_quantity'
  | 'collection_reference'
  | 'iterative_language'
  | 'scale_indicator'
  | 'plural_target'
  | 'batch_operation';

export interface DecompositionSuggestion {
  strategy: 'per_item' | 'chunk' | 'category' | 'phase';
  estimatedSubtaskCount: number;
  reasoning: string;
}

export interface BulkDetectionContext {
  task: Task;
  outcomeIntent?: Intent | null;
  outcomeApproach?: Approach | null;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

interface PatternDefinition {
  type: BulkPatternType;
  patterns: RegExp[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  extractCount?: (match: RegExpMatchArray) => number | null;
}

const BULK_PATTERNS: PatternDefinition[] = [
  // Explicit quantity patterns - highest severity
  {
    type: 'explicit_quantity',
    patterns: [
      /(\d{2,})\s*(items?|files?|records?|entries?|rows?|users?|pages?|endpoints?|tests?|components?|apis?)/gi,
      /(?:more\s+than|over|at\s+least|approximately|around|about)\s*(\d+)/gi,
      /(\d+)\s*(?:or\s+more|plus|\+)/gi,
      /process(?:ing)?\s+(\d+)/gi,
      /handle\s+(\d+)/gi,
    ],
    severity: 'critical',
    extractCount: (match: RegExpMatchArray): number | null => {
      const numMatch = match[1];
      if (numMatch) {
        const num = parseInt(numMatch, 10);
        return isNaN(num) ? null : num;
      }
      return null;
    },
  },

  // Collection reference patterns - high severity
  {
    type: 'collection_reference',
    patterns: [
      /(?:a\s+)?(?:list|array|set|collection|batch|group)\s+of\s+\w+/gi,
      /multiple\s+\w+/gi,
      /various\s+\w+/gi,
      /several\s+\w+/gi,
      /numerous\s+\w+/gi,
      /many\s+\w+/gi,
    ],
    severity: 'high',
  },

  // Iterative language patterns - high severity
  {
    type: 'iterative_language',
    patterns: [
      /for\s+each\s+\w+/gi,
      /iterate\s+(?:over|through)\s+/gi,
      /loop\s+(?:through|over)\s+/gi,
      /process\s+(?:all|each|every)\s+/gi,
      /handle\s+(?:all|each|every)\s+/gi,
      /(?:create|build|generate)\s+(?:all|each|every)\s+/gi,
      /(?:update|modify|change)\s+(?:all|each|every)\s+/gi,
      /(?:delete|remove)\s+(?:all|each|every)\s+/gi,
    ],
    severity: 'high',
  },

  // Scale indicator patterns - medium severity
  {
    type: 'scale_indicator',
    patterns: [
      /bulk\s+\w+/gi,
      /mass\s+\w+/gi,
      /large[- ]scale\s+/gi,
      /at\s+scale/gi,
      /across\s+(?:all|the|entire)/gi,
      /throughout\s+(?:all|the)/gi,
      /enterprise[- ]wide/gi,
      /system[- ]wide/gi,
      /org(?:anization)?[- ]wide/gi,
    ],
    severity: 'medium',
  },

  // Plural target patterns - medium severity
  {
    type: 'plural_target',
    patterns: [
      /all\s+(?:the\s+)?\w+s(?:\s|$|,|\.)/gi,
      /every\s+\w+/gi,
      /any\s+\w+s(?:\s|$|,|\.)/gi,
    ],
    severity: 'medium',
  },

  // Batch operation patterns - high severity
  {
    type: 'batch_operation',
    patterns: [
      /batch\s+(?:process|import|export|update|delete|create)/gi,
      /(?:import|export|migrate)\s+(?:all|multiple|data)/gi,
      /seed(?:ing)?\s+(?:data|database)/gi,
      /populate\s+(?:database|table|collection)/gi,
      /migration\s+(?:script|task|job)/gi,
      /data\s+(?:migration|import|export|sync)/gi,
    ],
    severity: 'high',
  },
];

// Threshold for bulk task classification
const BULK_THRESHOLD = {
  minPatterns: 1,          // At least 1 pattern match
  minHighSeverity: 1,      // At least 1 high/critical pattern for high confidence
  itemCountThreshold: 10,  // Explicit counts >= 10 trigger bulk classification
};

// ============================================================================
// Core Detection Function
// ============================================================================

/**
 * Detect whether a task involves bulk data operations that should be
 * proactively decomposed during the planning phase.
 *
 * @param context - Task and optional outcome context
 * @returns Detection result with patterns found and decomposition suggestion
 */
export function detectBulkDataTask(context: BulkDetectionContext): BulkDetectionResult {
  const { task, outcomeIntent, outcomeApproach } = context;

  // Combine all text sources for analysis
  const textSources = [
    task.title,
    task.description || '',
    task.prd_context || '',
    task.design_context || '',
    task.task_intent || '',
    task.task_approach || '',
  ];

  // Add outcome context if available
  if (outcomeIntent) {
    textSources.push(outcomeIntent.summary || '');
    if (outcomeIntent.success_criteria) {
      textSources.push(outcomeIntent.success_criteria.join(' '));
    }
  }

  if (outcomeApproach) {
    textSources.push(outcomeApproach.architecture || '');
    if (outcomeApproach.technologies) {
      textSources.push(outcomeApproach.technologies.join(' '));
    }
  }

  const combinedText = textSources.join(' ');

  // Detect patterns
  const detectedPatterns: DetectedPattern[] = [];
  let maxExtractedCount: number | null = null;

  for (const definition of BULK_PATTERNS) {
    for (const pattern of definition.patterns) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(combinedText)) !== null) {
        const matchStart = Math.max(0, match.index - 30);
        const matchEnd = Math.min(combinedText.length, match.index + match[0].length + 30);
        const context = combinedText.slice(matchStart, matchEnd).trim();

        detectedPatterns.push({
          type: definition.type,
          match: match[0],
          context: `...${context}...`,
          severity: definition.severity,
        });

        // Extract count if applicable
        if (definition.extractCount) {
          const count = definition.extractCount(match);
          if (count !== null && (maxExtractedCount === null || count > maxExtractedCount)) {
            maxExtractedCount = count;
          }
        }
      }
    }
  }

  // Calculate confidence based on pattern matches
  const criticalCount = detectedPatterns.filter(p => p.severity === 'critical').length;
  const highCount = detectedPatterns.filter(p => p.severity === 'high').length;
  const mediumCount = detectedPatterns.filter(p => p.severity === 'medium').length;

  let confidence: 'high' | 'medium' | 'low' = 'low';
  let isBulkTask = false;

  // Determine if this is a bulk task
  if (detectedPatterns.length >= BULK_THRESHOLD.minPatterns) {
    if (criticalCount > 0 || (maxExtractedCount !== null && maxExtractedCount >= BULK_THRESHOLD.itemCountThreshold)) {
      confidence = 'high';
      isBulkTask = true;
    } else if (highCount >= BULK_THRESHOLD.minHighSeverity) {
      confidence = 'high';
      isBulkTask = true;
    } else if (mediumCount >= 2 || highCount >= 1) {
      confidence = 'medium';
      isBulkTask = true;
    } else if (detectedPatterns.length >= 2) {
      confidence = 'low';
      isBulkTask = true;
    }
  }

  // Build reasoning
  const reasoning = buildReasoning(detectedPatterns, maxExtractedCount, isBulkTask);

  // Suggest decomposition strategy if bulk task detected
  const suggestedDecomposition = isBulkTask
    ? suggestDecompositionStrategy(detectedPatterns, maxExtractedCount)
    : null;

  return {
    isBulkTask,
    confidence,
    estimatedItemCount: maxExtractedCount,
    detectedPatterns,
    suggestedDecomposition,
    reasoning,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildReasoning(
  patterns: DetectedPattern[],
  extractedCount: number | null,
  isBulk: boolean
): string {
  if (patterns.length === 0) {
    return 'No bulk data patterns detected. Task appears to be single-item or small-scope.';
  }

  const patternTypes = Array.from(new Set(patterns.map(p => p.type)));
  const severityCounts = {
    critical: patterns.filter(p => p.severity === 'critical').length,
    high: patterns.filter(p => p.severity === 'high').length,
    medium: patterns.filter(p => p.severity === 'medium').length,
    low: patterns.filter(p => p.severity === 'low').length,
  };

  let reasoning = `Detected ${patterns.length} bulk data pattern(s): `;
  reasoning += patternTypes.map(t => formatPatternType(t)).join(', ');
  reasoning += '. ';

  if (extractedCount !== null) {
    reasoning += `Explicit item count found: ${extractedCount}. `;
  }

  if (severityCounts.critical > 0) {
    reasoning += `Critical severity indicators present (${severityCounts.critical}). `;
  }

  if (isBulk) {
    reasoning += 'Task is classified as bulk operation and should be decomposed before execution.';
  } else {
    reasoning += 'Pattern matches are below threshold for bulk classification.';
  }

  return reasoning;
}

function formatPatternType(type: BulkPatternType): string {
  const typeLabels: Record<BulkPatternType, string> = {
    explicit_quantity: 'explicit quantity',
    collection_reference: 'collection reference',
    iterative_language: 'iterative language',
    scale_indicator: 'scale indicator',
    plural_target: 'plural target',
    batch_operation: 'batch operation',
  };
  return typeLabels[type] || type;
}

function suggestDecompositionStrategy(
  patterns: DetectedPattern[],
  extractedCount: number | null
): DecompositionSuggestion {
  // Determine best decomposition strategy based on patterns

  const hasBatchOp = patterns.some(p => p.type === 'batch_operation');
  const hasIterative = patterns.some(p => p.type === 'iterative_language');
  const hasCollection = patterns.some(p => p.type === 'collection_reference');

  // If we have an explicit count, use per-item or chunk strategy
  if (extractedCount !== null && extractedCount > 0) {
    if (extractedCount <= 20) {
      // Small count - can do per-item
      return {
        strategy: 'per_item',
        estimatedSubtaskCount: Math.min(extractedCount, 6), // Cap at 6 subtasks
        reasoning: `With ${extractedCount} items, each can be handled as a separate subtask.`,
      };
    } else {
      // Large count - use chunking
      const chunkSize = Math.ceil(extractedCount / 4);
      return {
        strategy: 'chunk',
        estimatedSubtaskCount: Math.min(Math.ceil(extractedCount / chunkSize), 6),
        reasoning: `With ${extractedCount} items, chunk into batches of ~${chunkSize} for parallel processing.`,
      };
    }
  }

  // For batch operations, suggest phase-based decomposition
  if (hasBatchOp) {
    return {
      strategy: 'phase',
      estimatedSubtaskCount: 4,
      reasoning: 'Batch operation should be split into phases: prepare, validate, execute, verify.',
    };
  }

  // For iterative tasks, suggest category-based decomposition
  if (hasIterative || hasCollection) {
    return {
      strategy: 'category',
      estimatedSubtaskCount: 4,
      reasoning: 'Group items by category or type and process each group separately.',
    };
  }

  // Default to phase-based
  return {
    strategy: 'phase',
    estimatedSubtaskCount: 3,
    reasoning: 'Split bulk operation into preparation, execution, and verification phases.',
  };
}

// ============================================================================
// Batch Detection
// ============================================================================

/**
 * Detect bulk patterns in multiple tasks.
 * Useful for scanning all tasks in an outcome during planning.
 *
 * @param tasks - Array of tasks to analyze
 * @param outcomeIntent - Optional outcome intent for additional context
 * @param outcomeApproach - Optional outcome approach for additional context
 * @returns Map of task ID to detection result
 */
export function detectBulkTasksBatch(
  tasks: Task[],
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null
): Map<string, BulkDetectionResult> {
  const results = new Map<string, BulkDetectionResult>();

  for (const task of tasks) {
    const result = detectBulkDataTask({
      task,
      outcomeIntent,
      outcomeApproach,
    });
    results.set(task.id, result);
  }

  return results;
}

/**
 * Filter tasks that are detected as bulk operations.
 *
 * @param tasks - Array of tasks to filter
 * @param minConfidence - Minimum confidence level for inclusion
 * @param outcomeIntent - Optional outcome intent for additional context
 * @param outcomeApproach - Optional outcome approach for additional context
 * @returns Array of tasks that are bulk operations
 */
export function filterBulkTasks(
  tasks: Task[],
  minConfidence: 'high' | 'medium' | 'low' = 'medium',
  outcomeIntent?: Intent | null,
  outcomeApproach?: Approach | null
): { task: Task; detection: BulkDetectionResult }[] {
  const confidenceOrder = { high: 3, medium: 2, low: 1 };
  const minConfidenceValue = confidenceOrder[minConfidence];

  const results: { task: Task; detection: BulkDetectionResult }[] = [];

  for (const task of tasks) {
    const detection = detectBulkDataTask({
      task,
      outcomeIntent,
      outcomeApproach,
    });

    if (detection.isBulkTask && confidenceOrder[detection.confidence] >= minConfidenceValue) {
      results.push({ task, detection });
    }
  }

  return results;
}

// ============================================================================
// Quick Check Function
// ============================================================================

/**
 * Quick check if text contains bulk data indicators.
 * Lighter weight than full detection for pre-filtering.
 *
 * @param text - Text to check
 * @returns True if bulk indicators are present
 */
export function hasBulkIndicators(text: string): boolean {
  const quickPatterns = [
    /\b(?:all|every|each)\s+\w+s\b/i,
    /\b\d{2,}\s*\w+s?\b/i,
    /\b(?:bulk|batch|mass)\b/i,
    /\bfor\s+each\b/i,
    /\b(?:multiple|many|several|numerous)\s+\w+/i,
    /\bprocess(?:ing)?\s+(?:all|every)\b/i,
  ];

  return quickPatterns.some(pattern => pattern.test(text));
}
