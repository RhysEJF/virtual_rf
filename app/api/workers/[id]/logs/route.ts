/**
 * Worker Logs API Route
 *
 * GET /api/workers/[id]/logs - Get progress entries for worker
 *
 * Query params:
 *   - limit: number - Max entries to return (default 50)
 *   - since: timestamp - Filter entries after this time
 *   - verbosity: 0-3 - Level of detail to include
 *     0: Current behavior (content + 200-char preview)
 *     1: Add HOMЯ quality summary (score, on-track)
 *     2: Add discoveries, drift, issues
 *     3: Add full Claude output
 *   - iteration: number | 'latest' - Filter to specific iteration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkerById } from '@/lib/db/workers';
import { getRecentProgress, getProgressEntriesByWorker } from '@/lib/db/progress';
import { getObservationsByTask, parseObservation } from '@/lib/db/homr';
import { getTaskById } from '@/lib/db/tasks';
import type { ProgressEntry } from '@/lib/db/schema';

// Enriched entry type with optional observation data
interface EnrichedProgressEntry extends ProgressEntry {
  taskTitle?: string;
  observation?: {
    quality: string;
    alignmentScore: number;
    onTrack: boolean;
    // Verbosity >= 2
    discoveries?: Array<{ type: string; content: string }>;
    drift?: Array<{ type: string; description: string; severity: string }>;
    issues?: Array<{ type: string; description: string; severity: string }>;
    hasAmbiguity?: boolean;
    ambiguityData?: { type: string; description: string } | null;
  } | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: workerId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const since = searchParams.get('since');
    const verbosity = parseInt(searchParams.get('verbosity') || '0', 10);
    const iterationParam = searchParams.get('iteration');

    // Validate worker exists
    const worker = getWorkerById(workerId);
    if (!worker) {
      return NextResponse.json(
        { error: 'Worker not found' },
        { status: 404 }
      );
    }

    // Get progress entries
    let entries = getRecentProgress(workerId, limit);

    // Filter by timestamp if provided
    if (since) {
      const sinceTimestamp = parseInt(since, 10);
      entries = entries.filter(e => e.created_at > sinceTimestamp);
    }

    // Filter by iteration if provided
    if (iterationParam) {
      if (iterationParam === 'latest') {
        // Get the most recent entry
        entries = entries.slice(-1);
      } else {
        const iterNum = parseInt(iterationParam, 10);
        if (!isNaN(iterNum)) {
          entries = entries.filter(e => e.iteration === iterNum);
        }
      }
    }

    // Enrich entries based on verbosity level
    const enrichedEntries: EnrichedProgressEntry[] = entries.map(entry => {
      const enriched: EnrichedProgressEntry = {
        ...entry,
      };

      // Get task title if we have a task_id
      if (entry.task_id) {
        const task = getTaskById(entry.task_id);
        if (task) {
          enriched.taskTitle = task.title;
        }
      }

      // Add HOMЯ observation data based on verbosity level
      if (verbosity >= 1 && entry.task_id) {
        const observations = getObservationsByTask(entry.task_id);
        if (observations.length > 0) {
          const latestObs = observations[0]; // Most recent
          const parsed = parseObservation(latestObs);

          enriched.observation = {
            quality: parsed.quality,
            alignmentScore: parsed.alignmentScore,
            onTrack: parsed.onTrack,
          };

          // Verbosity >= 2: Add details
          if (verbosity >= 2) {
            enriched.observation.discoveries = parsed.discoveries.map(d => ({
              type: d.type,
              content: d.content,
            }));
            enriched.observation.drift = parsed.drift.map(d => ({
              type: d.type,
              description: d.description,
              severity: d.severity,
            }));
            enriched.observation.issues = parsed.issues.map(i => ({
              type: i.type,
              description: i.description,
              severity: i.severity,
            }));
            enriched.observation.hasAmbiguity = parsed.hasAmbiguity;
            enriched.observation.ambiguityData = parsed.ambiguityData ? {
              type: parsed.ambiguityData.type,
              description: parsed.ambiguityData.description,
            } : null;
          }
        } else {
          enriched.observation = null;
        }
      }

      // Verbosity < 3: Truncate full_output if present
      if (verbosity < 3 && enriched.full_output) {
        // Just provide a preview indicator, don't include the full output
        const outputLength = enriched.full_output.length;
        enriched.full_output = enriched.full_output.slice(0, 200) +
          (outputLength > 200 ? `... (${outputLength - 200} more chars)` : '');
      }

      return enriched;
    });

    return NextResponse.json({
      entries: enrichedEntries,
      worker_id: workerId,
      outcome_id: worker.outcome_id,
      verbosity,
    });
  } catch (error) {
    console.error('Error fetching worker logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
