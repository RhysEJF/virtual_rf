/**
 * Improvement Analyzer Agent
 *
 * Analyzes escalation patterns from HOMЯ to identify recurring issues
 * and generate improvement outcomes to fix root causes.
 *
 * Process:
 * 1. Fetch recent escalations with full context
 * 2. Cluster escalations by root cause using Claude
 * 3. Generate problem statements, solution approaches, success criteria
 * 4. Create improvement outcomes with tasks for each cluster
 */

import { getDb, now } from '../db';
import { claudeComplete } from '../claude/client';
import { createOutcome, getOutcomeById } from '../db/outcomes';
import { createTask } from '../db/tasks';
import { upsertDesignDoc } from '../db/outcomes';
import type {
  HomrEscalation,
  HomrEscalationStatus,
  HomrQuestionOption,
  Outcome,
  Task,
} from '../db/schema';
import { generateId } from '../utils/id';

// ============================================================================
// Types
// ============================================================================

export interface EscalationWithContext extends HomrEscalation {
  /** Parsed trigger evidence */
  parsedEvidence: string[];
  /** Parsed question options */
  parsedOptions: HomrQuestionOption[];
  /** Parsed affected tasks */
  parsedAffectedTasks: string[];
  /** Outcome name for context */
  outcomeName?: string;
}

export interface EscalationCluster {
  /** Unique cluster ID */
  id: string;
  /** Root cause category */
  rootCause: string;
  /** Detailed description of the pattern */
  patternDescription: string;
  /** Escalations belonging to this cluster */
  escalations: EscalationWithContext[];
  /** Problem statement for this cluster */
  problemStatement: string;
  /** Severity based on frequency and impact */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ImprovementProposal {
  /** Cluster this proposal addresses */
  cluster: EscalationCluster;
  /** Name for the improvement outcome */
  outcomeName: string;
  /** Intent/PRD for the improvement */
  intent: {
    summary: string;
    items: Array<{
      id: string;
      title: string;
      description: string;
      acceptance_criteria: string[];
      priority: 'critical' | 'high' | 'medium' | 'low';
      status: 'pending';
    }>;
    success_criteria: string[];
  };
  /** Approach/design doc for the improvement */
  approach: {
    summary: string;
    steps: string[];
    risks: string[];
    dependencies: string[];
  };
  /** Generated tasks */
  tasks: Array<{
    title: string;
    description: string;
    priority: number;
  }>;
}

export interface AnalysisResult {
  /** Total escalations analyzed */
  escalationsAnalyzed: number;
  /** Clusters identified */
  clusters: EscalationCluster[];
  /** Improvement proposals generated */
  proposals: ImprovementProposal[];
  /** Outcomes created (if auto-create is enabled) */
  outcomesCreated: Outcome[];
  /** Analysis timestamp */
  analyzedAt: number;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_LOOKBACK_DAYS = 30;
const MIN_CLUSTER_SIZE = 2; // Minimum escalations to form a cluster
const MAX_CLUSTERS = 5; // Maximum clusters to analyze at once

// ============================================================================
// Escalation Fetching
// ============================================================================

/**
 * Fetch recent escalations with full context
 */
export function fetchRecentEscalations(
  options: {
    lookbackDays?: number;
    status?: HomrEscalationStatus[];
    outcomeId?: string;
    limit?: number;
  } = {}
): EscalationWithContext[] {
  const {
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    status = ['answered', 'pending'],
    outcomeId,
    limit = 100,
  } = options;

  const db = getDb();
  const cutoff = now() - lookbackDays * 24 * 60 * 60 * 1000;
  const statusPlaceholders = status.map(() => '?').join(',');

  let query: string;
  let params: unknown[];

  if (outcomeId) {
    query = `
      SELECT e.*, o.name as outcome_name
      FROM homr_escalations e
      LEFT JOIN outcomes o ON e.outcome_id = o.id
      WHERE e.created_at > ?
        AND e.status IN (${statusPlaceholders})
        AND e.outcome_id = ?
        AND e.incorporated_into_outcome_id IS NULL
      ORDER BY e.created_at DESC
      LIMIT ?
    `;
    params = [cutoff, ...status, outcomeId, limit];
  } else {
    query = `
      SELECT e.*, o.name as outcome_name
      FROM homr_escalations e
      LEFT JOIN outcomes o ON e.outcome_id = o.id
      WHERE e.created_at > ?
        AND e.status IN (${statusPlaceholders})
        AND e.incorporated_into_outcome_id IS NULL
      ORDER BY e.created_at DESC
      LIMIT ?
    `;
    params = [cutoff, ...status, limit];
  }

  const rows = db.prepare(query).all(...params) as (HomrEscalation & { outcome_name?: string })[];

  return rows.map(row => ({
    ...row,
    parsedEvidence: safeJsonParse(row.trigger_evidence, []),
    parsedOptions: safeJsonParse(row.question_options, []),
    parsedAffectedTasks: safeJsonParse(row.affected_tasks, []),
    outcomeName: row.outcome_name,
  }));
}

/**
 * Get escalation counts by type for quick analysis
 */
export function getEscalationCountsByType(
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Record<string, number> {
  const db = getDb();
  const cutoff = now() - lookbackDays * 24 * 60 * 60 * 1000;

  const rows = db.prepare(`
    SELECT trigger_type, COUNT(*) as count
    FROM homr_escalations
    WHERE created_at > ?
    GROUP BY trigger_type
    ORDER BY count DESC
  `).all(cutoff) as { trigger_type: string; count: number }[];

  return Object.fromEntries(rows.map(r => [r.trigger_type, r.count]));
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Cluster escalations by root cause using Claude
 */
export async function clusterEscalationsByRootCause(
  escalations: EscalationWithContext[]
): Promise<EscalationCluster[]> {
  if (escalations.length < MIN_CLUSTER_SIZE) {
    console.log(`[ImprovementAnalyzer] Not enough escalations to cluster (${escalations.length} < ${MIN_CLUSTER_SIZE})`);
    return [];
  }

  // Prepare escalation summaries for Claude
  const escalationSummaries = escalations.map((e, i) => ({
    index: i,
    type: e.trigger_type,
    question: e.question_text,
    context: e.question_context.substring(0, 500),
    evidence: e.parsedEvidence.slice(0, 3),
    outcome: e.outcomeName || 'Unknown',
    answer: e.answer_option || 'Unanswered',
  }));

  const prompt = `Analyze these escalations from an AI worker management system to identify recurring patterns and root causes.

ESCALATIONS:
${JSON.stringify(escalationSummaries, null, 2)}

Your task is to:
1. Identify clusters of escalations with the same root cause
2. Each cluster should have at least ${MIN_CLUSTER_SIZE} related escalations
3. Name each root cause clearly (e.g., "unclear_requirements", "missing_context", "ambiguous_priorities")
4. Write a concise problem statement for each cluster
5. Assess severity based on frequency and impact (low/medium/high/critical)

Return your analysis as JSON in this exact format:
{
  "clusters": [
    {
      "root_cause": "string - short snake_case identifier",
      "pattern_description": "string - detailed description of the pattern",
      "problem_statement": "string - the core problem to solve",
      "severity": "low|medium|high|critical",
      "escalation_indices": [0, 1, 2] // indices of escalations in this cluster
    }
  ]
}

If no clear clusters can be identified, return: {"clusters": []}

Only output the JSON, nothing else.`;

  try {
    const result = await claudeComplete({
      prompt,
      maxTurns: 3, // Increased from 1
      timeout: 60000,
      description: 'Improvement analyzer - clustering escalations',
    });

    if (!result.success || !result.text) {
      console.error('[ImprovementAnalyzer] Claude clustering failed:', result.error);
      return [];
    }

    // Parse Claude's response
    const parsed = extractJson<{
      clusters: Array<{
        root_cause: string;
        pattern_description: string;
        problem_statement: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        escalation_indices: number[];
      }>;
    }>(result.text);

    if (!parsed || !parsed.clusters) {
      console.error('[ImprovementAnalyzer] Failed to parse clustering response');
      return [];
    }

    // Convert to EscalationCluster objects
    const clusters: EscalationCluster[] = [];

    for (const c of parsed.clusters.slice(0, MAX_CLUSTERS)) {
      // Filter valid indices and get corresponding escalations
      const clusterEscalations = c.escalation_indices
        .filter(i => i >= 0 && i < escalations.length)
        .map(i => escalations[i]);

      if (clusterEscalations.length >= MIN_CLUSTER_SIZE) {
        clusters.push({
          id: generateId('cluster'),
          rootCause: c.root_cause,
          patternDescription: c.pattern_description,
          escalations: clusterEscalations,
          problemStatement: c.problem_statement,
          severity: c.severity,
        });
      }
    }

    console.log(`[ImprovementAnalyzer] Identified ${clusters.length} clusters from ${escalations.length} escalations`);
    return clusters;
  } catch (error) {
    console.error('[ImprovementAnalyzer] Clustering error:', error);
    return [];
  }
}

// ============================================================================
// Proposal Generation
// ============================================================================

/**
 * Generate improvement proposal for a cluster
 */
export async function generateImprovementProposal(
  cluster: EscalationCluster
): Promise<ImprovementProposal | null> {
  const escalationContext = cluster.escalations
    .map(e => `- Type: ${e.trigger_type}\n  Question: ${e.question_text}\n  Answer: ${e.answer_option || 'Unanswered'}`)
    .join('\n\n');

  const prompt = `Create an improvement outcome to fix this recurring issue in an AI worker management system.

ROOT CAUSE: ${cluster.rootCause}
PATTERN: ${cluster.patternDescription}
PROBLEM: ${cluster.problemStatement}
SEVERITY: ${cluster.severity}
OCCURRENCE COUNT: ${cluster.escalations.length}

EXAMPLE ESCALATIONS:
${escalationContext}

Generate a complete improvement plan including:
1. A clear outcome name (action-oriented, e.g., "Improve requirement clarity for worker tasks")
2. An intent/PRD with specific items and acceptance criteria
3. An approach with concrete steps to implement the fix
4. A set of tasks to execute the improvement

Return as JSON in this exact format:
{
  "outcome_name": "string",
  "intent": {
    "summary": "string - what we're trying to achieve",
    "items": [
      {
        "title": "string",
        "description": "string",
        "acceptance_criteria": ["string"],
        "priority": "critical|high|medium|low"
      }
    ],
    "success_criteria": ["string - how we'll know the problem is solved"]
  },
  "approach": {
    "summary": "string - how we'll solve this",
    "steps": ["string"],
    "risks": ["string"],
    "dependencies": ["string"]
  },
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "priority": 1
    }
  ]
}

Only output the JSON, nothing else.`;

  try {
    const result = await claudeComplete({
      prompt,
      maxTurns: 3, // Increased from 1
      timeout: 90000,
      description: `Improvement analyzer - generating proposal for ${cluster.rootCause}`,
    });

    if (!result.success || !result.text) {
      console.error('[ImprovementAnalyzer] Proposal generation failed:', result.error);
      return null;
    }

    const parsed = extractJson<{
      outcome_name: string;
      intent: {
        summary: string;
        items: Array<{
          title: string;
          description: string;
          acceptance_criteria: string[];
          priority: 'critical' | 'high' | 'medium' | 'low';
        }>;
        success_criteria: string[];
      };
      approach: {
        summary: string;
        steps: string[];
        risks: string[];
        dependencies: string[];
      };
      tasks: Array<{
        title: string;
        description: string;
        priority: number;
      }>;
    }>(result.text);

    if (!parsed || !parsed.outcome_name || !parsed.intent || !parsed.approach || !parsed.tasks) {
      console.error('[ImprovementAnalyzer] Failed to parse proposal response');
      return null;
    }

    // Add IDs to items
    const itemsWithIds = parsed.intent.items.map((item, i) => ({
      ...item,
      id: `item_${i + 1}`,
      status: 'pending' as const,
    }));

    return {
      cluster,
      outcomeName: parsed.outcome_name,
      intent: {
        summary: parsed.intent.summary,
        items: itemsWithIds,
        success_criteria: parsed.intent.success_criteria,
      },
      approach: parsed.approach,
      tasks: parsed.tasks,
    };
  } catch (error) {
    console.error('[ImprovementAnalyzer] Proposal error:', error);
    return null;
  }
}

// ============================================================================
// Outcome Creation
// ============================================================================

/**
 * Create an improvement outcome from a proposal
 */
export function createImprovementOutcome(
  proposal: ImprovementProposal,
  options: {
    parentOutcomeId?: string;
    autoStart?: boolean;
  } = {}
): { outcome: Outcome; tasks: Task[] } {
  // Create the outcome
  const outcome = createOutcome({
    name: proposal.outcomeName,
    brief: `Improvement outcome to address: ${proposal.cluster.problemStatement}`,
    intent: JSON.stringify(proposal.intent),
    parent_id: options.parentOutcomeId,
  });

  // Create the design doc
  const approachDoc = `# ${proposal.outcomeName}

## Summary
${proposal.approach.summary}

## Problem Being Solved
${proposal.cluster.problemStatement}

Root Cause: ${proposal.cluster.rootCause}
Pattern: ${proposal.cluster.patternDescription}
Severity: ${proposal.cluster.severity}
Occurrences: ${proposal.cluster.escalations.length}

## Implementation Steps
${proposal.approach.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Risks
${proposal.approach.risks.map(r => `- ${r}`).join('\n')}

## Dependencies
${proposal.approach.dependencies.map(d => `- ${d}`).join('\n')}
`;

  upsertDesignDoc(outcome.id, approachDoc);

  // Create tasks
  const tasks: Task[] = [];
  for (const taskDef of proposal.tasks) {
    const task = createTask({
      outcome_id: outcome.id,
      title: taskDef.title,
      description: taskDef.description,
      priority: taskDef.priority,
      phase: 'execution',
    });
    tasks.push(task);
  }

  console.log(`[ImprovementAnalyzer] Created outcome "${outcome.name}" with ${tasks.length} tasks`);

  return { outcome, tasks };
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Run full improvement analysis
 */
export async function analyzeForImprovements(
  options: {
    lookbackDays?: number;
    outcomeId?: string;
    autoCreateOutcomes?: boolean;
    maxProposals?: number;
  } = {}
): Promise<AnalysisResult> {
  const {
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    outcomeId,
    autoCreateOutcomes = false,
    maxProposals = 3,
  } = options;

  console.log(`[ImprovementAnalyzer] Starting analysis (${lookbackDays} day lookback)`);

  // 1. Fetch recent escalations
  const escalations = fetchRecentEscalations({
    lookbackDays,
    outcomeId,
  });

  if (escalations.length === 0) {
    console.log('[ImprovementAnalyzer] No escalations found for analysis');
    return {
      escalationsAnalyzed: 0,
      clusters: [],
      proposals: [],
      outcomesCreated: [],
      analyzedAt: now(),
    };
  }

  console.log(`[ImprovementAnalyzer] Found ${escalations.length} escalations to analyze`);

  // 2. Cluster by root cause
  const clusters = await clusterEscalationsByRootCause(escalations);

  if (clusters.length === 0) {
    console.log('[ImprovementAnalyzer] No clusters identified');
    return {
      escalationsAnalyzed: escalations.length,
      clusters: [],
      proposals: [],
      outcomesCreated: [],
      analyzedAt: now(),
    };
  }

  // Sort clusters by severity and size
  const sortedClusters = clusters.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.escalations.length - a.escalations.length;
  });

  // 3. Generate proposals for top clusters
  const proposals: ImprovementProposal[] = [];
  for (const cluster of sortedClusters.slice(0, maxProposals)) {
    const proposal = await generateImprovementProposal(cluster);
    if (proposal) {
      proposals.push(proposal);
    }
  }

  // 4. Optionally create outcomes
  const outcomesCreated: Outcome[] = [];
  if (autoCreateOutcomes && proposals.length > 0) {
    for (const proposal of proposals) {
      const { outcome } = createImprovementOutcome(proposal);
      outcomesCreated.push(outcome);
    }
  }

  return {
    escalationsAnalyzed: escalations.length,
    clusters: sortedClusters,
    proposals,
    outcomesCreated,
    analyzedAt: now(),
  };
}

// ============================================================================
// Scheduled Analysis
// ============================================================================

let analysisInterval: NodeJS.Timeout | null = null;
let isRunning = false;

const ANALYSIS_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run daily

/**
 * Start periodic improvement analysis
 */
export function startImprovementAnalysis(
  options: {
    intervalMs?: number;
    autoCreateOutcomes?: boolean;
  } = {}
): { success: boolean; message: string } {
  if (isRunning) {
    return { success: false, message: 'Improvement analyzer is already running' };
  }

  const { intervalMs = ANALYSIS_INTERVAL_MS, autoCreateOutcomes = false } = options;

  isRunning = true;

  // Run analysis periodically
  analysisInterval = setInterval(async () => {
    try {
      await analyzeForImprovements({ autoCreateOutcomes });
    } catch (err) {
      console.error('[ImprovementAnalyzer] Analysis error:', err);
    }
  }, intervalMs);

  console.log(`[ImprovementAnalyzer] Started periodic analysis (interval: ${intervalMs}ms)`);
  return { success: true, message: 'Improvement analyzer started' };
}

/**
 * Stop periodic analysis
 */
export function stopImprovementAnalysis(): { success: boolean; message: string } {
  if (!isRunning || !analysisInterval) {
    return { success: false, message: 'Improvement analyzer is not running' };
  }

  clearInterval(analysisInterval);
  analysisInterval = null;
  isRunning = false;

  console.log('[ImprovementAnalyzer] Stopped periodic analysis');
  return { success: true, message: 'Improvement analyzer stopped' };
}

/**
 * Get analyzer status
 */
export function getImprovementAnalyzerStatus(): {
  running: boolean;
  analysisIntervalMs: number;
} {
  return {
    running: isRunning,
    analysisIntervalMs: ANALYSIS_INTERVAL_MS,
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Safely parse JSON with a fallback value
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json || json === '') return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Extract JSON from a string that might contain extra text
 */
function extractJson<T>(text: string): T | null {
  try {
    // First try direct parsing
    return JSON.parse(text) as T;
  } catch {
    // Try to find JSON in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ============================================================================
// Summary Functions
// ============================================================================

/**
 * Get a summary of improvement analysis potential
 */
export async function getImprovementSummary(
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Promise<{
  totalEscalations: number;
  escalationsByType: Record<string, number>;
  hasEnoughDataForAnalysis: boolean;
  recommendedAction: string;
}> {
  const escalations = fetchRecentEscalations({ lookbackDays });
  const byType = getEscalationCountsByType(lookbackDays);

  const hasEnoughData = escalations.length >= MIN_CLUSTER_SIZE;

  let recommendedAction: string;
  if (escalations.length === 0) {
    recommendedAction = 'No escalations found. System is running smoothly or HOMЯ is not enabled.';
  } else if (!hasEnoughData) {
    recommendedAction = `Only ${escalations.length} escalation(s) found. Wait for more data before analysis.`;
  } else {
    recommendedAction = 'Sufficient data available. Run analyzeForImprovements() to identify patterns.';
  }

  return {
    totalEscalations: escalations.length,
    escalationsByType: byType,
    hasEnoughDataForAnalysis: hasEnoughData,
    recommendedAction,
  };
}
