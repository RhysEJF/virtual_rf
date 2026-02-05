/**
 * Conversation session and message database operations
 *
 * Provides CRUD operations for multi-turn conversation persistence
 * supporting the /api/converse endpoint.
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
// Session Operations
// ============================================================================

export interface CreateSessionInput {
  userId?: string | null;
  currentOutcomeId?: string | null;
  context?: Record<string, unknown>;
  expiresAt?: number | null;
}

/**
 * Create a new conversation session
 */
export function createSession(input: CreateSessionInput = {}): ConversationSession {
  const db = getDb();
  const timestamp = now();
  const id = generateSessionId();

  const session: ConversationSession = {
    id,
    user_id: input.userId ?? null,
    current_outcome_id: input.currentOutcomeId ?? null,
    context: JSON.stringify(input.context ?? {}),
    created_at: timestamp,
    last_activity_at: timestamp,
    expires_at: input.expiresAt ?? null,
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
export function getSession(sessionId: string): ConversationSession | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM conversation_sessions WHERE id = ?
  `).get(sessionId) as ConversationSession | undefined;

  return row ?? null;
}

/**
 * Get a session with parsed context
 */
export function getSessionParsed(sessionId: string): ParsedConversationSession | null {
  const session = getSession(sessionId);
  if (!session) return null;

  return {
    ...session,
    context: JSON.parse(session.context) as Record<string, unknown>,
  };
}

/**
 * Get sessions for a user
 */
export function getSessionsByUser(userId: string, limit = 50): ConversationSession[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM conversation_sessions
    WHERE user_id = ?
    ORDER BY last_activity_at DESC
    LIMIT ?
  `).all(userId, limit) as ConversationSession[];
}

/**
 * Get sessions for an outcome
 */
export function getSessionsByOutcome(outcomeId: string, limit = 50): ConversationSession[] {
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

export interface UpdateSessionInput {
  currentOutcomeId?: string | null;
  context?: Record<string, unknown>;
  expiresAt?: number | null;
}

/**
 * Update a session
 */
export function updateSession(sessionId: string, input: UpdateSessionInput): ConversationSession | null {
  const db = getDb();
  const timestamp = now();

  const existing = getSession(sessionId);
  if (!existing) return null;

  const updates: string[] = ['last_activity_at = ?'];
  const values: (string | number | null)[] = [timestamp];

  if (input.currentOutcomeId !== undefined) {
    updates.push('current_outcome_id = ?');
    values.push(input.currentOutcomeId);
  }

  if (input.context !== undefined) {
    updates.push('context = ?');
    values.push(JSON.stringify(input.context));
  }

  if (input.expiresAt !== undefined) {
    updates.push('expires_at = ?');
    values.push(input.expiresAt);
  }

  values.push(sessionId);

  db.prepare(`
    UPDATE conversation_sessions
    SET ${updates.join(', ')}
    WHERE id = ?
  `).run(...values);

  return getSession(sessionId);
}

/**
 * Update session's last activity timestamp
 */
export function touchSession(sessionId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE conversation_sessions
    SET last_activity_at = ?
    WHERE id = ?
  `).run(now(), sessionId);
}

/**
 * Delete a session and all its messages
 */
export function deleteSession(sessionId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM conversation_sessions WHERE id = ?
  `).run(sessionId);

  return result.changes > 0;
}

/**
 * Delete expired sessions
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

// ============================================================================
// Message Operations
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
 * Get a message by ID
 */
export function getMessage(messageId: string): ConversationMessage | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM conversation_messages WHERE id = ?
  `).get(messageId) as ConversationMessage | undefined;

  return row ?? null;
}

/**
 * Get a message with parsed metadata
 */
export function getMessageParsed(messageId: string): ParsedConversationMessage | null {
  const message = getMessage(messageId);
  if (!message) return null;

  return {
    ...message,
    metadata: JSON.parse(message.metadata) as Record<string, unknown>,
  };
}

/**
 * Get all messages in a session, ordered by creation time
 */
export function getSessionMessages(sessionId: string, limit?: number): ConversationMessage[] {
  const db = getDb();

  if (limit) {
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
 * Get session messages with parsed metadata
 */
export function getSessionMessagesParsed(sessionId: string, limit?: number): ParsedConversationMessage[] {
  const messages = getSessionMessages(sessionId, limit);
  return messages.map(msg => ({
    ...msg,
    metadata: JSON.parse(msg.metadata) as Record<string, unknown>,
  }));
}

/**
 * Get the most recent messages in a session
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
export function getSessionMessageCount(sessionId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM conversation_messages WHERE session_id = ?
  `).get(sessionId) as { count: number };

  return result.count;
}

/**
 * Delete a specific message
 */
export function deleteMessage(messageId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM conversation_messages WHERE id = ?
  `).run(messageId);

  return result.changes > 0;
}

/**
 * Delete all messages in a session
 */
export function clearSessionMessages(sessionId: string): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM conversation_messages WHERE session_id = ?
  `).run(sessionId);

  return result.changes;
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
  const session = getSessionParsed(sessionId);
  if (!session) return null;

  const messages = getSessionMessagesParsed(sessionId);

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
 * Check if a session exists and is not expired
 */
export function isSessionValid(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;

  if (session.expires_at && session.expires_at < now()) {
    return false;
  }

  return true;
}

/**
 * Get or create a session for a user
 * Returns existing active session or creates a new one
 */
export function getOrCreateUserSession(
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
