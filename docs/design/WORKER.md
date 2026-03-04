# Worker (Ralph) - Design

> Implementation details for autonomous task execution.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/ralph/worker.ts` | Main worker logic | ~35KB |
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
              ┌────────┴──────────────────┐         │
              ▼             ▼            ▼         │
           DONE        TURN EXHAUSTED  ERROR       │
              │             │            │         │
              ▼             ▼            ▼         │
         Complete      Release task   Fail task    │
           task        back to        (burn        │
              │        pending         attempt)    │
              │        (no attempt     │           │
              │         burned)        │           │
              └──────┬──┴──────────────┘           │
                     │                             │
                     ▼                             │
            Record full output                     │
                     │                             │
                     └─────────────────────────────┘
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
- `lib/agents/skill-manager.ts` - Global skill auto-discovery (DB search)
- `lib/agents/skill-builder.ts` - Outcome skill loading (`loadOutcomeSkills`, `getSkillContent`)
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
- Turn exhaustion with `DONE` in progress.txt → Treat as success (work finished despite hitting turn limit)

---

## Turn Exhaustion Detection

When Claude CLI hits its max turns limit, the task is **not failed**. Instead it is released back to pending so another worker (or the same worker on the next iteration) can pick it up without burning a failure attempt.

### Detection — `detectTurnExhaustion(fullOutput, exitCode)`

Two-tier detection strategy:

1. **Primary (JSON):** Scan CLI output lines (last-to-first) for a JSON result with `subtype: 'error_max_turns'`. This is emitted when using `--output-format json`.
2. **Fallback (keyword + exit code):** When `exitCode === null` (process killed by signal), check for turn-related keywords (`max turns`, `max_turns`, `turn limit`) in the output.

```typescript
function detectTurnExhaustion(fullOutput: string, exitCode: number | null): boolean
```

### `executeTask` Return Type

```typescript
Promise<{
  success: boolean;
  error?: string;
  fullOutput?: string;
  guardBlocks?: number;
  rateLimited?: boolean;
  turnExhausted?: boolean;   // Set when max turns reached
}>
```

### Close Handler Resolution Order

Inside the `claudeProcess.on('close')` handler, checks run in this order:

1. **Rate limit** → resolve `rateLimited: true`, break loop
2. **Turn exhaustion** → check progress.txt:
   - If `DONE` found → resolve as `success: true` (work completed despite exhaustion)
   - Otherwise → resolve `turnExhausted: true`
3. **Progress file** → normal `DONE` / `ERROR` / exit-code logic

### Worker Loop Handling

Both `startRalphWorker` (main loop) and `runWorkerLoop` (self-healing loop) handle `turnExhausted` identically:

```typescript
if (taskResult.turnExhausted) {
  appendLog(`[Turn Exhaustion] Max turns reached on "${task.title}". Releasing back to pending (no attempt burned).`);
  releaseTask(task.id);
  createProgressEntry({ ... });
  continue;  // Next iteration — do NOT break the loop
}
```

Key behavior:
- `releaseTask()` sets the task back to `pending` (no failure recorded)
- The worker **continues** to the next iteration (does not pause or stop)
- No circuit-breaker attempt is consumed

### Error Categorization

`categorizeError` recognizes turn exhaustion via the pattern `'code null'` (the error string from a null exit code), categorizing it as `turn_limit_exhausted`. This feeds into the circuit breaker's failure pattern analysis.

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

## Skill Context Injection

`startRalphWorker` loads outcome skills before the work loop and passes them to every task's CLAUDE.md:

```typescript
// Before work loop
const outcomeSkills = loadOutcomeSkills(outcomeId);
// Builds "## Available Skills" section with full content

// Inside generateTaskInstructions(), two sources combine:
const combinedSkillContext = [
  skillContext,              // Auto-discovered global skills (searchSkills)
  additionalSkillContext     // Outcome skills (loadOutcomeSkills)
].filter(Boolean).join('\n\n');
```

**Generated CLAUDE.md sections:**
- `## Available Skills` — Outcome-specific skills (full content, always present if skills exist)
- `## Relevant Skills` — Auto-discovered global skills (matched by name/keywords, max 2)

---

## Task Gate Context Injection

When a task has satisfied gates with `response_data`, the worker injects that content into the generated CLAUDE.md:

```markdown
## Human Input
The following human input was provided for this task:

### Interview answers from user
[The human's response data here]
```

This ensures workers have access to human-provided answers, documents, or approvals when executing gated tasks.

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
