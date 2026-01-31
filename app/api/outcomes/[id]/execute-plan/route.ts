/**
 * Execute Plan API - Apply approved actions to an outcome
 *
 * POST /api/outcomes/[id]/execute-plan
 * Body: { actions: SuggestedAction[], originalInput: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, updateOutcome, getDesignDoc, upsertDesignDoc, hasChildren } from '@/lib/db/outcomes';
import { createTask } from '@/lib/db/tasks';
import { getWorkersByOutcome } from '@/lib/db/workers';
import { startRalphWorker, stopAllWorkersForOutcome } from '@/lib/ralph/worker';
import type { Worker } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface SuggestedAction {
  id: string;
  type: 'update_intent' | 'update_approach' | 'create_tasks' | 'build_capabilities' | 'start_worker' | 'pause_workers' | 'run_review';
  description: string;
  details: string;
  data?: Record<string, unknown>;
  enabled: boolean;
}

interface ExecutionResult {
  actionId: string;
  success: boolean;
  message: string;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await context.params;
    const { actions, originalInput } = await request.json();

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No actions provided' },
        { status: 400 }
      );
    }

    // Get outcome
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { success: false, error: 'Outcome not found' },
        { status: 404 }
      );
    }

    const results: ExecutionResult[] = [];

    // Execute each action
    for (const action of actions as SuggestedAction[]) {
      if (!action.enabled) continue;

      try {
        switch (action.type) {
          case 'update_intent': {
            const data = action.data || {};

            // Define intent structure
            interface IntentItem { id: string; title: string; status: string }
            interface Intent { summary: string; items: IntentItem[]; success_criteria: string[] }

            // Get existing intent
            let currentIntent: Intent = { summary: '', items: [], success_criteria: [] };
            if (outcome.intent) {
              try {
                currentIntent = JSON.parse(outcome.intent) as Intent;
              } catch {
                // Start fresh
              }
            }

            // Apply updates
            if (data.new_summary) {
              currentIntent.summary = data.new_summary as string;
            }
            if (data.new_items && Array.isArray(data.new_items)) {
              // Merge new items
              const existingIds = new Set(currentIntent.items.map((i) => i.id));
              for (const item of data.new_items as { id: string; title: string; status?: string }[]) {
                if (!existingIds.has(item.id)) {
                  currentIntent.items.push({
                    id: item.id || `item_${Date.now()}`,
                    title: item.title,
                    status: item.status || 'pending',
                  });
                }
              }
            }
            if (data.new_success_criteria && Array.isArray(data.new_success_criteria)) {
              // Merge success criteria
              const existingCriteria = new Set(currentIntent.success_criteria);
              for (const criterion of data.new_success_criteria as string[]) {
                if (!existingCriteria.has(criterion)) {
                  currentIntent.success_criteria.push(criterion);
                }
              }
            }

            updateOutcome(outcomeId, { intent: JSON.stringify(currentIntent) });

            // Reset capability_ready when intent changes significantly - new requirements may need different skills
            // Only reset if summary or success criteria changed (not just item status updates)
            if (data.new_summary || data.new_success_criteria) {
              updateOutcome(outcomeId, { capability_ready: 0 });
            }

            results.push({
              actionId: action.id,
              success: true,
              message: (data.new_summary || data.new_success_criteria)
                ? 'Intent updated (capabilities will be re-evaluated)'
                : 'Intent updated',
            });
            break;
          }

          case 'update_approach': {
            const data = action.data || {};

            // Get existing design doc
            const existingDoc = getDesignDoc(outcomeId);
            const currentVersion = existingDoc?.version || 0;
            const currentApproach = existingDoc?.approach || '';

            if (data.new_approach) {
              const newApproach = data.new_approach as string;
              upsertDesignDoc(outcomeId, newApproach, currentVersion + 1);

              // Reset capability_ready when approach changes - new approach may need different skills
              // This forces the system to re-evaluate capability needs before next worker run
              updateOutcome(outcomeId, { capability_ready: 0 });
            }

            results.push({
              actionId: action.id,
              success: true,
              message: 'Approach updated (capabilities will be re-evaluated)',
            });
            break;
          }

          case 'create_tasks': {
            const data = action.data || {};
            const tasksToCreate = (data.tasks || []) as { title: string; description?: string; priority?: number; depends_on?: string[] }[];

            let created = 0;
            for (const taskData of tasksToCreate) {
              const newTask = createTask({
                outcome_id: outcomeId,
                title: taskData.title,
                description: taskData.description || '',
                priority: taskData.priority || 2,
                from_review: false,
                depends_on: taskData.depends_on,
              });
              if (newTask) created++;
            }

            results.push({
              actionId: action.id,
              success: true,
              message: `Created ${created} task${created !== 1 ? 's' : ''}`,
            });
            break;
          }

          case 'build_capabilities': {
            // Trigger capability building (skills/tools) before execution
            const data = action.data || {};
            const skillNames = (data.skill_names || []) as string[];

            try {
              // Start orchestrated execution which builds capabilities first
              const orchResponse = await fetch(
                `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/outcomes/${outcomeId}/orchestrate`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    async: true,
                    suggestedSkills: skillNames,
                  }),
                }
              );
              const orchData = await orchResponse.json();

              if (orchData.success) {
                results.push({
                  actionId: action.id,
                  success: true,
                  message: skillNames.length > 0
                    ? `Building capabilities with skills: ${skillNames.join(', ')}`
                    : 'Building capabilities (analyzing what skills are needed)',
                });
              } else {
                results.push({
                  actionId: action.id,
                  success: false,
                  message: orchData.error || 'Failed to start capability build',
                });
              }
            } catch (orchError) {
              results.push({
                actionId: action.id,
                success: false,
                message: 'Failed to trigger capability build',
              });
            }
            break;
          }

          case 'start_worker': {
            // Only leaf outcomes can have workers
            if (hasChildren(outcomeId)) {
              results.push({
                actionId: action.id,
                success: false,
                message: 'Cannot start workers on parent outcomes',
              });
              break;
            }

            // Check if there's already a running worker
            const workers = getWorkersByOutcome(outcomeId);
            const hasRunning = workers.some((w: Worker) => w.status === 'running');

            if (hasRunning) {
              results.push({
                actionId: action.id,
                success: false,
                message: 'Worker already running',
              });
            } else {
              const worker = await startRalphWorker({ outcomeId });
              if (worker.started) {
                results.push({
                  actionId: action.id,
                  success: true,
                  message: `Worker ${worker.workerId} started`,
                });
              } else {
                results.push({
                  actionId: action.id,
                  success: false,
                  message: worker.error || 'Failed to start worker',
                });
              }
            }
            break;
          }

          case 'pause_workers': {
            const stopped = stopAllWorkersForOutcome(outcomeId);
            results.push({
              actionId: action.id,
              success: true,
              message: stopped > 0 ? `Paused ${stopped} worker${stopped !== 1 ? 's' : ''}` : 'No running workers to pause',
            });
            break;
          }

          case 'run_review': {
            // Trigger review by calling the review endpoint
            try {
              const reviewResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/outcomes/${outcomeId}/review`, {
                method: 'POST',
              });
              const reviewData = await reviewResponse.json();

              results.push({
                actionId: action.id,
                success: reviewData.success,
                message: reviewData.success ? 'Review started' : reviewData.error || 'Review failed',
              });
            } catch (reviewError) {
              results.push({
                actionId: action.id,
                success: false,
                message: 'Failed to trigger review',
              });
            }
            break;
          }

          default:
            results.push({
              actionId: action.id,
              success: false,
              message: `Unknown action type: ${action.type}`,
            });
        }
      } catch (actionError) {
        console.error(`[Execute Plan] Error executing action ${action.id}:`, actionError);
        results.push({
          actionId: action.id,
          success: false,
          message: `Error: ${actionError instanceof Error ? actionError.message : 'Unknown error'}`,
        });
      }
    }

    // Summarize results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    let message = '';
    if (failCount === 0) {
      message = `All ${successCount} action${successCount !== 1 ? 's' : ''} completed successfully`;
    } else if (successCount === 0) {
      message = `All ${failCount} action${failCount !== 1 ? 's' : ''} failed`;
    } else {
      message = `${successCount} succeeded, ${failCount} failed`;
    }

    return NextResponse.json({
      success: failCount === 0,
      message,
      results,
      originalInput,
    });

  } catch (error) {
    console.error('[Execute Plan API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to execute plan' },
      { status: 500 }
    );
  }
}
