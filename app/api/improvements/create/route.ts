/**
 * Improvements Create API
 *
 * POST /api/improvements/create - Create improvement outcomes from escalation clusters
 *
 * This endpoint:
 * 1. Accepts selected cluster IDs (trigger_types) from escalation analysis
 * 2. Finds or creates a "Self-Improvement" parent outcome
 * 3. Creates fully-populated child outcomes with intent, approach, and tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  createOutcome,
  getOutcomeById,
  getAllOutcomes,
  upsertDesignDoc,
} from '@/lib/db/outcomes';
import { createTasksBatch } from '@/lib/db/tasks';
import { markEscalationsByTriggerTypeAsIncorporated } from '@/lib/db/homr';
import { logImprovementCreated } from '@/lib/db/activity';
import type { HomrEscalation } from '@/lib/db/schema';

// Constants
const SELF_IMPROVEMENT_OUTCOME_NAME = 'Self-Improvement';

interface ClusterInfo {
  trigger_type: string;
  count: number;
  pending_count: number;
  answered_count: number;
  dismissed_count: number;
  avg_resolution_time_ms: number | null;
  recent_escalations: {
    id: string;
    outcome_id: string;
    question_text: string;
    status: string;
    created_at: number;
  }[];
}

interface CreateImprovementRequest {
  /** Array of trigger_type strings to create improvement outcomes for */
  cluster_ids: string[];
}

interface CreatedOutcomeInfo {
  id: string;
  name: string;
  trigger_type: string;
  task_count: number;
  escalations_marked?: number;
}

interface CreateImprovementResponse {
  success: boolean;
  parent_outcome_id: string;
  created_outcomes: CreatedOutcomeInfo[];
  message: string;
}

/**
 * Find or create the Self-Improvement parent outcome
 */
function findOrCreateSelfImprovementOutcome(): string {
  const allOutcomes = getAllOutcomes();

  // Look for existing Self-Improvement outcome (root level, is_ongoing)
  const existing = allOutcomes.find(
    o => o.name === SELF_IMPROVEMENT_OUTCOME_NAME && o.parent_id === null
  );

  if (existing) {
    return existing.id;
  }

  // Create the Self-Improvement parent outcome
  const newOutcome = createOutcome({
    name: SELF_IMPROVEMENT_OUTCOME_NAME,
    brief: 'System-wide improvements derived from escalation pattern analysis',
    intent: JSON.stringify({
      summary: 'Continuously improve the system by addressing recurring escalation patterns',
      items: [],
      success_criteria: [
        'Reduce frequency of common escalation triggers',
        'Improve clarity of outcome specifications',
        'Build skills to handle recurring ambiguities',
      ],
    }),
    is_ongoing: true,
  });

  // Add design doc
  upsertDesignDoc(newOutcome.id, JSON.stringify({
    summary: 'Automated self-improvement through escalation analysis',
    approach: [
      'Analyze escalation patterns to identify recurring issues',
      'Create child outcomes for each significant pattern',
      'Implement fixes through skills, documentation, or process changes',
      'Measure impact by tracking escalation frequency reduction',
    ],
    technologies: ['HOMЯ Protocol', 'Escalation Analytics'],
    decisions: [
      {
        decision: 'Use ongoing outcome with child sub-outcomes',
        rationale: 'Allows continuous improvement without cluttering the main outcome list',
      },
    ],
    version: 1,
  }));

  return newOutcome.id;
}

/**
 * Get cluster information for specified trigger types
 */
function getClusterInfo(triggerTypes: string[]): Map<string, ClusterInfo> {
  const db = getDb();
  const clusterMap = new Map<string, ClusterInfo>();

  for (const triggerType of triggerTypes) {
    // Get all escalations for this trigger type
    const escalations = db.prepare(`
      SELECT * FROM homr_escalations
      WHERE trigger_type = ?
      ORDER BY created_at DESC
    `).all(triggerType) as HomrEscalation[];

    if (escalations.length === 0) continue;

    // Calculate stats
    let pendingCount = 0;
    let answeredCount = 0;
    let dismissedCount = 0;
    const resolutionTimes: number[] = [];

    for (const esc of escalations) {
      if (esc.status === 'pending') pendingCount++;
      else if (esc.status === 'answered') answeredCount++;
      else if (esc.status === 'dismissed') dismissedCount++;

      if (esc.answered_at && esc.created_at) {
        resolutionTimes.push(esc.answered_at - esc.created_at);
      }
    }

    const avgResolutionTime = resolutionTimes.length > 0
      ? Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length)
      : null;

    clusterMap.set(triggerType, {
      trigger_type: triggerType,
      count: escalations.length,
      pending_count: pendingCount,
      answered_count: answeredCount,
      dismissed_count: dismissedCount,
      avg_resolution_time_ms: avgResolutionTime,
      recent_escalations: escalations.slice(0, 5).map(esc => ({
        id: esc.id,
        outcome_id: esc.outcome_id,
        question_text: esc.question_text,
        status: esc.status,
        created_at: esc.created_at,
      })),
    });
  }

  return clusterMap;
}

/**
 * Format trigger type for display (e.g., 'unclear_requirement' -> 'Unclear Requirement')
 */
function formatTriggerType(triggerType: string): string {
  return triggerType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate intent (PRD) for an improvement outcome
 */
function generateIntent(cluster: ClusterInfo): string {
  const formattedType = formatTriggerType(cluster.trigger_type);

  // Extract sample questions for context
  const sampleQuestions = cluster.recent_escalations
    .slice(0, 3)
    .map(esc => esc.question_text);

  return JSON.stringify({
    summary: `Address "${formattedType}" escalation pattern (${cluster.count} occurrences)`,
    items: [
      {
        id: '1',
        title: `Analyze root causes of "${formattedType}" escalations`,
        description: 'Review escalation history to identify common themes and root causes',
        acceptance_criteria: [
          'Document at least 3 root causes',
          'Identify which outcomes are most affected',
          'Categorize by severity and frequency',
        ],
        priority: 'high',
        status: 'pending',
      },
      {
        id: '2',
        title: `Create preventive measures for "${formattedType}"`,
        description: 'Develop skills, documentation, or process improvements to prevent future occurrences',
        acceptance_criteria: [
          'Create at least one skill or documentation update',
          'Define clear guidelines for handling this scenario',
          'Include examples from actual escalations',
        ],
        priority: 'high',
        status: 'pending',
      },
      {
        id: '3',
        title: 'Validate improvement effectiveness',
        description: 'Measure reduction in escalation frequency after implementing fixes',
        acceptance_criteria: [
          'Track escalation count before and after changes',
          'Achieve at least 30% reduction in frequency',
          'Document lessons learned',
        ],
        priority: 'medium',
        status: 'pending',
      },
    ],
    success_criteria: [
      `Reduce "${formattedType}" escalations by at least 30%`,
      'Create reusable artifacts (skills, docs) for similar patterns',
      'Improve worker autonomy for this scenario type',
    ],
    context: {
      sample_questions: sampleQuestions,
      total_occurrences: cluster.count,
      pending_count: cluster.pending_count,
    },
  });
}

/**
 * Generate approach (design doc) for an improvement outcome
 */
function generateApproach(cluster: ClusterInfo): string {
  const formattedType = formatTriggerType(cluster.trigger_type);

  return JSON.stringify({
    summary: `Systematic approach to reducing "${formattedType}" escalations`,
    approach: [
      '1. Analysis Phase: Review all historical escalations of this type',
      '2. Pattern Identification: Extract common themes and root causes',
      '3. Solution Design: Create appropriate artifacts (skills, templates, docs)',
      '4. Implementation: Deploy changes to affected outcomes',
      '5. Validation: Monitor escalation frequency and adjust as needed',
    ],
    technologies: ['HOMЯ Observer', 'Skill Builder', 'Documentation'],
    decisions: [
      {
        decision: `Focus on "${formattedType}" pattern`,
        rationale: `This pattern has ${cluster.count} occurrences and is causing worker friction`,
      },
    ],
    version: 1,
  });
}

/**
 * Generate tasks for an improvement outcome
 */
function generateTasks(outcomeId: string, cluster: ClusterInfo): number {
  const formattedType = formatTriggerType(cluster.trigger_type);

  const tasks = createTasksBatch([
    {
      outcome_id: outcomeId,
      title: `Analyze "${formattedType}" escalation history`,
      description: `Review all ${cluster.count} escalations of type "${cluster.trigger_type}" to identify patterns and root causes.`,
      priority: 10,
      phase: 'execution',
      task_intent: 'Understand why these escalations occur and what information workers are missing',
      task_approach: 'Query escalation database, categorize questions, identify common themes',
    },
    {
      outcome_id: outcomeId,
      title: `Document "${formattedType}" handling guidelines`,
      description: 'Create clear documentation for how workers should handle scenarios that previously caused escalations.',
      priority: 20,
      phase: 'execution',
      task_intent: 'Provide workers with clear guidance to reduce future escalations',
      task_approach: 'Based on analysis, write markdown documentation with examples',
      depends_on: ['1'], // Depends on analysis task
    },
    {
      outcome_id: outcomeId,
      title: `Create skill for "${formattedType}" scenarios`,
      description: 'Build a reusable skill that helps workers navigate this type of situation.',
      priority: 30,
      phase: 'capability',
      capability_type: 'skill',
      task_intent: 'Encode knowledge about handling this scenario into a reusable skill',
      task_approach: 'Create markdown skill file with triggers, context, and decision guidance',
      depends_on: ['2'], // Depends on documentation task
    },
    {
      outcome_id: outcomeId,
      title: 'Validate escalation reduction',
      description: `Monitor "${cluster.trigger_type}" escalation frequency after implementing changes. Target: 30% reduction.`,
      priority: 40,
      phase: 'execution',
      task_intent: 'Verify that the improvements are actually reducing escalation frequency',
      task_approach: 'Compare escalation counts before and after, document results',
      depends_on: ['3'], // Depends on skill creation
    },
  ]);

  // Fix task dependencies to use actual task IDs
  // Note: The task IDs are assigned during creation, so we need to update the depends_on
  // to reference the actual IDs. The createTasksBatch returns the created tasks.
  if (tasks.length >= 4) {
    const db = getDb();
    const timestamp = Date.now();

    // Task 2 depends on Task 1
    db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?')
      .run(JSON.stringify([tasks[0].id]), tasks[1].id);

    // Task 3 depends on Task 2
    db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?')
      .run(JSON.stringify([tasks[1].id]), tasks[2].id);

    // Task 4 depends on Task 3
    db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?')
      .run(JSON.stringify([tasks[2].id]), tasks[3].id);
  }

  return tasks.length;
}

/**
 * Check if a child outcome already exists for this trigger type
 */
function childOutcomeExists(parentId: string, triggerType: string): boolean {
  const db = getDb();
  const formattedType = formatTriggerType(triggerType);

  // Check if there's an existing child outcome with this trigger type in the name
  const existing = db.prepare(`
    SELECT id FROM outcomes
    WHERE parent_id = ? AND name LIKE ?
    LIMIT 1
  `).get(parentId, `%${formattedType}%`);

  return existing !== undefined;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CreateImprovementRequest;

    // Validate input
    if (!body.cluster_ids || !Array.isArray(body.cluster_ids) || body.cluster_ids.length === 0) {
      return NextResponse.json(
        { error: 'cluster_ids array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Find or create the Self-Improvement parent outcome
    const parentOutcomeId = findOrCreateSelfImprovementOutcome();

    // Get cluster information for the selected trigger types
    const clusterInfo = getClusterInfo(body.cluster_ids);

    if (clusterInfo.size === 0) {
      return NextResponse.json(
        { error: 'No escalation data found for the specified cluster IDs' },
        { status: 404 }
      );
    }

    // Create child outcomes for each cluster
    const createdOutcomes: CreatedOutcomeInfo[] = [];
    const skippedTypes: string[] = [];

    for (const [triggerType, cluster] of Array.from(clusterInfo.entries())) {
      // Skip if child outcome already exists for this trigger type
      if (childOutcomeExists(parentOutcomeId, triggerType)) {
        skippedTypes.push(triggerType);
        continue;
      }

      const formattedType = formatTriggerType(triggerType);

      // Create the child outcome
      const childOutcome = createOutcome({
        name: `Fix: ${formattedType} Escalations`,
        parent_id: parentOutcomeId,
        brief: `Address the recurring "${formattedType}" escalation pattern (${cluster.count} occurrences)`,
        intent: generateIntent(cluster),
        is_ongoing: false,
      });

      // Add design doc
      upsertDesignDoc(childOutcome.id, generateApproach(cluster));

      // Generate tasks
      const taskCount = generateTasks(childOutcome.id, cluster);

      // Mark escalations of this trigger type as incorporated into this outcome
      const markedCount = markEscalationsByTriggerTypeAsIncorporated(
        [triggerType],
        childOutcome.id,
        30 * 24 * 60 * 60 * 1000 // 30 days lookback
      );

      createdOutcomes.push({
        id: childOutcome.id,
        name: childOutcome.name,
        trigger_type: triggerType,
        task_count: taskCount,
        escalations_marked: markedCount,
      });

      // Log improvement creation to activity feed
      logImprovementCreated(
        parentOutcomeId,
        SELF_IMPROVEMENT_OUTCOME_NAME,
        childOutcome.name,
        taskCount,
        markedCount
      );
    }

    // Build response message
    let message = `Created ${createdOutcomes.length} improvement outcome(s)`;
    if (skippedTypes.length > 0) {
      message += `. Skipped ${skippedTypes.length} (already exist): ${skippedTypes.join(', ')}`;
    }

    const response: CreateImprovementResponse = {
      success: true,
      parent_outcome_id: parentOutcomeId,
      created_outcomes: createdOutcomes,
      message,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error creating improvement outcomes:', error);
    return NextResponse.json(
      { error: 'Failed to create improvement outcomes', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
