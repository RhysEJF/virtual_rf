/**
 * HOMЯ Protocol Database Operations
 *
 * Handles all database operations for the HOMЯ intelligent orchestration layer:
 * - Context store: Cross-task memory and learnings
 * - Observations: Task observation records
 * - Escalations: Human escalation questions
 * - Activity log: Activity tracking
 */

import { getDb, now } from './index';
import { generateId } from '../utils/id';
import type {
  HomrContext,
  HomrObservation,
  HomrEscalation,
  HomrActivityLogEntry,
  HomrDiscovery,
  HomrDecision,
  HomrConstraint,
  HomrContextInjection,
  HomrDriftItem,
  HomrQualityIssue,
  HomrAmbiguitySignal,
  HomrQuestionOption,
  HomrQuality,
  HomrActivityType,
  HomrEscalationStatus,
} from './schema';

// ============================================================================
// Context Store Operations
// ============================================================================

/**
 * Get or create the HOMЯ context store for an outcome
 */
export function getHomrContext(outcomeId: string): HomrContext | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM homr_context WHERE outcome_id = ?
  `).get(outcomeId) as HomrContext | undefined;

  return row || null;
}

/**
 * Get or create the HOMЯ context store for an outcome
 */
export function getOrCreateHomrContext(outcomeId: string): HomrContext {
  const existing = getHomrContext(outcomeId);
  if (existing) return existing;

  const id = generateId('homr_ctx');
  const timestamp = now();

  const db = getDb();
  db.prepare(`
    INSERT INTO homr_context (id, outcome_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, outcomeId, timestamp, timestamp);

  return getHomrContext(outcomeId)!;
}

/**
 * Update the HOMЯ context store
 */
export function updateHomrContext(
  outcomeId: string,
  updates: {
    discoveries?: HomrDiscovery[];
    decisions?: HomrDecision[];
    constraints?: HomrConstraint[];
    injections?: HomrContextInjection[];
    tasks_observed?: number;
    discoveries_extracted?: number;
    escalations_created?: number;
    steering_actions?: number;
  }
): HomrContext {
  const context = getOrCreateHomrContext(outcomeId);
  const db = getDb();

  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [now()];

  if (updates.discoveries !== undefined) {
    setClauses.push('discoveries = ?');
    values.push(JSON.stringify(updates.discoveries));
  }
  if (updates.decisions !== undefined) {
    setClauses.push('decisions = ?');
    values.push(JSON.stringify(updates.decisions));
  }
  if (updates.constraints !== undefined) {
    setClauses.push('constraints = ?');
    values.push(JSON.stringify(updates.constraints));
  }
  if (updates.injections !== undefined) {
    setClauses.push('injections = ?');
    values.push(JSON.stringify(updates.injections));
  }
  if (updates.tasks_observed !== undefined) {
    setClauses.push('tasks_observed = ?');
    values.push(updates.tasks_observed);
  }
  if (updates.discoveries_extracted !== undefined) {
    setClauses.push('discoveries_extracted = ?');
    values.push(updates.discoveries_extracted);
  }
  if (updates.escalations_created !== undefined) {
    setClauses.push('escalations_created = ?');
    values.push(updates.escalations_created);
  }
  if (updates.steering_actions !== undefined) {
    setClauses.push('steering_actions = ?');
    values.push(updates.steering_actions);
  }

  values.push(context.id);

  db.prepare(`
    UPDATE homr_context SET ${setClauses.join(', ')} WHERE id = ?
  `).run(...values);

  return getHomrContext(outcomeId)!;
}

/**
 * Increment a counter in the context store
 */
export function incrementHomrContextStat(
  outcomeId: string,
  stat: 'tasks_observed' | 'discoveries_extracted' | 'escalations_created' | 'steering_actions'
): void {
  const context = getOrCreateHomrContext(outcomeId);
  const db = getDb();

  db.prepare(`
    UPDATE homr_context SET ${stat} = ${stat} + 1, updated_at = ? WHERE id = ?
  `).run(now(), context.id);
}

/**
 * Add a discovery to the context store
 */
export function addDiscoveryToContext(outcomeId: string, discovery: HomrDiscovery): void {
  const context = getOrCreateHomrContext(outcomeId);
  const discoveries: HomrDiscovery[] = JSON.parse(context.discoveries);
  discoveries.push(discovery);

  updateHomrContext(outcomeId, {
    discoveries,
    discoveries_extracted: context.discoveries_extracted + 1,
  });
}

/**
 * Add a decision to the context store
 */
export function addDecisionToContext(outcomeId: string, decision: HomrDecision): void {
  const context = getOrCreateHomrContext(outcomeId);
  const decisions: HomrDecision[] = JSON.parse(context.decisions);
  decisions.push(decision);

  updateHomrContext(outcomeId, { decisions });
}

/**
 * Add a context injection for a specific task
 */
export function addContextInjection(outcomeId: string, injection: HomrContextInjection): void {
  const context = getOrCreateHomrContext(outcomeId);
  const injections: HomrContextInjection[] = JSON.parse(context.injections);
  injections.push(injection);

  updateHomrContext(outcomeId, { injections });
}

/**
 * Get context injections for a specific task
 */
export function getContextInjectionsForTask(outcomeId: string, taskId: string): HomrContextInjection[] {
  const context = getHomrContext(outcomeId);
  if (!context) return [];

  const injections: HomrContextInjection[] = JSON.parse(context.injections);
  return injections.filter(i => i.targetTaskId === taskId || i.targetTaskId === '*');
}

/**
 * Get discoveries relevant to a task (those that list this task or '*')
 */
export function getDiscoveriesForTask(outcomeId: string, taskId: string): HomrDiscovery[] {
  const context = getHomrContext(outcomeId);
  if (!context) return [];

  const discoveries: HomrDiscovery[] = JSON.parse(context.discoveries);
  return discoveries.filter(d =>
    d.relevantTasks.includes(taskId) || d.relevantTasks.includes('*')
  );
}

// ============================================================================
// Observation Operations
// ============================================================================

export interface CreateObservationInput {
  outcome_id: string;
  task_id: string;
  on_track: boolean;
  alignment_score: number;
  quality: HomrQuality;
  drift: HomrDriftItem[];
  discoveries: HomrDiscovery[];
  issues: HomrQualityIssue[];
  has_ambiguity: boolean;
  ambiguity_data?: HomrAmbiguitySignal;
  summary: string;
}

/**
 * Create a new observation record
 */
export function createObservation(input: CreateObservationInput): HomrObservation {
  const db = getDb();
  const id = generateId('homr_obs');
  const timestamp = now();

  db.prepare(`
    INSERT INTO homr_observations (
      id, outcome_id, task_id, created_at,
      on_track, alignment_score, quality,
      drift, discoveries, issues,
      has_ambiguity, ambiguity_data, summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.outcome_id,
    input.task_id,
    timestamp,
    input.on_track ? 1 : 0,
    input.alignment_score,
    input.quality,
    JSON.stringify(input.drift),
    JSON.stringify(input.discoveries),
    JSON.stringify(input.issues),
    input.has_ambiguity ? 1 : 0,
    input.ambiguity_data ? JSON.stringify(input.ambiguity_data) : null,
    input.summary
  );

  // Increment counter in context store
  incrementHomrContextStat(input.outcome_id, 'tasks_observed');

  return getObservationById(id)!;
}

/**
 * Get an observation by ID
 */
export function getObservationById(id: string): HomrObservation | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM homr_observations WHERE id = ?
  `).get(id) as HomrObservation | undefined;

  return row || null;
}

/**
 * Get recent observations for an outcome
 */
export function getRecentObservations(outcomeId: string, limit: number = 10): HomrObservation[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM homr_observations
    WHERE outcome_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as HomrObservation[];
}

/**
 * Get observations for a specific task
 */
export function getObservationsByTask(taskId: string): HomrObservation[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM homr_observations
    WHERE task_id = ?
    ORDER BY created_at DESC
  `).all(taskId) as HomrObservation[];
}

// ============================================================================
// Escalation Operations
// ============================================================================

export interface CreateEscalationInput {
  outcome_id: string;
  trigger_type: string;
  trigger_task_id: string;
  trigger_evidence: string[];
  question_text: string;
  question_context: string;
  question_options: HomrQuestionOption[];
  affected_tasks: string[];
}

/**
 * Create a new escalation
 */
export function createEscalation(input: CreateEscalationInput): HomrEscalation {
  const db = getDb();
  const id = generateId('homr_esc');
  const timestamp = now();

  db.prepare(`
    INSERT INTO homr_escalations (
      id, outcome_id, created_at, status,
      trigger_type, trigger_task_id, trigger_evidence,
      question_text, question_context, question_options,
      affected_tasks
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.outcome_id,
    timestamp,
    input.trigger_type,
    input.trigger_task_id,
    JSON.stringify(input.trigger_evidence),
    input.question_text,
    input.question_context,
    JSON.stringify(input.question_options),
    JSON.stringify(input.affected_tasks)
  );

  // Increment counter in context store
  incrementHomrContextStat(input.outcome_id, 'escalations_created');

  return getEscalationById(id)!;
}

/**
 * Get an escalation by ID
 */
export function getEscalationById(id: string): HomrEscalation | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM homr_escalations WHERE id = ?
  `).get(id) as HomrEscalation | undefined;

  return row || null;
}

/**
 * Get pending escalations for an outcome
 */
export function getPendingEscalations(outcomeId: string): HomrEscalation[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM homr_escalations
    WHERE outcome_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).all(outcomeId) as HomrEscalation[];
}

/**
 * Get all escalations for an outcome
 */
export function getEscalations(outcomeId: string, limit: number = 20): HomrEscalation[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM homr_escalations
    WHERE outcome_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as HomrEscalation[];
}

/**
 * Answer an escalation
 */
export function answerEscalation(
  escalationId: string,
  answerOption: string,
  answerContext?: string
): HomrEscalation {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE homr_escalations
    SET status = 'answered', answer_option = ?, answer_context = ?, answered_at = ?
    WHERE id = ?
  `).run(answerOption, answerContext || null, timestamp, escalationId);

  return getEscalationById(escalationId)!;
}

/**
 * Dismiss an escalation
 */
export function dismissEscalation(escalationId: string): HomrEscalation {
  const db = getDb();
  const timestamp = now();

  db.prepare(`
    UPDATE homr_escalations
    SET status = 'dismissed', answered_at = ?
    WHERE id = ?
  `).run(timestamp, escalationId);

  return getEscalationById(escalationId)!;
}

/**
 * Mark escalations as incorporated into an improvement outcome.
 * This prevents them from being re-analyzed in future improvement runs.
 */
export function markEscalationsAsIncorporated(
  escalationIds: string[],
  improvementOutcomeId: string
): number {
  if (escalationIds.length === 0) return 0;

  const db = getDb();
  const timestamp = now();

  const stmt = db.prepare(`
    UPDATE homr_escalations
    SET incorporated_into_outcome_id = ?, incorporated_at = ?
    WHERE id = ? AND incorporated_into_outcome_id IS NULL
  `);

  let count = 0;
  for (const id of escalationIds) {
    const result = stmt.run(improvementOutcomeId, timestamp, id);
    if (result.changes > 0) count++;
  }

  return count;
}

/**
 * Mark escalations by trigger type as incorporated.
 * Used when creating improvements from trigger type clusters.
 */
export function markEscalationsByTriggerTypeAsIncorporated(
  triggerTypes: string[],
  improvementOutcomeId: string,
  lookbackMs?: number
): number {
  if (triggerTypes.length === 0) return 0;

  const db = getDb();
  const timestamp = now();

  // Build query with optional time filter
  let query = `
    UPDATE homr_escalations
    SET incorporated_into_outcome_id = ?, incorporated_at = ?
    WHERE trigger_type IN (${triggerTypes.map(() => '?').join(', ')})
      AND incorporated_into_outcome_id IS NULL
  `;

  const params: (string | number)[] = [improvementOutcomeId, timestamp, ...triggerTypes];

  if (lookbackMs) {
    const cutoff = timestamp - lookbackMs;
    query += ` AND created_at >= ?`;
    params.push(cutoff);
  }

  const result = db.prepare(query).run(...params);
  return result.changes;
}

/**
 * Get count of escalations not yet incorporated (available for analysis)
 */
export function getUnincorporatedEscalationCount(lookbackDays: number = 30): number {
  const db = getDb();
  const cutoff = now() - (lookbackDays * 24 * 60 * 60 * 1000);

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM homr_escalations
    WHERE created_at >= ? AND incorporated_into_outcome_id IS NULL
  `).get(cutoff) as { count: number };

  return result.count;
}

/**
 * Get escalations for analysis (excluding already incorporated ones)
 */
export function getEscalationsForAnalysis(
  lookbackDays: number = 30,
  outcomeId?: string
): HomrEscalation[] {
  const db = getDb();
  const cutoff = now() - (lookbackDays * 24 * 60 * 60 * 1000);

  let query = `
    SELECT * FROM homr_escalations
    WHERE created_at >= ? AND incorporated_into_outcome_id IS NULL
  `;
  const params: (string | number)[] = [cutoff];

  if (outcomeId) {
    query += ` AND outcome_id = ?`;
    params.push(outcomeId);
  }

  query += ` ORDER BY created_at DESC`;

  return db.prepare(query).all(...params) as HomrEscalation[];
}

// ============================================================================
// Activity Log Operations
// ============================================================================

export interface LogActivityInput {
  outcome_id: string;
  type: HomrActivityType;
  details: Record<string, unknown>;
  summary: string;
}

/**
 * Log a HOMЯ activity
 */
export function logHomrActivity(input: LogActivityInput): HomrActivityLogEntry {
  const db = getDb();
  const id = generateId('homr_act');
  const timestamp = now();

  db.prepare(`
    INSERT INTO homr_activity_log (id, outcome_id, created_at, type, details, summary)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.outcome_id,
    timestamp,
    input.type,
    JSON.stringify(input.details),
    input.summary
  );

  return getActivityById(id)!;
}

/**
 * Get an activity log entry by ID
 */
export function getActivityById(id: string): HomrActivityLogEntry | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM homr_activity_log WHERE id = ?
  `).get(id) as HomrActivityLogEntry | undefined;

  return row || null;
}

/**
 * Get recent activity for an outcome
 */
export function getHomrActivity(
  outcomeId: string,
  limit: number = 20,
  type?: HomrActivityType
): HomrActivityLogEntry[] {
  const db = getDb();

  if (type) {
    return db.prepare(`
      SELECT * FROM homr_activity_log
      WHERE outcome_id = ? AND type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(outcomeId, type, limit) as HomrActivityLogEntry[];
  }

  return db.prepare(`
    SELECT * FROM homr_activity_log
    WHERE outcome_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as HomrActivityLogEntry[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if HOMЯ is enabled for an outcome
 */
export function isHomrEnabled(outcomeId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT supervisor_enabled FROM outcomes WHERE id = ?
  `).get(outcomeId) as { supervisor_enabled: number } | undefined;

  // HOMЯ is enabled when supervisor is enabled (they share the same setting)
  return row?.supervisor_enabled === 1;
}

/**
 * Get HOMЯ status summary for an outcome
 */
export interface HomrStatus {
  enabled: boolean;
  context: {
    discoveries: number;
    decisions: number;
    constraints: number;
  };
  stats: {
    tasksObserved: number;
    discoveriesExtracted: number;
    escalationsCreated: number;
    steeringActions: number;
  };
  pendingEscalations: number;
}

export function getHomrStatus(outcomeId: string): HomrStatus {
  const enabled = isHomrEnabled(outcomeId);
  const context = getHomrContext(outcomeId);
  const pending = getPendingEscalations(outcomeId);

  if (!context) {
    return {
      enabled,
      context: { discoveries: 0, decisions: 0, constraints: 0 },
      stats: { tasksObserved: 0, discoveriesExtracted: 0, escalationsCreated: 0, steeringActions: 0 },
      pendingEscalations: 0,
    };
  }

  const discoveries: HomrDiscovery[] = JSON.parse(context.discoveries);
  const decisions: HomrDecision[] = JSON.parse(context.decisions);
  const constraints: HomrConstraint[] = JSON.parse(context.constraints);

  return {
    enabled,
    context: {
      discoveries: discoveries.length,
      decisions: decisions.length,
      constraints: constraints.length,
    },
    stats: {
      tasksObserved: context.tasks_observed,
      discoveriesExtracted: context.discoveries_extracted,
      escalationsCreated: context.escalations_created,
      steeringActions: context.steering_actions,
    },
    pendingEscalations: pending.length,
  };
}

/**
 * Parse a HomrObservation from database format to structured format
 */
export function parseObservation(obs: HomrObservation): {
  id: string;
  outcomeId: string;
  taskId: string;
  createdAt: number;
  onTrack: boolean;
  alignmentScore: number;
  quality: HomrQuality;
  drift: HomrDriftItem[];
  discoveries: HomrDiscovery[];
  issues: HomrQualityIssue[];
  hasAmbiguity: boolean;
  ambiguityData: HomrAmbiguitySignal | null;
  summary: string;
} {
  return {
    id: obs.id,
    outcomeId: obs.outcome_id,
    taskId: obs.task_id,
    createdAt: obs.created_at,
    onTrack: obs.on_track === 1,
    alignmentScore: obs.alignment_score,
    quality: obs.quality,
    drift: safeJsonParse(obs.drift, []),
    discoveries: safeJsonParse(obs.discoveries, []),
    issues: safeJsonParse(obs.issues, []),
    hasAmbiguity: obs.has_ambiguity === 1,
    ambiguityData: obs.ambiguity_data ? safeJsonParse(obs.ambiguity_data, null) : null,
    summary: obs.summary,
  };
}

/**
 * Safely parse JSON with a fallback value
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json || json === '') return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    console.error('[HOMЯ DB] Failed to parse JSON:', json?.substring(0, 100));
    return fallback;
  }
}

/**
 * Parse a HomrEscalation from database format to structured format
 */
export function parseEscalation(esc: HomrEscalation): {
  id: string;
  outcomeId: string;
  createdAt: number;
  status: HomrEscalationStatus;
  trigger: {
    type: string;
    taskId: string;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: HomrQuestionOption[];
  };
  affectedTasks: string[];
  answer?: {
    option: string;
    context: string | null;
    answeredAt: number;
  };
} {
  return {
    id: esc.id,
    outcomeId: esc.outcome_id,
    createdAt: esc.created_at,
    status: esc.status,
    trigger: {
      type: esc.trigger_type,
      taskId: esc.trigger_task_id,
      evidence: safeJsonParse(esc.trigger_evidence, []),
    },
    question: {
      text: esc.question_text,
      context: esc.question_context,
      options: safeJsonParse(esc.question_options, []),
    },
    affectedTasks: safeJsonParse(esc.affected_tasks, []),
    answer: esc.answered_at ? {
      option: esc.answer_option!,
      context: esc.answer_context,
      answeredAt: esc.answered_at,
    } : undefined,
  };
}
