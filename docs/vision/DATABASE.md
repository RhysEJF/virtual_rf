# Database

> SQLite-based persistence layer with 18 tables and comprehensive CRUD operations.

---

## Purpose

All state in Digital Twin is persisted to SQLite. The database:

1. Stores outcomes, tasks, workers, and their relationships
2. Provides atomic operations for safe multi-worker access
3. Tracks history (progress, reviews, activity)
4. Enables queries for UI and analytics

---

## Current State

**Status:** Complete and production-ready

The database layer includes:
- 18 tables covering all domain entities
- WAL mode for concurrent access
- Atomic task claiming (IMMEDIATE transactions)
- Auto-migrations for schema changes
- Orphan cleanup (crashed processes)

---

## Architecture

### Connection

```typescript
// lib/db/index.ts
const db = new Database('data/twin.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

**Features:**
- Singleton pattern (one connection)
- Lazy initialization
- WAL mode for better concurrency
- Foreign key enforcement

### File Location

```
data/twin.db      # Main database
data/twin.db-wal  # Write-ahead log
data/twin.db-shm  # Shared memory
```

---

## Schema Overview

### Core Tables

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `outcomes` | Goals/projects | Parent of tasks, workers |
| `tasks` | Executable work | Belongs to outcome, claimed by worker |
| `workers` | Execution instances | Belongs to outcome, has current task |
| `design_docs` | Approach documents | Belongs to outcome, versioned |

### Support Tables

| Table | Purpose |
|-------|---------|
| `progress_entries` | Worker episodic memory |
| `review_cycles` | Review history |
| `skills` | Registered global skills |
| `interventions` | Human instructions |
| `supervisor_alerts` | Safety alerts |
| `activity_log` | Event feed |
| `collaborators` | Outcome sharing |

### Analytics Tables

| Table | Purpose |
|-------|---------|
| `cost_log` | API cost tracking |
| `bottleneck_log` | Failure analysis |
| `improvement_suggestions` | Auto-generated ideas |

### Git Tables

| Table | Purpose |
|-------|---------|
| `merge_queue` | PR merge handling |
| `change_snapshots` | Version snapshots |

---

## Key Tables Detail

### outcomes

```sql
CREATE TABLE outcomes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- active/dormant/achieved/archived
  is_ongoing INTEGER DEFAULT 0,
  brief TEXT,
  intent TEXT,                   -- JSON: PRD structure
  timeline TEXT,
  infrastructure_ready INTEGER DEFAULT 0,  -- 0/1/2
  parent_id TEXT,                -- Hierarchical outcomes
  depth INTEGER DEFAULT 0,
  working_directory TEXT,
  git_mode TEXT,
  base_branch TEXT,
  work_branch TEXT,
  auto_commit INTEGER DEFAULT 0,
  create_pr_on_complete INTEGER DEFAULT 0,
  supervisor_enabled INTEGER DEFAULT 1,
  pause_sensitivity TEXT DEFAULT 'medium',
  created_at TEXT,
  updated_at TEXT,
  last_activity_at TEXT
);
```

### tasks

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  prd_context TEXT,
  design_context TEXT,
  status TEXT DEFAULT 'pending',  -- pending/claimed/running/completed/failed
  priority INTEGER DEFAULT 2,
  score REAL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  claimed_by TEXT,                -- Worker ID
  claimed_at TEXT,
  completed_at TEXT,
  from_review INTEGER DEFAULT 0,
  review_cycle INTEGER,
  phase TEXT DEFAULT 'execution', -- infrastructure/execution
  infra_type TEXT,                -- skill/tool
  required_skills TEXT,           -- JSON array
  task_intent TEXT,
  task_approach TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

### workers

```sql
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'idle',     -- idle/running/paused/completed/failed
  current_task_id TEXT,
  iteration INTEGER DEFAULT 0,
  last_heartbeat TEXT,
  progress_summary TEXT,
  cost REAL DEFAULT 0,
  started_at TEXT,
  updated_at TEXT,
  worktree_path TEXT,
  branch_name TEXT,
  pid INTEGER,                    -- OS process ID
  created_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

---

## Key Operations

### Atomic Task Claiming

```typescript
// lib/db/tasks.ts
export function claimNextTask(
  outcomeId: string,
  workerId: string,
  phase?: TaskPhase
): Task | null {
  const claim = db.transaction(() => {
    const task = db.prepare(`
      SELECT * FROM tasks
      WHERE outcome_id = ?
        AND status = 'pending'
        AND (phase = ? OR ? IS NULL)
      ORDER BY priority ASC
      LIMIT 1
    `).get(outcomeId, phase, phase);

    if (!task) return null;

    db.prepare(`
      UPDATE tasks
      SET status = 'claimed',
          claimed_by = ?,
          claimed_at = ?
      WHERE id = ?
    `).run(workerId, now(), task.id);

    return task;
  });

  return claim.immediate(); // IMMEDIATE transaction
}
```

### Heartbeat & Stale Detection

```typescript
// lib/db/workers.ts
export function sendHeartbeat(workerId: string): void {
  db.prepare(`
    UPDATE workers
    SET last_heartbeat = ?
    WHERE id = ?
  `).run(new Date().toISOString(), workerId);
}

export function getStaleWorkers(thresholdMs: number): Worker[] {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  return db.prepare(`
    SELECT * FROM workers
    WHERE status = 'running'
      AND last_heartbeat < ?
  `).all(cutoff);
}
```

---

## CRUD Files

| File | Tables | Purpose |
|------|--------|---------|
| `lib/db/outcomes.ts` | outcomes | Outcome CRUD, hierarchy |
| `lib/db/tasks.ts` | tasks | Task CRUD, claiming |
| `lib/db/workers.ts` | workers | Worker CRUD, heartbeat |
| `lib/db/progress.ts` | progress_entries | Progress CRUD |
| `lib/db/review-cycles.ts` | review_cycles | Review history |
| `lib/db/skills.ts` | skills | Skill registry |
| `lib/db/interventions.ts` | interventions | Human instructions |
| `lib/db/supervisor-alerts.ts` | supervisor_alerts | Safety alerts |
| `lib/db/activity.ts` | activity_log | Event feed |

---

## Migrations

Schema changes use additive migrations in `lib/db/index.ts`:

```typescript
// Example migration
try {
  db.exec(`ALTER TABLE outcomes ADD COLUMN parent_id TEXT`);
} catch (e) {
  // Column already exists
}
```

**Approach:**
- Try to add new columns/tables
- Catch "already exists" errors
- Never drop columns in production

---

## Dependencies

**Used by:**
- All agents (read/write state)
- All API routes (query data)
- Worker system (atomic claiming)
- Supervisor (monitoring queries)

---

## Open Questions

1. **Database size** - `full_output` in progress_entries can grow large. Need archival strategy?

2. **Query performance** - No indexes defined explicitly. May need as data grows.

3. **Backup strategy** - SQLite is a single file. Easy to backup but no automated process.

4. **Multi-instance** - What if we run multiple Digital Twin instances? Currently assumes single instance.
