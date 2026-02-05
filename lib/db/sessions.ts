/**
 * Session and message database operations
 *
 * Provides CRUD operations for conversation_sessions and conversation_messages tables.
 * This module provides the specific API interface for the Conversational API feature.
 *
 * Tables:
 * - conversation_sessions: Multi-turn session state management
 * - conversation_messages: Individual messages within sessions
 */

import { getDb, now } from './index';
import {
  ConversationSession,
  ConversationMessage,
  ConversationRole,
  ParsedConversationSession,
  ParsedConversationMessage,
} from './schema';

// ============================================================================
// Enhanced Session Context Types
// ============================================================================

/**
 * Represents a classified intent with its entities, stored in session history.
 * Used to track the last N intents for context-aware classification.
 */
export interface PreviousIntent {
  type: string;              // Intent type (e.g., 'create_outcome', 'show_outcome')
  confidence: number;        // 0.0 - 1.0
  entities: Record<string, string | undefined>;  // Extracted entities
  timestamp: number;         // When this intent was classified
}

/**
 * Entity types that can be referenced by pronouns in conversation.
 */
export type ReferencedEntityType = 'outcome' | 'worker' | 'task' | 'escalation';

/**
 * A referenced entity that can be resolved via pronouns.
 * Stores enough info to resolve "it", "that", "the outcome", etc.
 */
export interface ReferencedEntity {
  type: ReferencedEntityType;
  id: string;                // The entity's ID (out_xxx, worker_xxx, etc.)
  name?: string;             // Human-readable name if available
  mentionedAt: number;       // Timestamp when last mentioned
}

/**
 * Map of recently mentioned entities by type.
 * Enables pronoun resolution like "start it" → start the last mentioned outcome.
 */
export interface ReferencedEntitiesMap {
  outcome?: ReferencedEntity;
  worker?: ReferencedEntity;
  task?: ReferencedEntity;
  escalation?: ReferencedEntity;
  // Generic "last mentioned" for when type is ambiguous
  lastMentioned?: ReferencedEntity;
}

/**
 * High-level conversation topics for context-aware responses.
 */
export type ConversationTopic =
  | 'outcome_management'     // Creating, viewing, managing outcomes
  | 'task_management'        // Working with tasks
  | 'worker_management'      // Starting, stopping, monitoring workers
  | 'escalation_handling'    // Answering escalations
  | 'status_check'           // System status inquiries
  | 'iteration'              // Providing feedback on completed work
  | 'general'                // General conversation
  | null;                    // No clear topic yet

/**
 * Enhanced session context structure stored in the context JSON field.
 * Extends the basic context with intent history and entity tracking.
 */
export interface EnhancedSessionContext {
  // Intent history - last 5 classified intents with their entities
  previous_intents: PreviousIntent[];

  // Entity tracking - recently mentioned entities for pronoun resolution
  referenced_entities: ReferencedEntitiesMap;

  // Current conversation topic for context-aware responses
  conversation_topic: ConversationTopic;

  // Legacy fields (for backwards compatibility)
  lastEscalationQuestion?: string;
  pendingEscalationId?: string;

  // Any other dynamic context properties
  [key: string]: unknown;
}

/**
 * Rich context object aggregating session state, message history, and outcome state.
 * Passed to the intent classifier for context-aware classification.
 */
export interface EnrichedContext {
  // Session-level context
  sessionId: string;
  currentOutcomeId: string | null;
  conversationTopic: ConversationTopic;

  // Intent history for pattern recognition
  previousIntents: PreviousIntent[];
  recentIntentTypes: string[];  // Just the types for quick lookup

  // Entity resolution context
  referencedEntities: ReferencedEntitiesMap;

  // Escalation state
  hasActiveOutcome: boolean;
  activeOutcomeId?: string;
  hasPendingEscalations: boolean;
  lastEscalationQuestion?: string;
  pendingEscalationId?: string;

  // Recent message summary
  recentMessages: Array<{
    role: ConversationRole;
    content: string;
    timestamp: number;
  }>;
  messageCount: number;
}

// Maximum number of previous intents to store
const MAX_PREVIOUS_INTENTS = 5;

// Maximum age for referenced entities (10 minutes in milliseconds)
const REFERENCED_ENTITY_MAX_AGE_MS = 10 * 60 * 1000;

// ============================================================================
// Constants
// ============================================================================

/**
 * Session expiration time in milliseconds (30 minutes)
 */
export const SESSION_EXPIRATION_MS = 30 * 60 * 1000;

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// Session Cleanup (must be defined before createSession which calls it)
// ============================================================================

/**
 * Delete expired sessions and their messages (cascade handles messages)
 */
export function deleteExpiredSessions(): number {
  const db = getDb();
  const timestamp = now();
  const result = db.prepare(`
    DELETE FROM conversation_sessions
    WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(timestamp);

  return result.changes;
}

/**
 * Cleanup expired sessions - alias for deleteExpiredSessions
 * Sessions expire after 30 minutes of inactivity
 */
export function cleanupExpiredSessions(): number {
  return deleteExpiredSessions();
}

// ============================================================================
// Session Operations (conversation_sessions table)
// ============================================================================

export interface CreateSessionInput {
  userId?: string | null;
  currentOutcomeId?: string | null;
  context?: Record<string, unknown>;
  expiresAt?: number | null;
}

/**
 * Create a new conversation session
 *
 * By default, sessions expire after 30 minutes of inactivity.
 * Cleanup of expired sessions is triggered on each new session creation.
 */
export function createSession(input: CreateSessionInput = {}): ConversationSession {
  const db = getDb();
  const timestamp = now();
  const id = generateSessionId();

  // Cleanup expired sessions on each new session creation
  cleanupExpiredSessions();

  // Auto-set expiration to 30 minutes from now if not explicitly provided
  const expiresAt = input.expiresAt !== undefined
    ? input.expiresAt
    : timestamp + SESSION_EXPIRATION_MS;

  const session: ConversationSession = {
    id,
    user_id: input.userId ?? null,
    current_outcome_id: input.currentOutcomeId ?? null,
    context: JSON.stringify(input.context ?? {}),
    created_at: timestamp,
    last_activity_at: timestamp,
    expires_at: expiresAt,
  };

  db.prepare(`
    INSERT INTO conversation_sessions (id, user_id, current_outcome_id, context, created_at, last_activity_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.user_id,
    session.current_outcome_id,
    session.context,
    session.created_at,
    session.last_activity_at,
    session.expires_at
  );

  return session;
}

/**
 * Get a session by ID
 */
export function getSessionById(sessionId: string): ConversationSession | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM conversation_sessions WHERE id = ?
  `).get(sessionId) as ConversationSession | undefined;

  return row ?? null;
}

/**
 * Get a session by ID with parsed context
 */
export function getSessionByIdParsed(sessionId: string): ParsedConversationSession | null {
  const session = getSessionById(sessionId);
  if (!session) return null;

  return {
    ...session,
    context: JSON.parse(session.context) as Record<string, unknown>,
  };
}

/**
 * Update session context (merges with existing context)
 *
 * Also extends the session expiration by 30 minutes.
 */
export function updateSessionContext(
  sessionId: string,
  contextUpdates: Record<string, unknown>
): ConversationSession | null {
  const db = getDb();
  const timestamp = now();
  const newExpiresAt = timestamp + SESSION_EXPIRATION_MS;

  const existing = getSessionById(sessionId);
  if (!existing) return null;

  // Parse existing context and merge with updates
  const existingContext = JSON.parse(existing.context) as Record<string, unknown>;
  const newContext = { ...existingContext, ...contextUpdates };

  db.prepare(`
    UPDATE conversation_sessions
    SET context = ?, last_activity_at = ?, expires_at = ?
    WHERE id = ?
  `).run(JSON.stringify(newContext), timestamp, newExpiresAt, sessionId);

  return getSessionById(sessionId);
}

/**
 * Add a classified intent to the session's intent history.
 * Maintains a rolling window of the last MAX_PREVIOUS_INTENTS intents.
 */
export function addIntentToHistory(
  sessionId: string,
  intent: Omit<PreviousIntent, 'timestamp'>
): ConversationSession | null {
  const session = getSessionByIdParsed(sessionId);
  if (!session) return null;

  const timestamp = now();
  const context = session.context as EnhancedSessionContext;

  // Initialize previous_intents if not present
  const previousIntents: PreviousIntent[] = context.previous_intents || [];

  // Add new intent with timestamp
  const newIntent: PreviousIntent = {
    type: intent.type,
    confidence: intent.confidence,
    entities: intent.entities,
    timestamp,
  };

  // Add to front and trim to max size
  previousIntents.unshift(newIntent);
  if (previousIntents.length > MAX_PREVIOUS_INTENTS) {
    previousIntents.pop();
  }

  // Update conversation topic based on intent
  const conversationTopic = inferTopicFromIntent(intent.type);

  return updateSessionContext(sessionId, {
    previous_intents: previousIntents,
    conversation_topic: conversationTopic,
  });
}

/**
 * Track a referenced entity for pronoun resolution.
 * Updates both the specific type slot and the lastMentioned slot.
 */
export function trackReferencedEntity(
  sessionId: string,
  entity: Omit<ReferencedEntity, 'mentionedAt'>
): ConversationSession | null {
  const session = getSessionByIdParsed(sessionId);
  if (!session) return null;

  const timestamp = now();
  const context = session.context as EnhancedSessionContext;

  // Initialize referenced_entities if not present
  const referencedEntities: ReferencedEntitiesMap = context.referenced_entities || {};

  // Create the entity record
  const entityRecord: ReferencedEntity = {
    ...entity,
    mentionedAt: timestamp,
  };

  // Update the type-specific slot
  referencedEntities[entity.type] = entityRecord;

  // Update the generic lastMentioned slot
  referencedEntities.lastMentioned = entityRecord;

  return updateSessionContext(sessionId, {
    referenced_entities: referencedEntities,
  });
}

/**
 * Track multiple entities mentioned in a single message.
 * Extracts entity references from intent entities and updates the session.
 */
export function trackEntitiesFromIntent(
  sessionId: string,
  entities: Record<string, string | undefined>,
  entityNames?: Record<string, string>  // Optional ID-to-name mappings
): ConversationSession | null {
  const session = getSessionByIdParsed(sessionId);
  if (!session) return null;

  const timestamp = now();
  const context = session.context as EnhancedSessionContext;
  const referencedEntities: ReferencedEntitiesMap = context.referenced_entities || {};

  // Map entity keys to types
  const entityMappings: Array<{ key: string; type: ReferencedEntityType }> = [
    { key: 'outcome_id', type: 'outcome' },
    { key: 'worker_id', type: 'worker' },
    { key: 'task_id', type: 'task' },
    { key: 'escalation_id', type: 'escalation' },
  ];

  let lastUpdated: ReferencedEntity | undefined;

  for (const { key, type } of entityMappings) {
    const id = entities[key];
    if (id) {
      const entityRecord: ReferencedEntity = {
        type,
        id,
        name: entityNames?.[id],
        mentionedAt: timestamp,
      };
      referencedEntities[type] = entityRecord;
      lastUpdated = entityRecord;
    }
  }

  // Also check for outcome_name as a special case
  if (entities.outcome_name && !entities.outcome_id) {
    // We have a name but no ID - still track it for context
    referencedEntities.outcome = {
      type: 'outcome',
      id: '', // Empty ID - will need resolution
      name: entities.outcome_name,
      mentionedAt: timestamp,
    };
    lastUpdated = referencedEntities.outcome;
  }

  // Update lastMentioned if we tracked anything
  if (lastUpdated) {
    referencedEntities.lastMentioned = lastUpdated;
  }

  return updateSessionContext(sessionId, {
    referenced_entities: referencedEntities,
  });
}

/**
 * Get the most recently referenced entity of a specific type.
 * Returns null if no entity of that type has been mentioned or if it's too old.
 */
export function getReferencedEntity(
  sessionId: string,
  type: ReferencedEntityType
): ReferencedEntity | null {
  const session = getSessionByIdParsed(sessionId);
  if (!session) return null;

  const context = session.context as EnhancedSessionContext;
  const referencedEntities = context.referenced_entities;

  if (!referencedEntities) return null;

  const entity = referencedEntities[type];
  if (!entity) return null;

  // Check if the entity is still fresh enough
  const age = now() - entity.mentionedAt;
  if (age > REFERENCED_ENTITY_MAX_AGE_MS) {
    return null;  // Too old, don't use stale references
  }

  return entity;
}

/**
 * Infer the conversation topic from an intent type.
 */
function inferTopicFromIntent(intentType: string): ConversationTopic {
  switch (intentType) {
    case 'create_outcome':
    case 'list_outcomes':
    case 'show_outcome':
      return 'outcome_management';
    case 'list_tasks':
      return 'task_management';
    case 'start_worker':
    case 'stop_worker':
    case 'pause_worker':
      return 'worker_management';
    case 'answer_escalation':
    case 'show_escalations':
      return 'escalation_handling';
    case 'check_status':
      return 'status_check';
    case 'iterate':
      return 'iteration';
    case 'help':
    case 'general_query':
    default:
      return 'general';
  }
}

/**
 * Update session's last activity timestamp and extend expiration
 *
 * This implements a rolling expiration window - each activity extends
 * the session by another 30 minutes.
 */
export function touchSession(sessionId: string): boolean {
  const db = getDb();
  const timestamp = now();
  const newExpiresAt = timestamp + SESSION_EXPIRATION_MS;

  const result = db.prepare(`
    UPDATE conversation_sessions
    SET last_activity_at = ?, expires_at = ?
    WHERE id = ?
  `).run(timestamp, newExpiresAt, sessionId);

  return result.changes > 0;
}

/**
 * Delete a session and all its messages (cascade)
 */
export function deleteSession(sessionId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM conversation_sessions WHERE id = ?
  `).run(sessionId);

  return result.changes > 0;
}

// ============================================================================
// Additional Session Operations
// ============================================================================

/**
 * Get sessions by user ID
 */
export function getSessionsByUserId(userId: string, limit = 50): ConversationSession[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM conversation_sessions
    WHERE user_id = ?
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(userId, limit) as ConversationSession[];
}

/**
 * Get sessions by outcome ID
 */
export function getSessionsByOutcomeId(outcomeId: string, limit = 50): ConversationSession[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM conversation_sessions
    WHERE current_outcome_id = ?
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(outcomeId, limit) as ConversationSession[];
}

/**
 * Get active (non-expired) sessions
 */
export function getActiveSessions(limit = 100): ConversationSession[] {
  const db = getDb();
  const timestamp = now();
  return db.prepare(`
    SELECT * FROM conversation_sessions
    WHERE expires_at IS NULL OR expires_at > ?
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(timestamp, limit) as ConversationSession[];
}

/**
 * Check if a session exists and is not expired
 */
export function isSessionValid(sessionId: string): boolean {
  const session = getSessionById(sessionId);
  if (!session) return false;

  if (session.expires_at && session.expires_at < now()) {
    return false;
  }

  return true;
}

/**
 * Update session's current outcome
 *
 * Also extends the session expiration by 30 minutes.
 */
export function updateSessionOutcome(
  sessionId: string,
  outcomeId: string | null
): ConversationSession | null {
  const db = getDb();
  const timestamp = now();
  const newExpiresAt = timestamp + SESSION_EXPIRATION_MS;

  const result = db.prepare(`
    UPDATE conversation_sessions
    SET current_outcome_id = ?, last_activity_at = ?, expires_at = ?
    WHERE id = ?
  `).run(outcomeId, timestamp, newExpiresAt, sessionId);

  if (result.changes === 0) return null;

  return getSessionById(sessionId);
}

// ============================================================================
// Message Operations (conversation_messages table)
// ============================================================================

export interface CreateMessageInput {
  sessionId: string;
  role: ConversationRole;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new message in a session
 */
export function createMessage(input: CreateMessageInput): ConversationMessage {
  const db = getDb();
  const timestamp = now();
  const id = generateMessageId();

  const message: ConversationMessage = {
    id,
    session_id: input.sessionId,
    role: input.role,
    content: input.content,
    metadata: JSON.stringify(input.metadata ?? {}),
    created_at: timestamp,
  };

  db.prepare(`
    INSERT INTO conversation_messages (id, session_id, role, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.metadata,
    message.created_at
  );

  // Update session's last activity
  touchSession(input.sessionId);

  return message;
}

/**
 * Get all messages for a session, ordered by creation time (oldest first)
 */
export function getMessagesBySessionId(sessionId: string, limit?: number): ConversationMessage[] {
  const db = getDb();

  if (limit !== undefined) {
    return db.prepare(`
      SELECT * FROM conversation_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sessionId, limit) as ConversationMessage[];
  }

  return db.prepare(`
    SELECT * FROM conversation_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId) as ConversationMessage[];
}

/**
 * Get messages with parsed metadata
 */
export function getMessagesBySessionIdParsed(
  sessionId: string,
  limit?: number
): ParsedConversationMessage[] {
  const messages = getMessagesBySessionId(sessionId, limit);
  return messages.map(msg => ({
    ...msg,
    metadata: JSON.parse(msg.metadata) as Record<string, unknown>,
  }));
}

/**
 * Delete all messages for a session
 */
export function deleteMessagesBySessionId(sessionId: string): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM conversation_messages WHERE session_id = ?
  `).run(sessionId);

  return result.changes;
}

// ============================================================================
// Additional Message Operations
// ============================================================================

/**
 * Get a message by ID
 */
export function getMessageById(messageId: string): ConversationMessage | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM conversation_messages WHERE id = ?
  `).get(messageId) as ConversationMessage | undefined;

  return row ?? null;
}

/**
 * Get the most recent messages in a session (returns in chronological order)
 */
export function getRecentMessages(sessionId: string, count: number): ConversationMessage[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM (
      SELECT * FROM conversation_messages
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC
  `).all(sessionId, count) as ConversationMessage[];
}

/**
 * Get message count for a session
 */
export function getMessageCount(sessionId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM conversation_messages WHERE session_id = ?
  `).get(sessionId) as { count: number };

  return result.count;
}

/**
 * Delete a specific message by ID
 */
export function deleteMessage(messageId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM conversation_messages WHERE id = ?
  `).run(messageId);

  return result.changes > 0;
}

// ============================================================================
// Combined Operations
// ============================================================================

export interface SessionWithMessages {
  session: ParsedConversationSession;
  messages: ParsedConversationMessage[];
}

/**
 * Get a session with all its messages
 */
export function getSessionWithMessages(sessionId: string): SessionWithMessages | null {
  const session = getSessionByIdParsed(sessionId);
  if (!session) return null;

  const messages = getMessagesBySessionIdParsed(sessionId);

  return { session, messages };
}

/**
 * Create a session and add an initial message
 */
export function createSessionWithMessage(
  sessionInput: CreateSessionInput,
  messageInput: Omit<CreateMessageInput, 'sessionId'>
): SessionWithMessages {
  const session = createSession(sessionInput);
  const message = createMessage({
    ...messageInput,
    sessionId: session.id,
  });

  return {
    session: {
      ...session,
      context: JSON.parse(session.context) as Record<string, unknown>,
    },
    messages: [{
      ...message,
      metadata: JSON.parse(message.metadata) as Record<string, unknown>,
    }],
  };
}

/**
 * Get or create a session for a user
 * Returns existing active session or creates a new one
 */
export function getOrCreateSession(
  userId: string,
  createInput: Omit<CreateSessionInput, 'userId'> = {}
): ConversationSession {
  const db = getDb();
  const timestamp = now();

  // Look for an active session for this user
  const existingSession = db.prepare(`
    SELECT * FROM conversation_sessions
    WHERE user_id = ?
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY last_activity_at DESC
    LIMIT 1
  `).get(userId, timestamp) as ConversationSession | undefined;

  if (existingSession) {
    touchSession(existingSession.id);
    return existingSession;
  }

  // Create new session
  return createSession({ ...createInput, userId });
}

// ============================================================================
// Enriched Context Building
// ============================================================================

/**
 * Options for building enriched context
 */
export interface BuildEnrichedContextOptions {
  /** Number of recent messages to include (default: 5) */
  recentMessageCount?: number;

  /** Pending escalations for the current outcome */
  pendingEscalations?: Array<{
    id: string;
    question_text: string;
  }>;
}

/**
 * Build an enriched context object that aggregates:
 * - Session state (current outcome, conversation topic)
 * - Intent history (previous intents with their entities)
 * - Referenced entities (for pronoun resolution)
 * - Message history (recent messages for context)
 * - Escalation state (pending escalations)
 *
 * This function should be called before intent classification to provide
 * the classifier with rich context for better accuracy.
 *
 * @param sessionId - The session ID to build context for
 * @param options - Optional configuration
 * @returns EnrichedContext object or null if session not found
 */
export function buildEnrichedContext(
  sessionId: string,
  options: BuildEnrichedContextOptions = {}
): EnrichedContext | null {
  const session = getSessionByIdParsed(sessionId);
  if (!session) return null;

  const {
    recentMessageCount = 5,
    pendingEscalations = [],
  } = options;

  const context = session.context as EnhancedSessionContext;

  // Get intent history
  const previousIntents: PreviousIntent[] = context.previous_intents || [];
  const recentIntentTypes = previousIntents.map(intent => intent.type);

  // Get referenced entities (with cleanup of stale entries)
  const referencedEntities = cleanupStaleEntities(context.referenced_entities || {});

  // Get conversation topic
  const conversationTopic: ConversationTopic = context.conversation_topic || null;

  // Get recent messages
  const messages = getRecentMessages(sessionId, recentMessageCount);
  const recentMessages = messages.map(msg => ({
    role: msg.role as ConversationRole,
    content: msg.content,
    timestamp: msg.created_at,
  }));

  // Get message count for context about conversation length
  const messageCount = getMessageCount(sessionId);

  // Determine escalation state
  const hasPendingEscalations = pendingEscalations.length > 0;
  const lastEscalationQuestion = hasPendingEscalations
    ? pendingEscalations[0].question_text
    : context.lastEscalationQuestion;
  const pendingEscalationId = hasPendingEscalations
    ? pendingEscalations[0].id
    : context.pendingEscalationId;

  // Build the enriched context object
  const enrichedContext: EnrichedContext = {
    // Session-level context
    sessionId: session.id,
    currentOutcomeId: session.current_outcome_id,
    conversationTopic,

    // Intent history
    previousIntents,
    recentIntentTypes,

    // Entity resolution
    referencedEntities,

    // Escalation state
    hasActiveOutcome: !!session.current_outcome_id,
    activeOutcomeId: session.current_outcome_id ?? undefined,
    hasPendingEscalations,
    lastEscalationQuestion,
    pendingEscalationId,

    // Message history
    recentMessages,
    messageCount,
  };

  return enrichedContext;
}

/**
 * Remove stale entities (older than REFERENCED_ENTITY_MAX_AGE_MS)
 */
function cleanupStaleEntities(entities: ReferencedEntitiesMap): ReferencedEntitiesMap {
  const timestamp = now();
  const cleaned: ReferencedEntitiesMap = {};

  for (const [key, entity] of Object.entries(entities)) {
    if (entity && (timestamp - entity.mentionedAt) <= REFERENCED_ENTITY_MAX_AGE_MS) {
      cleaned[key as keyof ReferencedEntitiesMap] = entity;
    }
  }

  return cleaned;
}

/**
 * Update session context after a successful intent classification.
 * This is a convenience function that:
 * 1. Adds the intent to history
 * 2. Tracks any entities mentioned in the intent
 * 3. Updates the conversation topic
 *
 * @param sessionId - The session ID
 * @param intent - The classified intent
 * @param entityNames - Optional ID-to-name mappings for referenced entities
 */
export function updateSessionAfterClassification(
  sessionId: string,
  intent: {
    type: string;
    confidence: number;
    entities: Record<string, string | undefined>;
  },
  entityNames?: Record<string, string>
): ConversationSession | null {
  // Add intent to history (this also updates the conversation topic)
  addIntentToHistory(sessionId, intent);

  // Track any entities mentioned
  if (Object.keys(intent.entities).length > 0) {
    trackEntitiesFromIntent(sessionId, intent.entities, entityNames);
  }

  return getSessionById(sessionId);
}

/**
 * Convert EnrichedContext to the legacy context format expected by classifyIntent.
 * This provides backwards compatibility with the existing intent classifier.
 */
export function enrichedContextToClassifierContext(enriched: EnrichedContext): {
  hasActiveOutcome: boolean;
  activeOutcomeId?: string;
  hasPendingEscalations: boolean;
  lastEscalationQuestion?: string;
  pendingEscalationId?: string;
} {
  return {
    hasActiveOutcome: enriched.hasActiveOutcome,
    activeOutcomeId: enriched.activeOutcomeId,
    hasPendingEscalations: enriched.hasPendingEscalations,
    lastEscalationQuestion: enriched.lastEscalationQuestion,
    pendingEscalationId: enriched.pendingEscalationId,
  };
}

/**
 * Convert EnrichedContext to the full ClassifierContext format.
 * This includes previous intents, referenced entities, and other enhanced fields
 * for improved intent classification with disambiguation.
 */
export function enrichedContextToFullClassifierContext(enriched: EnrichedContext): {
  hasActiveOutcome: boolean;
  activeOutcomeId?: string;
  hasPendingEscalations: boolean;
  lastEscalationQuestion?: string;
  pendingEscalationId?: string;
  previousIntents?: Array<{
    type: string;
    confidence: number;
    entities: Record<string, string | undefined>;
    timestamp: number;
  }>;
  recentIntentTypes?: string[];
  conversationTopic?: string;
  referencedEntities?: {
    outcome?: { id: string; name?: string };
    worker?: { id: string; name?: string };
    task?: { id: string; name?: string };
    escalation?: { id: string };
    lastMentioned?: { type: string; id: string; name?: string };
  };
  recentMessages?: Array<{
    role: string;
    content: string;
    timestamp: number;
  }>;
} {
  // Convert referenced entities to the expected format
  const referencedEntities = enriched.referencedEntities;
  const convertedRefs: {
    outcome?: { id: string; name?: string };
    worker?: { id: string; name?: string };
    task?: { id: string; name?: string };
    escalation?: { id: string };
    lastMentioned?: { type: string; id: string; name?: string };
  } = {};

  if (referencedEntities.outcome) {
    convertedRefs.outcome = {
      id: referencedEntities.outcome.id,
      name: referencedEntities.outcome.name,
    };
  }
  if (referencedEntities.worker) {
    convertedRefs.worker = {
      id: referencedEntities.worker.id,
      name: referencedEntities.worker.name,
    };
  }
  if (referencedEntities.task) {
    convertedRefs.task = {
      id: referencedEntities.task.id,
      name: referencedEntities.task.name,
    };
  }
  if (referencedEntities.escalation) {
    convertedRefs.escalation = {
      id: referencedEntities.escalation.id,
    };
  }
  if (referencedEntities.lastMentioned) {
    convertedRefs.lastMentioned = {
      type: referencedEntities.lastMentioned.type,
      id: referencedEntities.lastMentioned.id,
      name: referencedEntities.lastMentioned.name,
    };
  }

  return {
    hasActiveOutcome: enriched.hasActiveOutcome,
    activeOutcomeId: enriched.activeOutcomeId,
    hasPendingEscalations: enriched.hasPendingEscalations,
    lastEscalationQuestion: enriched.lastEscalationQuestion,
    pendingEscalationId: enriched.pendingEscalationId,
    previousIntents: enriched.previousIntents,
    recentIntentTypes: enriched.recentIntentTypes,
    conversationTopic: enriched.conversationTopic ?? undefined,
    referencedEntities: Object.keys(convertedRefs).length > 0 ? convertedRefs : undefined,
    recentMessages: enriched.recentMessages,
  };
}
