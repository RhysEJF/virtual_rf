/**
 * Improvements Create Consolidated API
 *
 * POST /api/improvements/create-consolidated - Create ONE consolidated outcome from multiple clusters
 *
 * This endpoint:
 * 1. Accepts selected clusters and proposals from escalation analysis
 * 2. Finds or creates a "Self-Improvement" parent outcome
 * 3. Creates ONE child outcome that addresses all selected patterns
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createOutcome,
  getAllOutcomes,
  upsertDesignDoc,
} from '@/lib/db/outcomes';
import { createTasksBatch, type CreateTaskInput } from '@/lib/db/tasks';
import { markEscalationsByTriggerTypeAsIncorporated } from '@/lib/db/homr';
import type { TaskPhase } from '@/lib/db/schema';

// Constants
const SELF_IMPROVEMENT_OUTCOME_NAME = 'Self-Improvement';

interface ClusterSummary {
  id: string;
  rootCause: string;
  patternDescription: string;
  problemStatement: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  escalationCount: number;
  triggerTypes: string[];
}

interface ProposedTask {
  title: string;
  description: string;
  priority: number;
}

interface ProposalSummary {
  clusterId: string;
  rootCause: string;
  escalationCount: number;
  problemSummary: string;
  outcomeName: string;
  proposedTasks: ProposedTask[];
  intent: {
    summary: string;
    itemCount: number;
    successCriteria: string[];
  };
  approach: {
    summary: string;
    stepCount: number;
    risks: string[];
  };
}

interface CreateConsolidatedRequest {
  clusters: ClusterSummary[];
  proposals: ProposalSummary[];
  trigger_types: string[];
}

interface CreateConsolidatedResponse {
  success: boolean;
  outcome_id: string;
  parent_outcome_id: string;
  task_count: number;
  escalations_marked?: number;
  message: string;
}

/**
 * Find or create the Self-Improvement parent outcome
 */
function findOrCreateSelfImprovementOutcome(): string {
  const allOutcomes = getAllOutcomes();

  // Look for existing Self-Improvement outcome (root level)
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
 * Generate consolidated intent from multiple clusters
 */
function generateConsolidatedIntent(clusters: ClusterSummary[], proposals: ProposalSummary[]): string {
  const totalEscalations = clusters.reduce((sum, c) => sum + c.escalationCount, 0);

  // Gather all success criteria from proposals
  const allSuccessCriteria = proposals.flatMap(p => p.intent.successCriteria);
  const uniqueSuccessCriteria = Array.from(new Set(allSuccessCriteria)).slice(0, 6);

  // Create items from each cluster
  const items = clusters.map((cluster, index) => ({
    id: String(index + 1),
    title: `Address "${cluster.rootCause}" pattern`,
    description: cluster.problemStatement,
    acceptance_criteria: [
      `Analyze root causes of ${cluster.escalationCount} "${cluster.rootCause}" escalations`,
      'Implement preventive measures (skills, docs, or code)',
      'Achieve 30% reduction in this escalation type',
    ],
    priority: cluster.severity === 'critical' || cluster.severity === 'high' ? 'high' : 'medium',
    status: 'pending',
  }));

  return JSON.stringify({
    summary: `Address ${clusters.length} recurring escalation patterns (${totalEscalations} total escalations)`,
    items,
    success_criteria: uniqueSuccessCriteria.length > 0 ? uniqueSuccessCriteria : [
      'Reduce overall escalation frequency by 30%',
      'Create reusable skills for handling common ambiguities',
      'Improve worker autonomy across identified patterns',
    ],
  });
}

/**
 * Generate consolidated approach from multiple proposals
 */
function generateConsolidatedApproach(clusters: ClusterSummary[], proposals: ProposalSummary[]): string {
  // Gather all risks from proposals
  const allRisks = proposals.flatMap(p => p.approach.risks);
  const uniqueRisks = Array.from(new Set(allRisks)).slice(0, 4);

  const patternSummary = clusters
    .map(c => `- ${c.rootCause} (${c.escalationCount} escalations)`)
    .join('\n');

  return JSON.stringify({
    summary: `Consolidated approach to address ${clusters.length} escalation patterns`,
    approach: [
      '1. Analysis Phase: Review all historical escalations for each pattern',
      '2. Root Cause Identification: Extract common themes across patterns',
      '3. Solution Design: Create skills, templates, and documentation',
      '4. Implementation: Deploy changes and update affected outcomes',
      '5. Validation: Monitor escalation frequency and measure improvement',
    ],
    patterns_addressed: patternSummary,
    technologies: ['HOMЯ Observer', 'Skill Builder', 'Documentation'],
    risks: uniqueRisks.length > 0 ? uniqueRisks : [
      'Changes may not address all root causes',
      'Some patterns may be inherently ambiguous',
    ],
    version: 1,
  });
}

/**
 * Generate tasks for all clusters in the consolidated outcome
 */
function generateConsolidatedTasks(
  outcomeId: string,
  clusters: ClusterSummary[],
  proposals: ProposalSummary[]
): number {
  const tasks: CreateTaskInput[] = [];
  const executionPhase: TaskPhase = 'execution';

  let priority = 10;

  // For each cluster, create analysis and fix tasks
  for (const cluster of clusters) {
    const proposal = proposals.find(p => p.clusterId === cluster.id);

    // Analysis task for this pattern
    tasks.push({
      outcome_id: outcomeId,
      title: `Analyze "${cluster.rootCause}" escalation pattern`,
      description: `Review ${cluster.escalationCount} escalations of this type. ${cluster.problemStatement}`,
      priority: priority,
      phase: executionPhase,
      task_intent: 'Understand why these escalations occur and what information workers are missing',
      task_approach: 'Query escalation database, categorize questions, identify common themes',
    });
    priority += 10;

    // Create skill/fix task for this pattern
    tasks.push({
      outcome_id: outcomeId,
      title: `Create fixes for "${cluster.rootCause}"`,
      description: `Implement preventive measures: skills, documentation, or code changes to address this pattern.`,
      priority: priority,
      phase: executionPhase,
      task_intent: 'Provide workers with clear guidance to reduce future escalations of this type',
      task_approach: proposal?.approach.summary || 'Create markdown skills with decision guidance and examples',
    });
    priority += 10;
  }

  // Final validation task
  tasks.push({
    outcome_id: outcomeId,
    title: 'Validate improvement effectiveness',
    description: `Monitor escalation frequency for all ${clusters.length} addressed patterns. Target: 30% overall reduction.`,
    priority: priority,
    phase: executionPhase,
    task_intent: 'Verify that the improvements are actually reducing escalation frequency',
    task_approach: 'Compare escalation counts before and after changes, document results',
  });

  const createdTasks = createTasksBatch(tasks);
  return createdTasks.length;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CreateConsolidatedRequest;

    // Validate input
    if (!body.clusters || !Array.isArray(body.clusters) || body.clusters.length === 0) {
      return NextResponse.json(
        { error: 'clusters array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Find or create the Self-Improvement parent outcome
    const parentOutcomeId = findOrCreateSelfImprovementOutcome();

    // Generate outcome name from clusters
    const patternCount = body.clusters.length;
    const totalEscalations = body.clusters.reduce((sum, c) => sum + c.escalationCount, 0);
    const outcomeName = `Fix: ${patternCount} Escalation Patterns (${totalEscalations} total)`;

    // Create the consolidated child outcome
    const childOutcome = createOutcome({
      name: outcomeName,
      parent_id: parentOutcomeId,
      brief: `Consolidated improvement addressing ${patternCount} recurring escalation patterns`,
      intent: generateConsolidatedIntent(body.clusters, body.proposals || []),
      is_ongoing: false,
    });

    // Add design doc
    upsertDesignDoc(childOutcome.id, generateConsolidatedApproach(body.clusters, body.proposals || []));

    // Generate tasks
    const taskCount = generateConsolidatedTasks(childOutcome.id, body.clusters, body.proposals || []);

    // Mark escalations from all clusters as incorporated into this outcome
    // Collect all trigger types from clusters (fallback if trigger_types not provided)
    const allTriggerTypes: string[] = body.trigger_types ||
      Array.from(new Set(body.clusters.flatMap(c => c.triggerTypes || [])));

    let escalationsMarked = 0;
    if (allTriggerTypes.length > 0) {
      escalationsMarked = markEscalationsByTriggerTypeAsIncorporated(
        allTriggerTypes,
        childOutcome.id,
        30 * 24 * 60 * 60 * 1000 // 30 days lookback
      );
    }

    const response: CreateConsolidatedResponse = {
      success: true,
      outcome_id: childOutcome.id,
      parent_outcome_id: parentOutcomeId,
      task_count: taskCount,
      escalations_marked: escalationsMarked,
      message: `Created consolidated outcome with ${taskCount} tasks addressing ${patternCount} patterns (${escalationsMarked} escalations marked)`,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error creating consolidated outcome:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create consolidated outcome',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
