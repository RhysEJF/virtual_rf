# Worker (Ralph)

> The autonomous task execution engine. Spawns Claude CLI processes that work through tasks.

---

## Purpose

Ralph is the workhorse of Digital Twin. When tasks need to be done, Ralph:

1. Claims a task atomically (prevents race conditions)
2. Builds a complete context (outcome, task, skills)
3. Spawns a Claude CLI process
4. Monitors for completion
5. Records output for auditing
6. Repeats until no more tasks

Named after the "Ralph Wiggum" loop pattern from early Claude Code experiments.

---

## Current State

**Status:** Complete and production-ready

This is the largest module (29KB). It handles:
- Atomic task claiming via SQLite transactions
- Heartbeat mechanism for liveness detection
- Skill context injection
- Full output capture for episodic memory
- Intervention handling (pause, redirect)
- PID tracking for reliable process management
- Git worktree support for parallel isolation

---

## Key Concepts

### Atomic Task Claiming

Multiple workers can safely race to claim tasks using SQLite's IMMEDIATE transactions:

```sql
BEGIN IMMEDIATE;
SELECT * FROM tasks
  WHERE outcome_id = ? AND status = 'pending'
  ORDER BY priority ASC LIMIT 1;
UPDATE tasks SET status = 'claimed', claimed_by = ? WHERE id = ?;
COMMIT;
```

Only one worker wins each task. Losers retry for the next one.

### Heartbeat Mechanism

Workers send heartbeats every 30 seconds:
- Updates `last_heartbeat` in workers table
- Supervisor detects stale workers (no heartbeat > 5 min)
- Stale workers get marked as failed, their tasks released

### Skill Context Injection

Before spawning Claude, the worker:
1. Checks task's `required_skills`
2. Loads matching skill documents
3. Injects skill content into CLAUDE.md
4. Claude sees skills as part of its instructions

### Progress Tracking

Workers write to `progress.txt` in their workspace:
```
STATUS: Implementing user authentication
STATUS: Added login form component
DONE
```

The worker monitors this file and:
- Captures status updates for the UI
- Detects DONE signal to complete task
- Detects ERROR signal to fail task

### Full Output Capture

Every Claude response is captured in `progress_entries.full_output`. This provides:
- Complete audit trail
- Debugging capability
- Training data for improvements

---

## Components

### Primary Files

| File | Purpose |
|------|---------|
| `lib/ralph/worker.ts` | Main worker logic (29KB) |
| `lib/db/workers.ts` | Worker database operations |
| `lib/db/tasks.ts` | Task claiming and status |
| `lib/db/progress.ts` | Progress entry recording |

### Worker Loop

```
startRalphWorker(config)
         │
         ▼
┌─────────────────────────────┐
│    Create worker record     │
│    Initialize workspace     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐◀──────────┐
│    Claim next pending task  │           │
└─────────────┬───────────────┘           │
              │                           │
         ┌────┴────┐                      │
         ▼         ▼                      │
     No tasks    Got task                 │
         │         │                      │
         ▼         ▼                      │
      Done    ┌─────────────────┐         │
              │ Start task      │         │
              │ Build context   │         │
              │ Write CLAUDE.md │         │
              └────────┬────────┘         │
                       │                  │
                       ▼                  │
              ┌─────────────────┐         │
              │ Spawn Claude    │         │
              │ --dangerously-  │         │
              │ skip-permissions│         │
              └────────┬────────┘         │
                       │                  │
                       ▼                  │
              ┌─────────────────┐         │
              │ Monitor         │         │
              │ progress.txt    │         │
              │ Send heartbeats │         │
              └────────┬────────┘         │
                       │                  │
              ┌────────┴────────┐         │
              ▼                 ▼         │
           DONE              ERROR        │
              │                 │         │
              ▼                 ▼         │
         Complete task    Fail task       │
              │                 │         │
              └────────┬────────┘         │
                       │                  │
                       ▼                  │
              Record full output          │
                       │                  │
                       └──────────────────┘
```

---

## Configuration

```typescript
interface RalphConfig {
  outcomeId: string;
  workspacePath?: string;      // Default: workspaces/out_{id}
  maxIterations?: number;      // Default: 50
  heartbeatIntervalMs?: number; // Default: 30000 (30s)
  useWorktree?: boolean;       // Git worktree for isolation
}
```

---

## Dependencies

**Uses:**
- `lib/claude/client.ts` - (indirectly, spawns CLI)
- `lib/db/tasks.ts` - Task claiming
- `lib/db/workers.ts` - Worker state
- `lib/db/progress.ts` - Progress recording
- `lib/agents/skill-manager.ts` - Skill loading
- `lib/workspace/detector.ts` - Workspace paths

**Used by:**
- `lib/ralph/orchestrator.ts` - Spawns workers
- `app/api/outcomes/[id]/workers/route.ts` - Manual spawn

---

## Process Management

### PID Tracking

Workers store their Claude process PID in the database:
```typescript
updateWorker(workerId, { pid: claudeProcess.pid });
```

This enables:
- Reliable pause (sends SIGTERM to actual process)
- Stop (sends SIGKILL if SIGTERM fails)
- Orphan detection (process died but worker still "running")

### Intervention Handling

Workers check for pending interventions each iteration:
```typescript
const interventions = getPendingInterventionsForWorker(workerId);
for (const intervention of interventions) {
  if (intervention.type === 'pause') {
    // Stop loop, mark worker paused
  }
}
```

---

## Workspace Structure

```
workspaces/out_{outcomeId}/
├── skills/              # Outcome-specific skills
├── tools/               # Outcome-specific tools
├── task_{taskId}/       # Per-task working directory
│   ├── CLAUDE.md        # Instructions for this task
│   └── progress.txt     # Status updates
└── worker-{workerId}.log
```

---

## Open Questions

1. **Parallel worker coordination** - When multiple workers run on same outcome, how do they avoid conflicts? Currently relies on atomic claiming, but file conflicts are possible.

2. **Task timeout** - What if a task runs forever? Currently relies on Supervisor detection (10 min threshold).

3. **Retry logic** - Failed tasks increment `attempts`. When should we give up? Currently uses `max_attempts` field but logic is simple.

4. **Context size** - Full skill injection can blow up context. Need smarter skill selection or summarization.
