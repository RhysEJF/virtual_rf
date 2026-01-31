# Worker (Ralph) - Design

> Implementation details for autonomous task execution.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/ralph/worker.ts` | Main worker logic | ~29KB |
| `lib/db/workers.ts` | Worker database operations | ~4KB |
| `lib/db/tasks.ts` | Task claiming and status | ~6KB |
| `lib/db/progress.ts` | Progress entry recording | ~3KB |

---

## Worker Loop

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
  phase?: 'capability' | 'execution';  // Which task phase to work on
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

## Claude Spawning

```typescript
const claudeProcess = spawn('claude', [
  '-p', taskPrompt,
  '--dangerously-skip-permissions',
  '--max-turns', '20'
], {
  cwd: taskWorkspace,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});

// Track PID for reliable process management
updateWorker(workerId, { pid: claudeProcess.pid });
```

**Critical:** `stdin` must be `'ignore'` to prevent hanging.

---

## Atomic Task Claiming

```sql
BEGIN IMMEDIATE;
SELECT * FROM tasks
  WHERE outcome_id = ?
    AND status = 'pending'
    AND phase = ?
  ORDER BY priority ASC
  LIMIT 1;
UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?;
COMMIT;
```

Only one worker wins each task. Losers retry for the next one.

---

## Heartbeat Mechanism

```typescript
// Send heartbeat every 30 seconds
const heartbeatInterval = setInterval(() => {
  sendHeartbeat(workerId);
}, 30000);

// Supervisor detects stale workers (no heartbeat > 5 min)
```

---

## Progress Monitoring

Workers watch `progress.txt` for status updates:

```
STATUS: Implementing user authentication
STATUS: Added login form component
DONE
```

Detection logic:
- `STATUS:` lines → Update progress summary
- `DONE` → Complete task successfully
- `ERROR` → Fail task with error

---

## PID Tracking

```typescript
// Store PID for process management
updateWorker(workerId, { pid: claudeProcess.pid });

// Pause: send SIGTERM
process.kill(pid, 'SIGTERM');

// Stop: send SIGKILL if SIGTERM fails
setTimeout(() => process.kill(pid, 'SIGKILL'), 5000);
```

---

## Intervention Handling

```typescript
const interventions = getPendingInterventionsForWorker(workerId);
for (const intervention of interventions) {
  if (intervention.type === 'pause') {
    // Stop loop, mark worker paused
    markInterventionHandled(intervention.id);
    break;
  }
  if (intervention.type === 'redirect') {
    // Inject new context into next iteration
    injectContext(intervention.content);
    markInterventionHandled(intervention.id);
  }
}
```
