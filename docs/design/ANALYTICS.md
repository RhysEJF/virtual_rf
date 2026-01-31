# Analytics - Design

> Implementation details for logging, tracking, and self-improvement.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/db/activity.ts` | Activity logging | ~3KB |
| `lib/db/cost.ts` | Cost tracking | ~2KB |
| `lib/db/bottleneck.ts` | Bottleneck logging | ~2KB |
| `lib/agents/self-improvement.ts` | Pattern detection | ~5KB |
| `lib/agents/compactor.ts` | Progress compaction | ~4KB |
| `app/api/activity/route.ts` | Activity API | ~2KB |
| `app/api/costs/route.ts` | Costs API | ~1KB |
| `app/api/improvements/route.ts` | Suggestions API | ~2KB |

---

## Database Schemas

### activity_log

```sql
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  outcome_name TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT,  -- JSON for extra data
  created_at TEXT
);
```

### cost_log

```sql
CREATE TABLE cost_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  worker_id TEXT,
  task_id TEXT,
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT
);
```

### bottleneck_log

```sql
CREATE TABLE bottleneck_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  intervention_type TEXT,
  description TEXT,
  resolution TEXT,
  created_at TEXT
);
```

### improvement_suggestions

```sql
CREATE TABLE improvement_suggestions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,      -- skill_gap/automation/process
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 2,
  status TEXT DEFAULT 'pending',  -- pending/accepted/dismissed
  created_at TEXT
);
```

---

## Activity Logging

### Event Types

| Type | Trigger |
|------|---------|
| `outcome_created` | New outcome created |
| `task_created` | Task added |
| `task_completed` | Task finished successfully |
| `task_failed` | Task failed |
| `worker_started` | Worker spawned |
| `worker_completed` | Worker finished all tasks |
| `worker_failed` | Worker crashed or was stopped |
| `review_completed` | Review cycle finished |
| `intervention_sent` | Human instruction sent |

### Usage

```typescript
// lib/db/activity.ts
export function logActivity(entry: {
  outcomeId?: string;
  outcomeName?: string;
  type: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(`
    INSERT INTO activity_log (id, outcome_id, outcome_name, type, title, description, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId('act'),
    entry.outcomeId,
    entry.outcomeName,
    entry.type,
    entry.title,
    entry.description,
    JSON.stringify(entry.metadata || {}),
    new Date().toISOString()
  );
}
```

---

## Self-Improvement Engine

### Pattern Types

| Type | Detection | Suggestion |
|------|-----------|------------|
| `skill_gap` | Repeated redirections on same topic | Build a skill for X |
| `automation` | Repeated manual task creation | Automate X |
| `process` | Repeated pauses/errors in similar contexts | Review process for X |

### Pattern Detection

```typescript
// lib/agents/self-improvement.ts
interface Pattern {
  type: 'skill_gap' | 'automation' | 'process';
  description: string;
  frequency: number;
  suggestedAction: string;
}

export async function detectPatterns(outcomeId?: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];

  // Check for skill gaps
  const redirections = getBottlenecksByType('redirection', outcomeId);
  const groupedRedirections = groupByTopic(redirections);
  for (const [topic, count] of Object.entries(groupedRedirections)) {
    if (count >= 3) {
      patterns.push({
        type: 'skill_gap',
        description: `Repeated redirections for "${topic}"`,
        frequency: count,
        suggestedAction: `Build a skill for ${topic}`
      });
    }
  }

  // Check for automation opportunities
  const manualTasks = getRepeatedManualTasks(outcomeId);
  for (const task of manualTasks) {
    if (task.count >= 5) {
      patterns.push({
        type: 'automation',
        description: `Task "${task.title}" created ${task.count} times`,
        frequency: task.count,
        suggestedAction: `Automate task creation for ${task.title}`
      });
    }
  }

  return patterns;
}
```

### Suggestion Creation

```typescript
export function createSuggestion(pattern: Pattern): void {
  db.prepare(`
    INSERT INTO improvement_suggestions (id, type, title, description, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    generateId('sug'),
    pattern.type,
    pattern.suggestedAction,
    pattern.description,
    pattern.frequency >= 5 ? 1 : 2,
    new Date().toISOString()
  );
}
```

---

## Progress Compaction

### Algorithm

```typescript
// lib/agents/compactor.ts
export async function compactProgress(
  outcomeId: string,
  threshold: number = 50
): Promise<void> {
  const entries = getProgressEntries(outcomeId);
  if (entries.length < threshold) return;

  // Keep last 10 entries raw
  const oldEntries = entries.slice(0, -10);
  const recentEntries = entries.slice(-10);

  // Summarize old entries via Claude
  const summary = await summarizeEntries(oldEntries);

  // Create summary entry
  const summaryEntry = createProgressEntry({
    worker_id: oldEntries[0].worker_id,
    summary: summary.text,
    is_compacted: false  // This IS the summary
  });

  // Mark old entries as compacted
  for (const entry of oldEntries) {
    markEntryCompacted(entry.id, summaryEntry.id);
  }
}
```

### Result

Workers see:
- Compacted summary of iterations 1-40
- Raw details of iterations 41-50 (current)

This keeps context manageable while preserving history.

---

## API Endpoints

### GET /api/activity

List activity entries.

**Query Parameters:**
- `outcomeId`: Filter by outcome
- `type`: Filter by event type
- `limit`: Max entries (default: 50)

**Response:**
```json
{
  "activities": [
    {
      "id": "act_123",
      "type": "task_completed",
      "title": "Hero section built",
      "outcomeName": "Product Landing Page",
      "created_at": "2025-01-31T10:00:00Z"
    }
  ]
}
```

### GET /api/improvements

List improvement suggestions.

**Response:**
```json
{
  "suggestions": [
    {
      "id": "sug_123",
      "type": "skill_gap",
      "title": "Build a skill for competitor analysis",
      "description": "Repeated redirections for competitor analysis",
      "priority": 1,
      "status": "pending"
    }
  ]
}
```

### PATCH /api/improvements/{id}

Update suggestion status.

**Request:**
```json
{
  "status": "accepted"
}
```

---

## Dependencies

**Uses:**
- `lib/db/` - All logging goes to database
- `lib/claude/client.ts` - For summarization

**Used by:**
- Dashboard (activity feed, suggestions)
- Worker system (progress logging)
- Analytics queries
