/**
 * Self-Improvement Engine
 *
 * Analyzes completed interventions and bottlenecks to find patterns
 * and generate improvement suggestions.
 *
 * Pattern types:
 * - skill_gap: Same type of redirect/clarification needed repeatedly
 * - automation: Same type of task added manually multiple times
 * - process: Repeated pauses or errors in similar contexts
 */

import { getDb, now } from '../db';
import {
  createSuggestion,
  getPendingSuggestions,
  getBottleneckCountByType,
} from '../db/logs';
import type {
  Intervention,
  BottleneckLogEntry,
  ImprovementSuggestion,
  SuggestionType,
} from '../db/schema';

// ============================================================================
// Configuration
// ============================================================================

const PATTERN_THRESHOLD = 3; // Generate suggestion after this many occurrences
const ANALYSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================================
// Pattern Detection
// ============================================================================

interface PatternMatch {
  pattern_key: string;
  count: number;
  examples: string[];
  suggestion_type: SuggestionType;
  title: string;
  description: string;
}

/**
 * Extract a pattern key from intervention message
 * This normalizes messages to find similar ones
 */
function extractPatternKey(type: string, message: string): string {
  // Normalize the message: lowercase, remove numbers, extra spaces
  const normalized = message
    .toLowerCase()
    .replace(/\d+/g, 'N') // Replace numbers with N
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .trim()
    .slice(0, 100); // Limit length

  return `${type}:${normalized}`;
}

/**
 * Analyze recent interventions for patterns
 */
function analyzeInterventionPatterns(): PatternMatch[] {
  const db = getDb();
  const cutoff = now() - ANALYSIS_WINDOW_MS;

  // Get completed interventions from the analysis window
  const interventions = db.prepare(`
    SELECT type, message, created_at
    FROM interventions
    WHERE status = 'completed' AND created_at > ?
    ORDER BY created_at DESC
  `).all(cutoff) as Pick<Intervention, 'type' | 'message' | 'created_at'>[];

  // Group by pattern key
  const patterns = new Map<string, { count: number; examples: string[]; type: string }>();

  for (const intervention of interventions) {
    const key = extractPatternKey(intervention.type, intervention.message);
    const existing = patterns.get(key);

    if (existing) {
      existing.count++;
      if (existing.examples.length < 3) {
        existing.examples.push(intervention.message);
      }
    } else {
      patterns.set(key, {
        count: 1,
        examples: [intervention.message],
        type: intervention.type,
      });
    }
  }

  // Convert to PatternMatch objects for patterns meeting threshold
  const matches: PatternMatch[] = [];

  patterns.forEach((data, key) => {
    if (data.count >= PATTERN_THRESHOLD) {
      const suggestion = generateSuggestionFromPattern(key, data);
      if (suggestion) {
        matches.push(suggestion);
      }
    }
  });

  return matches;
}

/**
 * Generate a suggestion from a detected pattern
 */
function generateSuggestionFromPattern(
  key: string,
  data: { count: number; examples: string[]; type: string }
): PatternMatch | null {
  const { count, examples, type } = data;

  switch (type) {
    case 'add_task':
      return {
        pattern_key: key,
        count,
        examples,
        suggestion_type: 'automation',
        title: 'Recurring manual task',
        description: `You've manually added similar tasks ${count} times in the last week. Consider creating a skill or automation for this. Examples: "${examples[0]}"`,
      };

    case 'redirect':
      return {
        pattern_key: key,
        count,
        examples,
        suggestion_type: 'skill',
        title: 'Repeated redirect pattern',
        description: `Workers have needed similar redirects ${count} times. This might indicate a skill gap or unclear instructions. Example redirect: "${examples[0]}"`,
      };

    case 'pause':
      return {
        pattern_key: key,
        count,
        examples,
        suggestion_type: 'process',
        title: 'Frequent pauses',
        description: `Workers have been paused ${count} times for similar reasons. Consider reviewing the workflow. Example: "${examples[0]}"`,
      };

    default:
      return null;
  }
}

/**
 * Check if a suggestion already exists for this pattern
 */
function hasSuggestionForPattern(patternKey: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    SELECT 1 FROM improvement_suggestions
    WHERE description LIKE ? AND status = 'pending'
    LIMIT 1
  `).get(`%${patternKey.slice(0, 50)}%`);

  return result !== undefined;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Run the self-improvement analysis
 * Returns newly created suggestions
 */
export function runAnalysis(): ImprovementSuggestion[] {
  const patterns = analyzeInterventionPatterns();
  const newSuggestions: ImprovementSuggestion[] = [];

  for (const pattern of patterns) {
    // Check if we already have a pending suggestion for this
    if (!hasSuggestionForPattern(pattern.pattern_key)) {
      const suggestion = createSuggestion({
        type: pattern.suggestion_type,
        title: pattern.title,
        description: pattern.description,
        priority: pattern.count, // Higher count = higher priority
      });
      newSuggestions.push(suggestion);
    }
  }

  return newSuggestions;
}

/**
 * Get analysis summary
 */
export function getAnalysisSummary(): {
  interventions_analyzed: number;
  patterns_found: number;
  pending_suggestions: number;
  bottleneck_counts: Record<string, number>;
} {
  const db = getDb();
  const cutoff = now() - ANALYSIS_WINDOW_MS;

  // Count interventions in window
  const interventionCount = db.prepare(`
    SELECT COUNT(*) as count FROM interventions
    WHERE status = 'completed' AND created_at > ?
  `).get(cutoff) as { count: number };

  // Count patterns
  const patterns = analyzeInterventionPatterns();

  // Count pending suggestions
  const suggestions = getPendingSuggestions();

  // Get bottleneck counts
  const bottleneckCounts = getBottleneckCountByType();

  return {
    interventions_analyzed: interventionCount.count,
    patterns_found: patterns.length,
    pending_suggestions: suggestions.length,
    bottleneck_counts: bottleneckCounts,
  };
}

/**
 * Log intervention completion for pattern tracking
 * Called when an intervention is completed
 */
export function logInterventionCompletion(intervention: Intervention): void {
  // The intervention is already in the database with status='completed'
  // This function can be extended to do additional tracking if needed
  console.log(`[SelfImprovement] Logged intervention completion: ${intervention.type}`);
}

// ============================================================================
// Scheduled Analysis
// ============================================================================

let analysisInterval: NodeJS.Timeout | null = null;
let isRunning = false;

const ANALYSIS_INTERVAL_MS = 60 * 60 * 1000; // Run every hour

/**
 * Start periodic self-improvement analysis
 */
export function startSelfImprovement(): { success: boolean; message: string } {
  if (isRunning) {
    return { success: false, message: 'Self-improvement engine is already running' };
  }

  isRunning = true;

  // Run immediately
  runAnalysis();

  // Then run on interval
  analysisInterval = setInterval(() => {
    try {
      runAnalysis();
    } catch (err) {
      console.error('[SelfImprovement] Analysis error:', err);
    }
  }, ANALYSIS_INTERVAL_MS);

  console.log('[SelfImprovement] Started periodic analysis');
  return { success: true, message: 'Self-improvement engine started' };
}

/**
 * Stop periodic analysis
 */
export function stopSelfImprovement(): { success: boolean; message: string } {
  if (!isRunning || !analysisInterval) {
    return { success: false, message: 'Self-improvement engine is not running' };
  }

  clearInterval(analysisInterval);
  analysisInterval = null;
  isRunning = false;

  console.log('[SelfImprovement] Stopped periodic analysis');
  return { success: true, message: 'Self-improvement engine stopped' };
}

/**
 * Get engine status
 */
export function getSelfImprovementStatus(): { running: boolean; analysisIntervalMs: number } {
  return {
    running: isRunning,
    analysisIntervalMs: ANALYSIS_INTERVAL_MS,
  };
}
