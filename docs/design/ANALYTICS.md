# Analytics - Design

> Implementation details for logging, tracking, and self-improvement.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/db/activity.ts` | Activity logging | ~7KB |
| `lib/db/cost.ts` | Cost tracking | ~2KB |
| `lib/db/bottleneck.ts` | Bottleneck logging | ~2KB |
| `lib/db/analysis-jobs.ts` | Analysis job CRUD | ~5KB |
| `lib/agents/self-improvement.ts` | Pattern detection | ~5KB |
| `lib/agents/compactor.ts` | Progress compaction | ~4KB |
| `lib/agents/improvement-analyzer.ts` | Escalation analysis | ~15KB |
| `lib/analysis/runner.ts` | Background job execution | ~7KB |
| `app/api/activity/route.ts` | Activity API | ~2KB |
| `app/api/costs/route.ts` | Costs API | ~1KB |
| `app/api/improvements/analyze/route.ts` | Analysis API (GET/POST) | ~8KB |
| `app/api/improvements/create/route.ts` | Create improvement outcomes | ~10KB |
| `app/api/improvements/create-consolidated/route.ts` | Create consolidated outcomes | ~8KB |
| `app/api/improvements/jobs/[jobId]/route.ts` | Job status endpoint | ~2KB |
| `app/api/improvements/jobs/active/route.ts` | Active jobs list | ~1KB |

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

### analysis_jobs

```sql
CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,           -- NULL for system-wide analysis
  job_type TEXT NOT NULL,    -- 'improvement_analysis'
  status TEXT NOT NULL,      -- 'pending' | 'running' | 'completed' | 'failed'
  progress_message TEXT,     -- Current step description
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT,               -- JSON of analysis results
  error TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE
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

### POST /api/improvements/analyze

Start a background improvement analysis job.

**Request:**
```json
{
  "outcomeId": "optional - filter to specific outcome",
  "lookbackDays": 30,
  "maxProposals": 5
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "uuid",
  "status": "pending",
  "message": "Analysis job started. Poll /api/improvements/jobs/{jobId} for status."
}
```

### GET /api/improvements/jobs/{jobId}

Get status of an analysis job.

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "uuid",
    "status": "running",
    "progressMessage": "Analyzing escalation patterns with AI...",
    "result": null,
    "error": null,
    "createdAt": 1706745600000,
    "startedAt": 1706745601000,
    "completedAt": null
  }
}
```

### GET /api/improvements/jobs/active

List all active (running/pending) analysis jobs.

**Response:**
```json
{
  "success": true,
  "jobs": [
    {
      "id": "uuid",
      "status": "running",
      "progressMessage": "Analyzing...",
      "createdAt": 1706745600000
    }
  ]
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
