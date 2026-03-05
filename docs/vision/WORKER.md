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

## Status

| Capability | Status |
|------------|--------|
| Atomic task claiming | Complete |
| Heartbeat mechanism | Complete |
| Skill context injection | Complete |
| Full output capture | Complete |
| PID tracking | Complete |
| Intervention handling | Complete |
| Git worktree support | Complete |
| HOMЯ integration | Complete |
| Circuit breaker (auto-pause on failures) | Complete |
| Task complexity estimation | Complete |
| Auto-decomposition for complex tasks | Complete |
| Destructive command guard | Complete |
| Capability dependency checking | Complete |
| Dynamic capability task creation | Complete |
| Workspace isolation enforcement | Complete |
| Task gate enforcement (human-in-the-loop) | Complete |
| Document catalog context injection | Complete |
| Turn exhaustion detection (graceful --max-turns handling) | Complete |
| Rate-limit exit detection (keeps tasks pending) | Complete |
| Self-healing restart loop (infrastructure failure recovery) | Complete |
| Atomic decomposition lock (prevents duplicate subtasks) | Complete |
| Task refinement via worker (pre-execution enrichment) | Complete |
| Shared file path guidance (absolute paths for cross-task files) | Complete |

**Overall:** Complete and production-ready (largest module at ~50KB)

---

## Key Concepts

### Atomic Task Claiming

Multiple workers can safely race to claim tasks. Uses SQLite's IMMEDIATE transactions to ensure only one worker wins each task. Losers retry for the next one.

### Heartbeat Mechanism

Workers send heartbeats every 30 seconds:
- Updates `last_heartbeat` in workers table
- Supervisor detects stale workers (no heartbeat > 5 min)
- Stale workers get marked as failed, their tasks released

### Skill Context Injection

Skills reach workers through two complementary paths:

1. **Outcome skills** (primary) — On worker start, `buildSkillCatalog()` reads all `.md` files from the outcome's `skills/` directory. These are presented as an `## Available Skills` table in the worker's CLAUDE.md with name, triggers, and description. Workers read the full skill file on demand via `../skills/{skill-name}.md`.

2. **Auto-discovery** (secondary) — `searchSkills()` matches the task title + description against global skills in the database. Matching skills are presented as a `## Relevant Global Skills` table with name, category, and description. Workers access full content via `flow skill show {name}` or by reading the file directly.

Both paths use lightweight catalog tables rather than full content injection, reducing context overhead while maintaining discoverability. Outcome skills provide outcome-specific methodology, while auto-discovery surfaces relevant global skills.

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

### HOMЯ Integration

After each task completes, if HOMЯ is enabled:
1. Worker sends task output to HOMЯ for observation
2. HOMЯ analyzes output for alignment, drift, and discoveries
3. HOMЯ injects context from prior tasks into upcoming tasks
4. HOMЯ can detect failure patterns and auto-pause the worker

**Failure Pattern Detection:**
- HOMЯ monitors recent observations for consecutive failures
- After 3+ failures in a row, HOMЯ creates an escalation
- All active workers are automatically paused
- Human must decide: pause, continue with guidance, or skip failing tasks

This makes Ralph "smarter" by letting HOMЯ provide oversight and coordination across tasks.

### Circuit Breaker Pattern

Workers now implement a circuit breaker to prevent cascading failures:

1. **Failure Tracking** - Records consecutive task failures with error categorization
2. **Trip Threshold** - After 3 consecutive failures (configurable), the circuit "trips"
3. **Auto-Pause** - Worker automatically pauses and creates an escalation
4. **Pattern Analysis** - Categorizes errors (timeout, permission, syntax, runtime) to identify systemic issues

When the circuit breaker trips, all active workers on the outcome pause, preventing wasted resources on a broken outcome.

### Turn Exhaustion Detection

When Claude CLI hits `--max-turns`, the worker detects this gracefully and avoids wasting attempts:

1. **Detection** — `detectTurnExhaustion()` checks the CLI output for a JSON result with `subtype: 'error_max_turns'` (primary). Falls back to keyword matching (`max turns`, `max_turns`, `turn limit`) when exit code is `null` (signal kill).
2. **Task Release** — The task is released back to `pending` via `releaseTask()` — no attempt is burned. This differs from a normal failure, which increments the attempt counter.
3. **Progress.txt Override** — If `progress.txt` contains `DONE` despite turn exhaustion, the task is treated as a success. The worker may have finished the actual work but ran out of turns during cleanup.
4. **Worker Continues** — Unlike rate-limit detection (which pauses the worker), turn exhaustion simply moves on to the next task. The exhausted task can be picked up again by any worker.
5. **Error Categorization** — `categorizeError()` classifies `turn`, `iteration`, `max_turns`, and `code null` errors as `turn_limit_exhausted` for circuit breaker tracking.

This follows the same release-not-fail pattern as rate limiting, ensuring transient CLI limits don't permanently fail tasks that could succeed on retry.

### Rate-Limit Exit Detection

When Claude CLI hits a rate limit, the worker detects this and pauses (instead of failing tasks):

1. **Detection** — Regex pattern `/you've hit your limit|rate.?limit|resets \d+am/i` is tested against the full CLI output.
2. **Task Preserved** — The task is NOT failed or released — it stays in its current state. The worker simply stops processing.
3. **Worker Pauses** — The worker exits with `exitReason = 'rate_limited'`, which is NOT in `RESTARTABLE_EXITS` — so the self-healing loop does not retry.
4. **Distinction from Turn Exhaustion** — Turn exhaustion releases the task and continues to the next one. Rate limiting pauses the entire worker since no further API calls will succeed.

### Self-Healing Restart Loop

Workers can automatically recover from transient infrastructure failures (Claude CLI crashes, OOM kills, signal deaths):

1. **Exit Reason Classification** — Every worker exit is classified into a `WorkerExitReason`:
   - **Semantic exits** (intentional): `user_paused`, `all_tasks_complete`, `gate_reached`, `complexity_escalation`, `circuit_breaker`, `homr_paused`, `critical_error`, `rate_limited`
   - **Infrastructure exits** (transient): `uncaught_exception`, `max_iterations`, `unknown`

2. **Restartable Set** — Only infrastructure exits trigger restart: `RESTARTABLE_EXITS = { uncaught_exception, max_iterations, unknown }`

3. **Exponential Backoff** — Restarts use exponential backoff: 10s → 20s → 40s → 80s → 120s (capped). Maximum 5 restart attempts before giving up.

4. **State Preservation** — Between restarts, the current task is released back to pending. The worker record stays `running`. On restart, the worker re-enters the normal claim-execute loop.

5. **Clean Exit** — If a semantic exit occurs inside the restart loop, the loop terminates normally (no more restarts).

### Atomic Decomposition Lock

Task decomposition uses an atomic SQL lock to prevent race conditions:

1. **Problem** — Multiple processes (worker complexity check, HOMR auto-resolve) could simultaneously attempt to decompose the same task, creating duplicate subtasks.
2. **Solution** — `claimDecompositionLock()` uses a single `UPDATE ... WHERE (decomposition_status IS NULL OR decomposition_status = 'failed')`. If another process already set the status, the UPDATE affects 0 rows and the second process bails out.
3. **No TOCTOU Gap** — Unlike a separate check-then-set pattern, the atomic UPDATE eliminates the time window between reading the status and changing it.

### Task Complexity Estimation

Before claiming a task, workers now estimate its complexity:

1. **Pre-Claim Check** - Analyze task description for complexity signals
2. **Factors Analyzed:**
   - Ambiguity level (vague requirements, missing details)
   - Scope breadth (multi-file, cross-system changes)
   - Technical depth (new tech, complex algorithms)
   - Dependency complexity (external APIs, unclear integrations)
3. **Turn Limit Risk** - Estimate if task can complete within worker's max turns (default 20)

High-complexity tasks are flagged for potential decomposition before execution.

### Auto-Decomposition

When a task is too complex for a single worker iteration:

1. **Detection** - Complexity estimate exceeds turn limit threshold
2. **Decomposition** - Task is automatically broken into smaller subtasks
3. **Dependency Chain** - Subtasks are linked with proper `depends_on` relationships
4. **Original Task** - Parent task is skipped, replaced by subtask chain

This prevents workers from hitting turn limits mid-task and losing progress.

### Destructive Command Guard

Workers now have proactive command interception:

1. **Pre-Execution Check** - All bash commands are validated before execution
2. **Pattern Matching** - Checks against known dangerous patterns:
   - `rm -rf` with dangerous paths
   - `git push --force` to protected branches
   - File operations outside workspace
   - System-level commands (shutdown, format, etc.)
3. **Context-Aware** - Understands workspace boundaries and git branch protection
4. **Block & Log** - Dangerous commands are blocked and logged to `guard_blocks` table
5. **Escalation** - Critical blocks create HOMЯ escalations for human review

### Capability Dependency Checking

Workers now check capability dependencies before claiming tasks:

1. **Dependency Declaration** - Tasks can specify `required_capabilities` (e.g., `['skill:market-research', 'tool:scraper']`)
2. **File Existence Check** - Worker verifies capability files exist in workspace before claiming
3. **Blocking** - Tasks with missing capabilities are skipped
4. **Dynamic Creation** - When all execution tasks are blocked, capability tasks are auto-created
5. **Phase Ordering** - Capability tasks run before execution tasks (priority-based)

This enables just-in-time capability building without requiring all capabilities upfront.

### Task Gate Enforcement

Workers check for human-in-the-loop gates before claiming tasks:

1. **Gate Types** - `document_required` (needs human input) and `human_approval` (needs explicit approval)
2. **Claim Blocking** - `claimNextTask()` checks gates after dependencies, before skill checks. Tasks with unsatisfied gates are skipped.
3. **Diagnostic Logging** - When no tasks can be claimed but gated tasks exist, the worker logs which tasks are waiting on human input.
4. **Response Data Injection** - When gates are satisfied with `response_data`, that content is injected into the worker's CLAUDE.md as a "Human Input" section, giving the worker access to the human's answers.

Gates integrate with HOMЯ escalations — each pending gate auto-creates an escalation, and answering the escalation satisfies the gate.

### Document Catalog Context

Workers have access to outcome documents uploaded via the UI, CLI, or converse tools:

1. **Document Discovery** — `buildDocumentCatalog()` scans `{workspace}/docs/` directory at worker startup
2. **Metadata Extraction** — Extracts file type, size, and first-line description for each document
3. **Markdown Table** — Generates an `## Available Documents` section with type, size, and description
4. **Worker Access** — Workers read documents via `../docs/{filename}` from their task workspace
5. **Type Support** — Recognizes markdown, text, PDF, CSV, JSON, XML, HTML, Word, Excel, images, and SVG

The catalog is built alongside skill and tool catalogs in `startRalphWorker()` and injected into the worker's CLAUDE.md. If no documents exist, nothing is injected (no noise).

### Workspace Isolation Enforcement

Outcomes can run in two isolation modes:

1. **Workspace Mode** (`isolation_mode='workspace'`) - Default, safe mode
   - Workers ONLY create/modify files within `workspaces/{outcomeId}/`
   - Cannot access main codebase, sensitive directories, or system files
   - CLAUDE.md includes explicit workspace boundary instructions
   - Ideal for external projects, client work, prototypes

2. **Codebase Mode** (`isolation_mode='codebase'`)
   - Workers can modify the main project files
   - Used for bug fixes, feature additions, improvements to the repo
   - CLAUDE.md does NOT include workspace restrictions

The isolation mode is set per-outcome (with a system-wide default). When in workspace mode, the generated CLAUDE.md file includes:
- Explicit workspace path boundary
- Instructions to ONLY work within that directory
- Warnings about restricted areas (`.env`, `.ssh`, credentials)
- **File path guidance** distinguishing shared vs. task-local files

**Shared vs. Task-Local Files:** Each task runs in a task-specific subdirectory (`workspaces/{outcomeId}/{taskId}/`). Files created with relative paths are invisible to other tasks. The CLAUDE.md instructs workers to use **absolute paths** to the outcome workspace for any shared outputs (deliverables, documents other tasks will read), and allows relative paths only for scratch files. This prevents decomposed subtask handoff failures where one subtask produces a file that a sibling subtask can't find.

This provides defense-in-depth alongside the destructive command guard.

### Worker CLAUDE.md Scope

Each worker receives a **generated per-task CLAUDE.md** written to its task workspace directory. This is distinct from the root project `CLAUDE.md` (which is for human developers and contains coding standards, project structure, etc.).

**How it works:**

1. `generateTaskInstructions()` in `lib/ralph/worker.ts` builds a task-specific CLAUDE.md containing:
   - Outcome name and intent summary
   - Full design document (no truncation — workers get the complete design doc)
   - Isolation/git/HOMR context
   - Task description, PRD context, design context, intent, and approach
   - Skill catalog, tool catalog, and document catalog
   - Matched skill content
   - Progress format and behavioral rules

2. This file is written to the task workspace (e.g., `workspaces/out_{id}/task_{id}/CLAUDE.md`)

3. The Claude CLI process is spawned with `cwd` set to this task workspace directory

**What workers see in each mode:**

- **Workspace-isolated mode:** Workers see only the generated per-task CLAUDE.md. The root project CLAUDE.md is not in their working directory path and is not read.
- **Codebase mode:** Workers still run from the task workspace directory. The root CLAUDE.md is not automatically loaded. Workers receive a "follow existing patterns and conventions" instruction plus the injected design document for architectural guidance.

**This is by design.** The generated CLAUDE.md provides all the context a worker needs: task specifics, design doc, skills, and HOMR learnings. The root CLAUDE.md serves a different purpose (human developer guidance, project documentation) and its content would add noise to worker context without adding actionable task information.

---

## Behaviors

1. **Self-organizing** - Workers claim work without central coordination
2. **Resilient** - Heartbeat enables detection and recovery of failed workers
3. **Context-rich** - Each task runs with full outcome + skill context
4. **Observable** - Progress and full output captured for visibility
5. **Controllable** - Can be paused, redirected, or killed via interventions

---

## Success Criteria

- Tasks complete successfully without manual intervention
- Multiple workers don't conflict on same task
- Stale workers are detected and cleaned up
- Full output is captured for every task
- Interventions are handled promptly

---

## Open Questions

1. **Parallel worker coordination** - When multiple workers run on same outcome, how do they avoid conflicts? Currently relies on atomic claiming, but file conflicts are possible.

2. ~~**Task timeout** - What if a task runs forever? Currently relies on Supervisor detection (10 min threshold).~~
   **Resolved:** Task complexity estimation now predicts tasks that may exceed turn limits. Auto-decomposition breaks them into smaller subtasks.

3. ~~**Retry logic** - Failed tasks increment `attempts`. When should we give up?~~
   **Resolved:** HOMЯ now detects failure patterns. After 3 consecutive failures, it escalates to human and pauses workers. Task-level retry uses `max_attempts` (default 3). Circuit breaker pattern provides additional protection.

4. ~~**Context size** - Full skill injection can blow up context. Need smarter skill selection or summarization.~~
   **Resolved:** Skills, tools, and documents are now presented as lightweight catalog tables (name, type, description). Workers load full content on-demand. This implements the "table of contents" approach from [harness engineering research](../research/harness-engineering.md#5-agentsmd-as-table-of-contents-not-encyclopedia).

---

## Related

- **Design:** [WORKER.md](../design/WORKER.md) - Implementation details and configuration
- **Vision:** [SUPERVISOR.md](./SUPERVISOR.md) - How workers are monitored
- **Vision:** [SKILLS.md](./SKILLS.md) - How skills are loaded
- **Vision:** [HOMЯ](../homr/VISION.md) - How workers are observed and coordinated
