/**
 * Capabilities Replan API
 *
 * POST: Reset capability_ready=0, run capability planner, create tasks,
 *       and return the detected capabilities with their task IDs.
 *
 * This enables dynamic capability planning - users can add/modify skills
 * and tools at any point in an outcome's lifecycle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById, updateOutcome, getDesignDoc } from '@/lib/db/outcomes';
import { getTasksByOutcome } from '@/lib/db/tasks';
import {
  analyzeApproachForCapabilities,
  createCapabilityTasks,
  detectNewCapabilityNeeds,
  type CapabilityNeed,
  type ExistingCapability,
} from '@/lib/agents/capability-planner';
import type { Intent } from '@/lib/db/schema';

interface CapabilityWithTask extends CapabilityNeed {
  taskId: string;
}

interface ReplanResponse {
  success: boolean;
  outcomeId: string;
  message: string;
  previousCapabilityReady: number;
  newCapabilityReady: number;
  capabilities: CapabilityWithTask[];
  totalNewCapabilities: number;
  existingCapabilities: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<ReplanResponse | { error: string }>> {
  try {
    const { id: outcomeId } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Get design doc (approach)
    const designDoc = getDesignDoc(outcomeId);
    if (!designDoc || !designDoc.approach) {
      return NextResponse.json(
        { error: 'No approach (design doc) found for this outcome. Create an approach first.' },
        { status: 400 }
      );
    }

    // Parse intent if available
    let intent: Intent | null = null;
    if (outcome.intent) {
      try {
        intent = JSON.parse(outcome.intent) as Intent;
      } catch {
        // Intent parsing failed, continue without it
      }
    }

    // Get existing capability tasks to avoid duplicates
    const existingTasks = getTasksByOutcome(outcomeId);
    const existingCapabilities: ExistingCapability[] = existingTasks
      .filter(t => t.phase === 'capability' && t.capability_type)
      .map(t => {
        // Extract path from task description or prd_context
        let path = '';
        if (t.prd_context) {
          try {
            const ctx = JSON.parse(t.prd_context);
            path = ctx.path || '';
          } catch {
            // Parse failed
          }
        }
        return {
          type: t.capability_type!,
          name: t.title.replace('[Capability] Build skill: ', '').replace('[Capability] Build tool: ', ''),
          path,
        };
      });

    // Store previous capability_ready state
    const previousCapabilityReady = outcome.capability_ready;

    // Parse body for options (optional)
    const body = await request.json().catch(() => ({}));
    const { detectOnlyNew = true } = body;

    let capabilityNeeds: CapabilityNeed[];

    if (detectOnlyNew && existingCapabilities.length > 0) {
      // Detect only NEW capabilities not already in the task list
      capabilityNeeds = detectNewCapabilityNeeds(
        designDoc.approach,
        existingCapabilities
      );
    } else {
      // Full analysis - may include already-known capabilities
      const plan = await analyzeApproachForCapabilities(
        designDoc.approach,
        intent,
        outcomeId
      );
      capabilityNeeds = plan.needs;
    }

    // If no new capabilities found
    if (capabilityNeeds.length === 0) {
      return NextResponse.json({
        success: true,
        outcomeId,
        message: 'No new capabilities detected in approach',
        previousCapabilityReady,
        newCapabilityReady: outcome.capability_ready,
        capabilities: [],
        totalNewCapabilities: 0,
        existingCapabilities: existingCapabilities.length,
      });
    }

    // Reset capability_ready to 0 (not started) before creating tasks
    updateOutcome(outcomeId, { capability_ready: 0 });

    // Create capability tasks
    const createdTasks = createCapabilityTasks(outcomeId, {
      needs: capabilityNeeds,
      parallel: true,
      hasCapabilities: true,
    });

    // Map capabilities with their task IDs
    const capabilitiesWithTasks: CapabilityWithTask[] = capabilityNeeds.map((need, index) => ({
      ...need,
      taskId: createdTasks[index]?.id || '',
    }));

    return NextResponse.json({
      success: true,
      outcomeId,
      message: `Created ${createdTasks.length} new capability task(s)`,
      previousCapabilityReady,
      newCapabilityReady: 0,
      capabilities: capabilitiesWithTasks,
      totalNewCapabilities: createdTasks.length,
      existingCapabilities: existingCapabilities.length,
    });
  } catch (error) {
    console.error('[Capabilities Replan API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to replan capabilities' },
      { status: 500 }
    );
  }
}
