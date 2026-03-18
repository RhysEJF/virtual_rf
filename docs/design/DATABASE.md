# Database - Design

> Implementation details for SQLite persistence layer.

---

## Architecture

### Connection

```typescript
// lib/db/index.ts
import Database from 'better-sqlite3';

const db = new Database('data/twin.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
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

## CRUD Files

| File | Tables | Purpose |
|------|--------|---------|
| `lib/db/index.ts` | - | Connection, migrations |
| `lib/db/schema.ts` | - | TypeScript interfaces |
| `lib/db/outcomes.ts` | outcomes, design_docs | Outcome CRUD, hierarchy |
| `lib/db/tasks.ts` | tasks | Task CRUD, claiming, proliferation guards |
| `lib/db/workers.ts` | workers | Worker CRUD, heartbeat |
| `lib/db/progress.ts` | progress_entries | Progress CRUD |
| `lib/db/review-cycles.ts` | review_cycles | Review history |
| `lib/db/skills.ts` | skills | Skill registry |
| `lib/db/interventions.ts` | interventions | Human instructions |
| `lib/db/supervisor-alerts.ts` | supervisor_alerts | Safety alerts |
| `lib/db/activity.ts` | activity_log | Event feed |
| `lib/db/homr.ts` | homr_* tables | HOMЯ Protocol |
| `lib/db/repositories.ts` | repositories, outcome_items | Repository sync |
| `lib/db/system-config.ts` | system_config | Global system settings |
| `lib/db/guard-blocks.ts` | guard_blocks | Destructive command audit trail |
| `lib/db/attempts.ts` | task_attempts | Task attempt tracking |
| `lib/db/checkpoints.ts` | task_checkpoints | Task checkpoint CRUD |
| `lib/db/experiments.ts` | experiments | Evolve mode experiment tracking |
| `lib/events/persistence.ts` | events | Event bus persistence |

---

## Full Schema

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
  capability_ready INTEGER DEFAULT 0,  -- 0/1/2
  parent_id TEXT,                -- Hierarchical outcomes
  depth INTEGER DEFAULT 0,
  working_directory TEXT,
  git_mode TEXT,                 -- none/local/branch/worktree
  base_branch TEXT,
  work_branch TEXT,
  auto_commit INTEGER DEFAULT 0,
  create_pr_on_complete INTEGER DEFAULT 0,
  supervisor_enabled INTEGER DEFAULT 1,
  pause_sensitivity TEXT DEFAULT 'medium',
  consecutive_clean_reviews INTEGER DEFAULT 0,
  -- Repository configuration (inheritance-aware)
  repository_id TEXT,            -- FK to repositories (null = inherit from parent)
  output_target TEXT DEFAULT 'local',   -- local/repo/inherit
  skill_target TEXT DEFAULT 'local',    -- local/repo/inherit
  tool_target TEXT DEFAULT 'local',     -- local/repo/inherit
  file_target TEXT DEFAULT 'local',     -- local/repo/inherit
  auto_save TEXT DEFAULT '0',           -- 0/1/inherit
  isolation_mode TEXT DEFAULT 'workspace',  -- workspace/codebase
  created_at TEXT,
  updated_at TEXT,
  last_activity_at TEXT,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE SET NULL
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
  phase TEXT DEFAULT 'execution', -- capability/execution
  capability_type TEXT,           -- skill/tool
  required_skills TEXT,           -- JSON array
  task_intent TEXT,
  task_approach TEXT,
  gates TEXT DEFAULT '[]',         -- JSON array of TaskGate objects (human-in-the-loop)
  depends_on TEXT,                 -- JSON array of task IDs
  required_capabilities TEXT,      -- JSON array of 'skill:name' or 'tool:name'
  complexity_score REAL,
  estimated_turns INTEGER,
  decomposition_status TEXT,       -- NULL/in_progress/completed/failed
  decomposed_from_task_id TEXT,    -- Parent task if this is a subtask
  verify_command TEXT,             -- Shell command for post-task verification
  metric_command TEXT,             -- Shell command outputting numeric metric (evolve mode)
  metric_baseline REAL,            -- Baseline metric before optimization
  optimization_budget INTEGER,     -- Max evolve iterations (default 5)
  eval_recipe_name TEXT,           -- Name of eval recipe (links to eval resource)
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
  phase TEXT,                     -- capability/execution
  created_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

### design_docs

```sql
CREATE TABLE design_docs (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL UNIQUE,
  approach TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

### progress_entries

```sql
CREATE TABLE progress_entries (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  task_id TEXT,
  iteration INTEGER,
  summary TEXT,
  full_output TEXT,              -- Complete Claude response
  is_compacted INTEGER DEFAULT 0,
  compacted_into TEXT,           -- ID of summary entry
  created_at TEXT,
  FOREIGN KEY (worker_id) REFERENCES workers(id)
);
```

### review_cycles

```sql
CREATE TABLE review_cycles (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  cycle_number INTEGER NOT NULL,
  issues_found INTEGER DEFAULT 0,
  tasks_added INTEGER DEFAULT 0,
  verification_results TEXT,     -- JSON
  created_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

### skills

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  category TEXT,
  triggers TEXT,                 -- JSON array
  requires TEXT,                 -- JSON array of API keys
  usage_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
```

### interventions

```sql
CREATE TABLE interventions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- pause/redirect/context
  content TEXT,
  status TEXT DEFAULT 'pending', -- pending/handled
  created_at TEXT,
  handled_at TEXT,
  FOREIGN KEY (worker_id) REFERENCES workers(id)
);
```

### supervisor_alerts

```sql
CREATE TABLE supervisor_alerts (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  worker_id TEXT,
  type TEXT NOT NULL,            -- stuck/no_progress/repeated_failure/stale
  severity TEXT NOT NULL,        -- critical/high/medium/low
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending/acknowledged/resolved
  auto_paused INTEGER DEFAULT 0,
  created_at TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT
);
```

### repositories

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,      -- Local git repo path
  remote_url TEXT,               -- Optional remote URL
  auto_push INTEGER DEFAULT 1,   -- Auto-push after commits
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Note:** Repositories are no longer typed as "private" or "team". Instead, each outcome specifies its own repository via `repository_id`, with inheritance through the parent chain.

### system_config

```sql
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Used for global settings like:**
- `default_isolation_mode` - Default workspace isolation mode for new outcomes (`workspace` or `codebase`)
- `max_pending_tasks` - Maximum pending tasks per outcome (default 100)
- `max_subtask_depth` - Maximum decomposition depth (default 3)
- `max_children_per_task` - Maximum subtasks per decomposition (default 15)

### guard_blocks

```sql
CREATE TABLE guard_blocks (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  command TEXT NOT NULL,            -- The blocked command
  pattern_matched TEXT NOT NULL,    -- Which pattern triggered the block
  blocked_at INTEGER NOT NULL,
  context TEXT                      -- JSON context about the block
);
```

### task_attempts

```sql
CREATE TABLE task_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  worker_id TEXT,
  approach_summary TEXT,
  failure_reason TEXT,
  files_modified TEXT,              -- JSON array
  error_output TEXT,                -- Last 2000 chars
  duration_seconds INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### task_checkpoints

```sql
CREATE TABLE task_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  worker_id TEXT,
  progress_summary TEXT,
  remaining_work TEXT,
  files_modified TEXT,              -- JSON array
  git_sha TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### experiments

```sql
CREATE TABLE experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  metric_value REAL,
  metric_command TEXT NOT NULL,
  baseline_value REAL,
  change_summary TEXT,
  git_sha TEXT,
  kept INTEGER NOT NULL DEFAULT 0,  -- 1=kept, 0=reverted
  duration_seconds INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

### events

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,               -- e.g., 'worker.started', 'task.completed'
  outcome_id TEXT,
  worker_id TEXT,
  task_id TEXT,
  data TEXT,                        -- JSON payload
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_outcome_time ON events(outcome_id, created_at);
CREATE INDEX idx_events_type ON events(type);
```

Events are persisted via write-behind batching (500ms flush interval) and pruned after 7 days.

### outcome_items

```sql
CREATE TABLE outcome_items (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  item_type TEXT NOT NULL,       -- skill/tool/eval/file/output
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  target_override TEXT,          -- local/repo/inherit (NULL = use outcome default)
  synced_to TEXT,                -- Repository ID if synced (NULL = local only)
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,
  UNIQUE(outcome_id, item_type, filename)
);
```

### Repository Inheritance Functions

```typescript
// lib/db/repositories.ts

// Get effective repository by walking up outcome hierarchy
function getEffectiveRepository(outcomeId: string): Repository | null

// Get effective save target for a content type
function getEffectiveTarget(
  outcomeId: string,
  targetType: 'output_target' | 'skill_target' | 'tool_target' | 'file_target'
): 'local' | 'repo'

// Get all effective settings (resolved through inheritance)
function getEffectiveRepoSettings(outcomeId: string): {
  repository: Repository | null;
  output_target: 'local' | 'repo';
  skill_target: 'local' | 'repo';
  tool_target: 'local' | 'repo';
  file_target: 'local' | 'repo';
  auto_save: boolean;
}
```

### activity_log

```sql
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  outcome_name TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT,                 -- JSON
  created_at TEXT
);
```

---

## Key Operations

### Atomic Task Claiming

```typescript
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
    `).run(workerId, new Date().toISOString(), task.id);

    return task;
  });

  return claim.immediate(); // IMMEDIATE transaction
}
```

### Atomic Decomposition Lock

```typescript
// lib/db/tasks.ts
export function claimDecompositionLock(taskId: string): boolean {
  const result = db.prepare(`
    UPDATE tasks
    SET decomposition_status = 'in_progress', updated_at = ?
    WHERE id = ?
    AND (decomposition_status IS NULL OR decomposition_status = 'failed')
  `).run(timestamp, taskId);
  return result.changes > 0;
}
```

Prevents TOCTOU race conditions when multiple processes (worker, HOMR auto-resolve) attempt to decompose the same task concurrently.

### Heartbeat & Stale Detection

```typescript
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

## Migration Pattern

```typescript
// lib/db/index.ts
function runMigrations() {
  // Additive migrations - catch "already exists" errors
  try {
    db.exec(`ALTER TABLE outcomes ADD COLUMN capability_ready INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }

  // Data migrations
  try {
    db.exec(`UPDATE tasks SET phase = 'capability' WHERE phase = 'infrastructure'`);
  } catch (e) {
    // Already migrated
  }
}
```

**Approach:**
- Try to add new columns/tables
- Catch "already exists" errors
- Never drop columns in production
- Data migrations are idempotent
