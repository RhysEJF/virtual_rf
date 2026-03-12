import { getDb } from '../db';

// Ensure events table exists
export function ensureEventsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      outcome_id TEXT,
      worker_id TEXT,
      task_id TEXT,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_outcome_time ON events(outcome_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);
}

export function persistEvent(events: Array<{ type: string; outcomeId?: string; workerId?: string; taskId?: string; data?: Record<string, unknown>; timestamp?: string }>): void {
  const db = getDb();
  ensureEventsTable();

  const stmt = db.prepare(`
    INSERT INTO events (type, outcome_id, worker_id, task_id, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((evts: typeof events) => {
    for (const event of evts) {
      stmt.run(
        event.type,
        event.outcomeId || null,
        event.workerId || null,
        event.taskId || null,
        event.data ? JSON.stringify(event.data) : null,
        event.timestamp || new Date().toISOString()
      );
    }
  });

  insertMany(events);
}

export function getEvents(options: {
  outcomeId?: string;
  since?: string;
  type?: string;
  limit?: number;
}): Array<{ id: number; type: string; outcome_id: string; worker_id: string; task_id: string; data: string; created_at: string }> {
  const db = getDb();
  ensureEventsTable();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.outcomeId) {
    conditions.push('outcome_id = ?');
    params.push(options.outcomeId);
  }
  if (options.since) {
    conditions.push('created_at > ?');
    params.push(options.since);
  }
  if (options.type) {
    conditions.push('type = ?');
    params.push(options.type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 100;

  return db.prepare(`
    SELECT * FROM events ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, limit) as Array<{ id: number; type: string; outcome_id: string; worker_id: string; task_id: string; data: string; created_at: string }>;
}

export function pruneEvents(olderThanDays: number = 7): number {
  const db = getDb();
  ensureEventsTable();

  const result = db.prepare(`
    DELETE FROM events WHERE created_at < datetime('now', ?)
  `).run(`-${olderThanDays} days`);

  return result.changes;
}
