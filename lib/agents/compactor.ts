/**
 * Progress Compactor Agent
 *
 * Compacts older progress entries into summaries to manage context size.
 * Uses Claude CLI to generate intelligent summaries.
 */

import { claudeComplete } from '../claude/client';
import {
  needsCompaction,
  getEntriesForCompaction,
  createCompactionSummary,
  markEntriesCompacted,
  getProgressStats,
} from '../db/progress';
import { getWorkerById } from '../db/workers';

export interface CompactionResult {
  success: boolean;
  workerId: string;
  entriesCompacted: number;
  summaryId?: number;
  error?: string;
}

/**
 * Run compaction for a worker if needed.
 * Returns information about what was compacted.
 */
export async function compactWorkerProgress(workerId: string): Promise<CompactionResult> {
  try {
    // Check if compaction is needed
    if (!needsCompaction(workerId)) {
      return {
        success: true,
        workerId,
        entriesCompacted: 0,
      };
    }

    // Get worker info
    const worker = getWorkerById(workerId);
    if (!worker) {
      return {
        success: false,
        workerId,
        entriesCompacted: 0,
        error: 'Worker not found',
      };
    }

    // Get entries to compact
    const entries = getEntriesForCompaction(workerId);
    if (entries.length === 0) {
      return {
        success: true,
        workerId,
        entriesCompacted: 0,
      };
    }

    // Prepare content for summarization
    const entriesText = entries
      .map(e => `### Iteration ${e.iteration}\n${e.content}`)
      .join('\n\n');

    // Generate summary using Claude
    const prompt = `You are summarizing progress entries from an AI worker.
These entries describe what the worker did during iterations ${entries[0].iteration} to ${entries[entries.length - 1].iteration}.

Summarize these entries into a concise summary that:
1. Captures the key accomplishments
2. Notes any blockers or failures
3. Highlights important decisions made
4. Is suitable for injecting into future context

Progress entries to summarize:
${entriesText}

Write a concise summary (2-4 paragraphs):`;

    const result = await claudeComplete({
      prompt,
      timeout: 60000, // 1 minute for summarization
      maxTurns: 1,
    });

    if (!result.success || !result.text) {
      return {
        success: false,
        workerId,
        entriesCompacted: 0,
        error: result.error || 'Failed to generate summary',
      };
    }

    // Create the summary entry
    const iterationRange = {
      from: entries[0].iteration,
      to: entries[entries.length - 1].iteration,
    };

    const summaryEntry = createCompactionSummary(
      worker.outcome_id,
      workerId,
      iterationRange,
      result.text
    );

    // Mark original entries as compacted
    markEntriesCompacted(
      entries.map(e => e.id),
      summaryEntry.id
    );

    return {
      success: true,
      workerId,
      entriesCompacted: entries.length,
      summaryId: summaryEntry.id,
    };
  } catch (error) {
    return {
      success: false,
      workerId,
      entriesCompacted: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Run compaction check for all active workers.
 * Call this periodically (e.g., every few minutes).
 */
export async function runCompactionCycle(): Promise<{
  checked: number;
  compacted: number;
  errors: string[];
}> {
  const { getActiveWorkers } = await import('../db/workers');
  const workers = getActiveWorkers();

  const results = {
    checked: workers.length,
    compacted: 0,
    errors: [] as string[],
  };

  for (const worker of workers) {
    const result = await compactWorkerProgress(worker.id);
    if (result.entriesCompacted > 0) {
      results.compacted += result.entriesCompacted;
    }
    if (!result.success && result.error) {
      results.errors.push(`${worker.id}: ${result.error}`);
    }
  }

  return results;
}

/**
 * Get compaction status for a worker.
 */
export function getCompactionStatus(workerId: string): {
  needsCompaction: boolean;
  stats: {
    total: number;
    compacted: number;
    uncompacted: number;
  };
} {
  return {
    needsCompaction: needsCompaction(workerId),
    stats: getProgressStats(workerId),
  };
}
