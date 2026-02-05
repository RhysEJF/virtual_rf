/**
 * Context Resolver Agent
 *
 * Resolves implicit references in user messages for the conversational API.
 * Handles pronoun resolution, implicit outcome inference, and temporal references.
 *
 * This module enriches user messages with resolved entity IDs and context
 * before passing them to the intent classifier.
 */

import {
  EnhancedSessionContext,
  ReferencedEntitiesMap,
  ReferencedEntity,
  ReferencedEntityType,
  PreviousIntent,
  ConversationTopic,
} from '../db/sessions';
import { ConversationMessage, ConversationRole } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * An enriched message with resolved entities and context.
 * This is passed to the intent classifier for better accuracy.
 */
export interface EnrichedMessage {
  /** The original user message */
  originalMessage: string;

  /** The message with pronouns/references replaced with actual IDs/names */
  resolvedMessage: string;

  /** Entities that were resolved from implicit references */
  resolvedEntities: ResolvedEntities;

  /** Whether any resolution was performed */
  wasResolved: boolean;

  /** Confidence in the resolution (0.0 - 1.0) */
  resolutionConfidence: number;

  /** Debug info about what was resolved and how */
  resolutionDetails?: ResolutionDetail[];
}

/**
 * Entities resolved from implicit references in the message
 */
export interface ResolvedEntities {
  outcome_id?: string;
  outcome_name?: string;
  worker_id?: string;
  task_id?: string;
  escalation_id?: string;
}

/**
 * Detail about a single resolution operation
 */
export interface ResolutionDetail {
  type: 'pronoun' | 'implicit_outcome' | 'temporal';
  original: string;
  resolved: string;
  entityType: ReferencedEntityType | 'message';
  confidence: number;
}

/**
 * Session context for resolution operations
 */
export interface SessionContext {
  sessionId: string;
  currentOutcomeId: string | null;
  conversationTopic: ConversationTopic;
  previousIntents: PreviousIntent[];
  referencedEntities: ReferencedEntitiesMap;
}

/**
 * Message history entry for temporal reference resolution
 */
export interface MessageHistoryEntry {
  role: ConversationRole;
  content: string;
  timestamp: number;
  metadata?: {
    intent?: string;
    entities?: Record<string, string>;
  };
}

// ============================================================================
// Pronoun Patterns
// ============================================================================

/**
 * Patterns for detecting pronouns and references that need resolution
 */
const PRONOUN_PATTERNS: Array<{
  pattern: RegExp;
  entityTypes: ReferencedEntityType[];
  priority: number;
}> = [
  // Direct pronouns referring to entities
  { pattern: /\b(it|this|that)\b/gi, entityTypes: ['outcome', 'task', 'worker', 'escalation'], priority: 1 },
  { pattern: /\b(them|those|these)\b/gi, entityTypes: ['outcome', 'task'], priority: 2 },

  // Outcome-specific references
  { pattern: /\b(the project|this project|that project)\b/gi, entityTypes: ['outcome'], priority: 10 },
  { pattern: /\b(the outcome|this outcome|that outcome)\b/gi, entityTypes: ['outcome'], priority: 10 },
  { pattern: /\b(my project|my outcome)\b/gi, entityTypes: ['outcome'], priority: 9 },

  // Task-specific references
  { pattern: /\b(the task|this task|that task)\b/gi, entityTypes: ['task'], priority: 10 },
  { pattern: /\b(my task|current task)\b/gi, entityTypes: ['task'], priority: 9 },

  // Worker-specific references
  { pattern: /\b(the worker|this worker|that worker)\b/gi, entityTypes: ['worker'], priority: 10 },
  { pattern: /\b(my worker|current worker)\b/gi, entityTypes: ['worker'], priority: 9 },

  // Escalation-specific references
  { pattern: /\b(the question|this question|that question)\b/gi, entityTypes: ['escalation'], priority: 10 },
  { pattern: /\b(the escalation|this escalation)\b/gi, entityTypes: ['escalation'], priority: 10 },
];

/**
 * Patterns for implicit actions that need outcome context
 */
const IMPLICIT_OUTCOME_PATTERNS: RegExp[] = [
  /^start$/i,
  /^start work(?:ing)?$/i,
  /^start (?:a |the )?worker$/i,
  /^run$/i,
  /^go$/i,
  /^execute$/i,
  /^begin$/i,
  /^pause$/i,
  /^stop$/i,
  /^resume$/i,
  /^show tasks$/i,
  /^list tasks$/i,
  /^what tasks/i,
  /^check (?:the )?status$/i,
  /^how(?:'s| is) it going/i,
];

/**
 * Temporal reference patterns
 */
const TEMPORAL_PATTERNS: Array<{
  pattern: RegExp;
  type: 'last_task' | 'last_outcome' | 'previous_request' | 'last_worker' | 'recent';
  lookback: number; // How many messages/entries to look back
}> = [
  { pattern: /\b(the last task|my last task|previous task)\b/gi, type: 'last_task', lookback: 5 },
  { pattern: /\b(the last outcome|my last outcome|previous outcome|last project)\b/gi, type: 'last_outcome', lookback: 5 },
  { pattern: /\b(my previous request|my last request|what i asked|earlier)\b/gi, type: 'previous_request', lookback: 3 },
  { pattern: /\b(the last worker|previous worker)\b/gi, type: 'last_worker', lookback: 5 },
  { pattern: /\b(recent|recently|just now)\b/gi, type: 'recent', lookback: 3 },
];

// ============================================================================
// Resolution Functions
// ============================================================================

/**
 * Resolve pronouns and references in a user message.
 *
 * Replaces "it", "that", "the project", etc. with actual IDs/names from context.
 *
 * @param message - The user's message
 * @param referencedEntities - Map of recently mentioned entities by type
 * @returns The message with pronouns replaced, plus resolution details
 */
export function resolvePronouns(
  message: string,
  referencedEntities: ReferencedEntitiesMap
): {
  resolvedMessage: string;
  resolvedEntities: ResolvedEntities;
  details: ResolutionDetail[];
} {
  let resolvedMessage = message;
  const resolvedEntities: ResolvedEntities = {};
  const details: ResolutionDetail[] = [];

  // Sort patterns by priority (higher = more specific = resolve first)
  const sortedPatterns = [...PRONOUN_PATTERNS].sort((a, b) => b.priority - a.priority);

  for (const { pattern, entityTypes, priority } of sortedPatterns) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(message)) !== null) {
      const original = match[0];

      // Find the best matching entity from the allowed types
      const entity = findBestMatchingEntity(referencedEntities, entityTypes);

      if (entity) {
        // Calculate confidence based on priority and recency
        const ageMinutes = (Date.now() - entity.mentionedAt) / (1000 * 60);
        const recencyFactor = Math.max(0, 1 - ageMinutes / 10); // Decays over 10 minutes
        const confidence = Math.min(1, (priority / 10) * 0.5 + recencyFactor * 0.5);

        // Only resolve if confidence is high enough
        if (confidence >= 0.3) {
          // Use name if available, otherwise use ID
          const replacement = entity.name || entity.id;

          // Replace in the message (case-insensitive replacement)
          const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          resolvedMessage = resolvedMessage.replace(
            new RegExp(escapedOriginal, 'i'),
            replacement
          );

          // Track resolved entity
          updateResolvedEntities(resolvedEntities, entity);

          // Record resolution detail
          details.push({
            type: 'pronoun',
            original,
            resolved: replacement,
            entityType: entity.type,
            confidence,
          });
        }
      }
    }
  }

  return { resolvedMessage, resolvedEntities, details };
}

/**
 * Infer the implicit outcome when user says things like "start a worker"
 * without specifying which outcome.
 *
 * @param message - The user's message
 * @param sessionContext - Current session context
 * @returns The inferred outcome ID (if any) and confidence
 */
export function inferImplicitOutcome(
  message: string,
  sessionContext: SessionContext
): {
  outcomeId: string | null;
  confidence: number;
  reasoning: string;
} {
  const lowerMessage = message.toLowerCase().trim();

  // Check if message matches implicit patterns
  const matchesImplicitPattern = IMPLICIT_OUTCOME_PATTERNS.some(
    pattern => pattern.test(lowerMessage)
  );

  if (!matchesImplicitPattern) {
    return {
      outcomeId: null,
      confidence: 0,
      reasoning: 'Message does not match implicit outcome patterns',
    };
  }

  // Strategy 1: Use current outcome ID from session
  if (sessionContext.currentOutcomeId) {
    return {
      outcomeId: sessionContext.currentOutcomeId,
      confidence: 0.9,
      reasoning: 'Using current session outcome context',
    };
  }

  // Strategy 2: Use recently referenced outcome
  const recentOutcome = sessionContext.referencedEntities.outcome;
  if (recentOutcome && recentOutcome.id) {
    const ageMinutes = (Date.now() - recentOutcome.mentionedAt) / (1000 * 60);
    const confidence = Math.max(0.5, 0.85 - ageMinutes / 20); // Decays from 0.85 over 20 min

    return {
      outcomeId: recentOutcome.id,
      confidence,
      reasoning: `Using recently mentioned outcome (${Math.round(ageMinutes)} min ago)`,
    };
  }

  // Strategy 3: Infer from conversation topic and previous intents
  if (sessionContext.conversationTopic === 'outcome_management') {
    const recentOutcomeIntent = sessionContext.previousIntents.find(
      intent =>
        ['show_outcome', 'list_tasks', 'start_worker'].includes(intent.type) &&
        intent.entities.outcome_id
    );

    if (recentOutcomeIntent) {
      const outcomeId = recentOutcomeIntent.entities.outcome_id;
      if (outcomeId) {
        const ageMinutes = (Date.now() - recentOutcomeIntent.timestamp) / (1000 * 60);
        const confidence = Math.max(0.4, 0.75 - ageMinutes / 15);

        return {
          outcomeId,
          confidence,
          reasoning: `Inferred from previous ${recentOutcomeIntent.type} intent`,
        };
      }
    }
  }

  // No outcome could be inferred
  return {
    outcomeId: null,
    confidence: 0,
    reasoning: 'No outcome context available to infer from',
  };
}

/**
 * Resolve temporal references like "the last task", "my previous request", etc.
 *
 * @param message - The user's message
 * @param messageHistory - Recent message history
 * @returns Resolution result with temporal context
 */
export function resolveTemporalReferences(
  message: string,
  messageHistory: MessageHistoryEntry[]
): {
  resolvedMessage: string;
  resolvedEntities: ResolvedEntities;
  details: ResolutionDetail[];
} {
  let resolvedMessage = message;
  const resolvedEntities: ResolvedEntities = {};
  const details: ResolutionDetail[] = [];

  for (const { pattern, type, lookback } of TEMPORAL_PATTERNS) {
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(message)) !== null) {
      const original = match[0];

      // Look through message history for the referenced item
      const resolution = resolveTemporalReference(type, messageHistory, lookback);

      if (resolution) {
        resolvedMessage = resolvedMessage.replace(original, resolution.resolved);

        if (resolution.entityType !== 'message') {
          updateResolvedEntitiesFromTemporal(resolvedEntities, resolution);
        }

        details.push({
          type: 'temporal',
          original,
          resolved: resolution.resolved,
          entityType: resolution.entityType,
          confidence: resolution.confidence,
        });
      }
    }
  }

  return { resolvedMessage, resolvedEntities, details };
}

// ============================================================================
// Main Resolution Function
// ============================================================================

/**
 * Resolve all implicit references in a user message.
 *
 * This is the main entry point that combines pronoun resolution,
 * implicit outcome inference, and temporal reference resolution.
 *
 * @param message - The user's message
 * @param sessionContext - Current session context
 * @param messageHistory - Recent message history (optional)
 * @returns EnrichedMessage with all resolutions applied
 */
export function resolveImplicitReferences(
  message: string,
  sessionContext: SessionContext,
  messageHistory: MessageHistoryEntry[] = []
): EnrichedMessage {
  const details: ResolutionDetail[] = [];
  const resolvedEntities: ResolvedEntities = {};
  let currentMessage = message;

  // Step 1: Resolve pronouns
  const pronounResult = resolvePronouns(currentMessage, sessionContext.referencedEntities);
  currentMessage = pronounResult.resolvedMessage;
  Object.assign(resolvedEntities, pronounResult.resolvedEntities);
  details.push(...pronounResult.details);

  // Step 2: Resolve temporal references
  if (messageHistory.length > 0) {
    const temporalResult = resolveTemporalReferences(currentMessage, messageHistory);
    currentMessage = temporalResult.resolvedMessage;
    Object.assign(resolvedEntities, temporalResult.resolvedEntities);
    details.push(...temporalResult.details);
  }

  // Step 3: Infer implicit outcome if needed
  const implicitOutcome = inferImplicitOutcome(message, sessionContext);
  if (implicitOutcome.outcomeId && implicitOutcome.confidence >= 0.5) {
    if (!resolvedEntities.outcome_id) {
      resolvedEntities.outcome_id = implicitOutcome.outcomeId;
    }
    details.push({
      type: 'implicit_outcome',
      original: message,
      resolved: `[outcome: ${implicitOutcome.outcomeId}]`,
      entityType: 'outcome',
      confidence: implicitOutcome.confidence,
    });
  }

  // Calculate overall resolution confidence
  const wasResolved = details.length > 0;
  const resolutionConfidence = wasResolved
    ? details.reduce((sum, d) => sum + d.confidence, 0) / details.length
    : 1; // 1.0 if no resolution needed (message was clear)

  return {
    originalMessage: message,
    resolvedMessage: currentMessage,
    resolvedEntities,
    wasResolved,
    resolutionConfidence,
    resolutionDetails: wasResolved ? details : undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the best matching entity from a list of allowed types.
 * Prefers more recently mentioned entities.
 */
function findBestMatchingEntity(
  entities: ReferencedEntitiesMap,
  allowedTypes: ReferencedEntityType[]
): ReferencedEntity | null {
  let bestEntity: ReferencedEntity | null = null;
  let bestScore = -1;

  for (const type of allowedTypes) {
    const entity = entities[type];
    if (entity && entity.id) {
      // Score based on recency (more recent = higher score)
      const ageMs = Date.now() - entity.mentionedAt;
      const score = 1 / (1 + ageMs / (60 * 1000)); // Decay over 1 minute

      if (score > bestScore) {
        bestScore = score;
        bestEntity = entity;
      }
    }
  }

  // Also check lastMentioned as a fallback
  if (!bestEntity && entities.lastMentioned) {
    const lastMentioned = entities.lastMentioned;
    if (allowedTypes.includes(lastMentioned.type)) {
      bestEntity = lastMentioned;
    }
  }

  return bestEntity;
}

/**
 * Update resolved entities map with a newly resolved entity.
 */
function updateResolvedEntities(
  resolved: ResolvedEntities,
  entity: ReferencedEntity
): void {
  switch (entity.type) {
    case 'outcome':
      resolved.outcome_id = entity.id;
      if (entity.name) resolved.outcome_name = entity.name;
      break;
    case 'worker':
      resolved.worker_id = entity.id;
      break;
    case 'task':
      resolved.task_id = entity.id;
      break;
    case 'escalation':
      resolved.escalation_id = entity.id;
      break;
  }
}

/**
 * Update resolved entities from a temporal resolution.
 */
function updateResolvedEntitiesFromTemporal(
  resolved: ResolvedEntities,
  resolution: { entityType: ReferencedEntityType | 'message'; entityId?: string }
): void {
  if (!resolution.entityId) return;

  switch (resolution.entityType) {
    case 'outcome':
      resolved.outcome_id = resolution.entityId;
      break;
    case 'worker':
      resolved.worker_id = resolution.entityId;
      break;
    case 'task':
      resolved.task_id = resolution.entityId;
      break;
    case 'escalation':
      resolved.escalation_id = resolution.entityId;
      break;
  }
}

/**
 * Resolve a temporal reference by looking through message history.
 */
function resolveTemporalReference(
  type: 'last_task' | 'last_outcome' | 'previous_request' | 'last_worker' | 'recent',
  history: MessageHistoryEntry[],
  lookback: number
): {
  resolved: string;
  entityType: ReferencedEntityType | 'message';
  entityId?: string;
  confidence: number;
} | null {
  const recentHistory = history.slice(-lookback);

  switch (type) {
    case 'last_task': {
      // Find the most recent task ID in history
      for (let i = recentHistory.length - 1; i >= 0; i--) {
        const taskId = recentHistory[i].metadata?.entities?.task_id;
        if (taskId) {
          return {
            resolved: taskId,
            entityType: 'task',
            entityId: taskId,
            confidence: 0.8,
          };
        }
      }
      break;
    }

    case 'last_outcome': {
      // Find the most recent outcome ID in history
      for (let i = recentHistory.length - 1; i >= 0; i--) {
        const outcomeId = recentHistory[i].metadata?.entities?.outcome_id;
        if (outcomeId) {
          return {
            resolved: outcomeId,
            entityType: 'outcome',
            entityId: outcomeId,
            confidence: 0.8,
          };
        }
      }
      break;
    }

    case 'last_worker': {
      // Find the most recent worker ID in history
      for (let i = recentHistory.length - 1; i >= 0; i--) {
        const workerId = recentHistory[i].metadata?.entities?.worker_id;
        if (workerId) {
          return {
            resolved: workerId,
            entityType: 'worker',
            entityId: workerId,
            confidence: 0.8,
          };
        }
      }
      break;
    }

    case 'previous_request': {
      // Find the last user message
      for (let i = recentHistory.length - 1; i >= 0; i--) {
        if (recentHistory[i].role === 'user') {
          return {
            resolved: `"${recentHistory[i].content}"`,
            entityType: 'message',
            confidence: 0.7,
          };
        }
      }
      break;
    }

    case 'recent': {
      // General "recent" - don't replace, just note it
      if (recentHistory.length > 0) {
        const lastMsg = recentHistory[recentHistory.length - 1];
        // Check for any entity in the last message
        if (lastMsg.metadata?.entities) {
          const entities = lastMsg.metadata.entities;
          if (entities.outcome_id) {
            return {
              resolved: entities.outcome_id,
              entityType: 'outcome',
              entityId: entities.outcome_id,
              confidence: 0.6,
            };
          }
          if (entities.task_id) {
            return {
              resolved: entities.task_id,
              entityType: 'task',
              entityId: entities.task_id,
              confidence: 0.6,
            };
          }
        }
      }
      break;
    }
  }

  return null;
}

// ============================================================================
// Utility Functions for Testing
// ============================================================================

/**
 * Check if a message likely contains implicit references that need resolution.
 * Useful for deciding whether to invoke the full resolution pipeline.
 */
export function hasImplicitReferences(message: string): boolean {
  const lower = message.toLowerCase();

  // Check pronoun patterns
  for (const { pattern } of PRONOUN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(lower)) {
      return true;
    }
  }

  // Check implicit outcome patterns
  for (const pattern of IMPLICIT_OUTCOME_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  // Check temporal patterns
  for (const { pattern } of TEMPORAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(lower)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract any explicit entity IDs from a message (not implicit references).
 * These take precedence over resolved references.
 */
export function extractExplicitEntityIds(message: string): ResolvedEntities {
  const entities: ResolvedEntities = {};

  // Match explicit ID patterns
  const outcomeMatch = message.match(/\bout_[a-zA-Z0-9_]+\b/);
  if (outcomeMatch) entities.outcome_id = outcomeMatch[0];

  const workerMatch = message.match(/\bworker_[a-zA-Z0-9_]+\b/);
  if (workerMatch) entities.worker_id = workerMatch[0];

  const taskMatch = message.match(/\btask_[a-zA-Z0-9_]+\b/);
  if (taskMatch) entities.task_id = taskMatch[0];

  const escalationMatch = message.match(/\besc_[a-zA-Z0-9_]+\b/);
  if (escalationMatch) entities.escalation_id = escalationMatch[0];

  return entities;
}

/**
 * Merge explicit and resolved entities, preferring explicit ones.
 */
export function mergeEntities(
  explicit: ResolvedEntities,
  resolved: ResolvedEntities
): ResolvedEntities {
  return {
    outcome_id: explicit.outcome_id || resolved.outcome_id,
    outcome_name: explicit.outcome_name || resolved.outcome_name,
    worker_id: explicit.worker_id || resolved.worker_id,
    task_id: explicit.task_id || resolved.task_id,
    escalation_id: explicit.escalation_id || resolved.escalation_id,
  };
}
