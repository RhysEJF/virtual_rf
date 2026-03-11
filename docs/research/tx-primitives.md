# tx: Integration Analysis for Flow

> Headless agent infrastructure primitives — composable building blocks (task claiming, memory, learnings, guards, verification) that let you build your own orchestration instead of prescribing one.

## Source Material

- [tx Documentation](https://txdocs.dev)
- [tx GitHub](https://github.com/jamesaphoenix/tx)
- Install: `curl -fsSL https://raw.githubusercontent.com/jamesaphoenix/tx/main/install.sh | sh`

## What Is tx?

tx is a local-first, primitives-based infrastructure layer for AI agents. Its philosophy: "Here's headless agent infrastructure. Orchestrate it yourself." Instead of building a full orchestration system (like Flow does), tx provides ~20 composable primitives and says "wire them together however your domain needs."

**Stack**: TypeScript monorepo, SQLite + git, no server required.

**Interfaces**: CLI, MCP Server (42 tools), REST API, TypeScript SDK, Web Dashboard.

**Core primitives organized by category:**

| Category | Primitives | Purpose |
|---|---|---|
| Task Management | `tx ready`, `tx done`, `tx block`, `tx claim` | Dependency-aware queue with scoring |
| Memory & Context | `tx memory`, `tx context`, `tx learning`, `tx pin` | Filesystem-backed knowledge graph + structured learnings |
| Coordination | `tx sync`, `tx send/inbox`, `tx try`, `tx handoff`, `tx checkpoint` | Multi-agent coordination and progress tracking |
| Observability | `tx trace`, `tx doc`, `tx invariant` | Execution tracing, structured docs, design rule enforcement |
| Bounded Autonomy | `tx guard`, `tx verify`, `tx reflect`, `tx label` | Task limits, deterministic completion, retrospectives |

**Key design choices:**
- No orchestration opinions (serial, parallel, swarm — your choice)
- Lease-based task claiming (30min default, max 10 renewals, auto-expire)
- Hierarchical tasks: epics → milestones → tasks → subtasks
- JSONL git sync for multi-machine collaboration
- Hybrid search: BM25 + vector embeddings with RRF fusion
- Effect-TS service layer with structured error handling

## Where Flow and tx Overlap

### Task Management

| Concept | tx | Flow |
|---|---|---|
| Task claiming | `tx claim <id> <worker>` — lease-based, 30min default, max 10 renewals, auto-expire | `claimNextTask()` — SQLite IMMEDIATE transaction, atomic, no lease expiry (uses heartbeat instead) |
| Next task | `tx ready` — returns highest-priority unblocked task | `claimNextTask()` — finds pending task matching dependency/capability/gate checks |
| Dependencies | `tx block <id> --on <other>` — explicit blocking relationships | `depends_on` JSON column + `lib/db/dependencies.ts` with cycle detection |
| Completion | `tx done <id>` — mark complete | Worker writes `DONE` to `progress.txt`, system transitions to completed |
| Hierarchy | Epics → milestones → tasks → subtasks (4 levels) | Outcomes → tasks (2 levels, with auto-decomposition creating subtasks) |
| Scoring | Numeric priority with LLM-powered reprioritization | No explicit scoring — tasks claimed in order, HOMR steerer can reprioritize |

**Key difference**: tx's lease-based claiming with auto-expiry is more robust for distributed systems. Flow's heartbeat-based stale detection (5min timeout) achieves similar goals but requires the monitoring loop.

### Memory & Knowledge

| Concept | tx | Flow |
|---|---|---|
| Persistent learnings | `tx learning:add` — structured records in SQLite, attached to tasks/files | HOMR Observer auto-extracts discoveries → `homr_context` table |
| Context retrieval | `tx context <task-id>` — hybrid BM25+vector search on learnings | `buildTaskContext()` in steerer — queries HOMR context + memories |
| Cross-session memory | `tx memory` — indexes existing markdown files as knowledge graph with wikilinks | `memories` table with cross-outcome promotion, BM25+vector search |
| File-specific knowledge | `tx learn`/`tx recall` — attach learnings to file paths | No equivalent — learnings are task-level, not file-level |
| Feedback loop | `tx learning:helpful` — rate whether a learning was useful | No equivalent — no learning effectiveness tracking |

**Key difference**: tx separates "learnings" (structured insights in SQLite) from "memory" (filesystem-backed document search). Flow merges these concepts — HOMR discoveries are learnings, memories table is cross-outcome knowledge. tx's `learning:helpful` feedback loop is notably absent from Flow.

### Safety & Bounded Autonomy

| Concept | tx | Flow |
|---|---|---|
| Command guard | `tx guard` — limits on pending tasks, children per parent, nesting depth | `lib/guard/index.ts` — blocks dangerous shell commands (rm -rf, force push) |
| Verification | `tx verify set <id> "npm test"` — deterministic exit-code checks | Reviewer agent (LLM-based) — checks against PRD success criteria |
| Reflection | `tx reflect` — SQL metrics + optional LLM synthesis, produces machine-readable signals | `improvement-analyzer.ts` — escalation pattern analysis, proposes improvement outcomes |
| Invariants | `tx invariant` — machine-checkable design rules extracted from docs | No equivalent — design doc is injected as context but not enforced programmatically |

**Key difference**: tx guards against *task proliferation* (too many tasks). Flow guards against *dangerous commands* (rm -rf). They protect different things. tx's `verify` is deterministic (exit code); Flow's review is LLM-based (subjective judgment). Both are needed.

### Coordination & Tracing

| Concept | tx | Flow |
|---|---|---|
| Attempt tracking | `tx try` — record what was attempted, success/fail, reasoning | No equivalent — retry workers start fresh with same CLAUDE.md |
| Checkpointing | `tx checkpoint` — structured mid-task progress saves (planned) | `progress.txt` STATUS lines — unstructured, lost on crash |
| Handoff | `tx handoff` — transfer task between agents with context (planned) | No equivalent — "Agent messaging" listed as Not Yet Built |
| Tracing | `tx trace` — IO capture, metrics events, heartbeat, transcripts | `progress_entries` with `full_output` — captures everything but unstructured |
| Agent messaging | `tx send`/`tx inbox` — async message passing between agents | No equivalent — HOMR steerer injects cross-task context but no direct messaging |

**Key difference**: tx's attempt tracking is a standout gap in Flow. When a task fails and gets retried, the new worker has zero knowledge of what the previous worker tried. This is probably Flow's biggest silent failure mode.

## What We Should Borrow (Ranked by Impact)

### 1. Deterministic Task Verification (`tx verify`)

**What**: Attach a shell command to a task. Exit code 0 = pass. No LLM judgment needed. `tx verify set task-123 "npm run typecheck && npm test"` then `tx verify run task-123 && tx done task-123`.

**Why it improves Flow**: The Reviewer agent is expensive, slow, and subjective. Many completion criteria are objectively verifiable — "does it compile?", "do tests pass?", "does the build succeed?" — without needing LLM analysis. Deterministic checks catch failures in seconds vs. minutes for an LLM review pass. They also provide an unambiguous pass/fail signal that doesn't drift with model behavior.

**What to change**:
- Add `verify_command` column to `tasks` table (nullable TEXT)
- During task generation, auto-attach verification commands where possible (typecheck for TS tasks, test suite for feature tasks, build for integration tasks)
- Add `verifyTask(taskId)` function that runs the command and returns pass/fail + output
- Modify worker completion flow: after `DONE` in progress.txt, run verify_command if present. If it fails, mark task as `failed` with verification output
- Reviewer agent only runs for tasks without verify_commands or for subjective criteria
- CLI: `flow task verify <id>`, `flow task add --verify "npm test"`
- Optional: JSON Schema validation for structured outputs (tx supports `--schema <path>`)

**Effort**: Low-Medium. Database migration, one new function, worker loop modification, CLI command.

### 2. Attempt Tracking (`tx try`/`tx attempts`)

**What**: Record what approach a worker tried, whether it worked, and why. On retry, inject the attempt history so the next worker knows what not to repeat. Each attempt captures: approach description, outcome (succeeded/failed), and reasoning.

**Why it improves Flow**: This is Flow's biggest silent failure mode. When a task fails and gets retried (up to 3 attempts), the new worker receives the exact same CLAUDE.md and has no idea what the previous worker tried. It frequently repeats the same failing strategy. With attempt tracking, workers see "Attempt 1 tried X, failed because Y" and can choose a different approach. This alone could dramatically improve retry success rates.

**What to change**:
- Add `task_attempts` table: `id`, `task_id`, `worker_id`, `approach_summary`, `outcome` ('succeeded'|'failed'), `reason`, `created_at`
- After task completion/failure in worker loop, extract a brief summary of the approach from `full_output` (could be as simple as the last STATUS line + error, or Claude-summarized)
- When generating CLAUDE.md for retry tasks (attempts > 0), include `## Previous Attempts` section with all recorded approaches and their outcomes
- CLI: `flow task attempts <id>` to view history
- Bonus: Feed attempt data into HOMR observer for cross-task learning ("approach X consistently fails for tasks of type Y")

**Effort**: Low-Medium. New table, extraction logic in worker completion, CLAUDE.md template update.

### 3. Mid-Task Checkpointing (`tx checkpoint`)

**What**: Save structured progress mid-task so another agent can resume where the last one left off. Checkpoints capture: what files were created/modified, what's done, what's remaining, and freeform notes.

**Why it improves Flow**: Turn exhaustion is a real and recurring problem. When a worker runs out of turns, the task is released back to pending, but the next worker starts completely from scratch — potentially redoing hours of work. The same applies to rate-limit pauses and manual worker stops. With checkpoints, partial progress is preserved and the next worker picks up where things left off.

**What to change**:
- Add `task_checkpoints` table: `id`, `task_id`, `worker_id`, `files_modified` (JSON), `progress_summary`, `remaining_work`, `notes`, `created_at`
- On turn exhaustion / rate-limit / worker pause: before releasing the task, capture a checkpoint by scanning the workspace for modified files and reading the last few STATUS lines from progress.txt
- When generating CLAUDE.md for a task with checkpoints, include `## Previous Progress` section with the checkpoint data and a clear instruction: "Continue from where the previous worker left off"
- Optionally: let workers write checkpoints periodically (every N iterations) as a safety net

**Effort**: Medium. New table, checkpoint extraction logic, CLAUDE.md template, integration with turn exhaustion and pause flows.

### 4. Task Proliferation Guards (`tx guard`)

**What**: Set hard limits on task creation to prevent unbounded growth. Three constraint types: `maxPending` (total non-done tasks), `maxChildren` (subtasks per parent), `maxDepth` (nesting levels). Advisory mode logs warnings; enforce mode blocks creation.

**Why it improves Flow**: Flow has several paths that create tasks dynamically — auto-decomposition, HOMR steerer, iterate feedback, capability planning, review cycles. A badly scoped outcome or aggressive decomposition can spawn dozens of tasks. Flow already has a circuit breaker for *workers* (consecutive failures → pause) but nothing for *tasks*. Guards prevent runaway task creation from consuming resources and making outcomes unmanageable.

**What to change**:
- Add guard configuration to `system_config` table: `max_pending_tasks` (default: 50), `max_subtask_depth` (default: 3), `max_children_per_task` (default: 10)
- Optional per-outcome overrides in `outcomes` table
- Check guards in all task creation paths: `createTask()`, `decomposeTask()`, `createCapabilityTasks()`, iterate → task creation, HOMR steerer `create_task` action
- Advisory mode first: log to `supervisor_alerts` when limits approached (80% threshold)
- Enforce mode: reject task creation with clear error message
- CLI: `flow config guard` to view/set limits
- Feed guard violations into `tx reflect`-style health metrics

**Effort**: Low-Medium. Config entries, guard check function called from task creation paths.

### 5. Structured Retrospectives (`tx reflect`)

**What**: SQL-powered session metrics (throughput, stuck tasks, proliferation patterns) with optional LLM synthesis. Produces machine-readable signals: `HIGH_PROLIFERATION` (more tasks created than completed), `STUCK_TASKS` (3+ failed attempts), `DEPTH_WARNING` (nesting exceeds limits), `PENDING_HIGH` (elevated pending count).

**Why it improves Flow**: Flow can look at individual worker logs and escalation patterns (via `improvement-analyzer.ts`), but there's no aggregate operational health view. You can't quickly answer: "Is this outcome healthy? Are workers making progress? Is task creation outpacing completion?" Structured retrospectives give the system self-awareness about its own operational state, enabling proactive intervention before problems compound.

**What to change**:
- Add `flow retro health` CLI command (or enhance existing `retro` subcommands)
- SQL queries: tasks created vs completed ratio, average task duration, failure rate by error category, worker utilization (time working vs idle), task age distribution
- Produce structured signals with severity levels
- Optional: feed signals into supervisor_alerts or surface on dashboard
- Optional: `--analyze` flag sends metrics to Claude for synthesis and recommendations

**Effort**: Low. SQL queries on existing tables, new CLI output format. The data already exists.

### 6. Design Rule Enforcement (`tx invariant`)

**What**: Extract machine-checkable rules from design documents. Track pass/fail with audit trail. Three enforcement modes: `integration_test` (run a test), `linter` (check a lint rule), `llm_as_judge` (evaluate with LLM prompt). Invariant IDs like `INV-AUTH-001` synced from YAML in design docs.

**Why it improves Flow**: Workers receive the design document in their CLAUDE.md but there's no automated verification that they *actually followed* it. A design doc might say "use Tailwind, not inline styles" or "validate all inputs with Zod" — but if a worker ignores this, it's only caught during manual review (if at all). Invariants make design intent enforceable.

**What to change**:
- Add `invariants` table: `id` (e.g., `INV-001`), `outcome_id`, `rule` (text), `enforcement` ('test'|'lint'|'llm'), `check_command` or `prompt`, `last_status`, `last_checked_at`
- During approach optimization, extract key invariants from the design doc (could be Claude-assisted: "What are the non-negotiable implementation rules in this design?")
- Run invariant checks alongside verify_commands after task completion
- Store check results for audit trail
- Surface violations in review cycles

**Effort**: Medium. New table, extraction during approach optimization, check execution in worker completion flow.

### 7. Learning Effectiveness Feedback (`tx learning:helpful`)

**What**: After a learning is surfaced to a worker, track whether it was actually helpful. Simple thumbs up/down that feeds back into search ranking.

**Why it improves Flow**: HOMR discoveries and cross-outcome memories are surfaced in worker context, but there's no signal on whether they're actually useful. Over time, the memories table could fill with low-value entries that dilute the good ones. Feedback enables the system to promote high-value learnings and deprecate unhelpful ones.

**What to change**:
- Add `helpfulness` column to `memories` table (or a separate `memory_feedback` table)
- After task completion, if the worker's output references or acts on a surfaced memory, mark it helpful
- Factor helpfulness into search scoring (boost helpful memories, demote unhelpful ones)
- Periodic cleanup: archive memories with consistently low helpfulness

**Effort**: Low. Column addition, scoring adjustment. The tricky part is detecting whether a memory was "used" — could start with simple keyword matching or Claude analysis in observer.

### 8. File-Specific Knowledge (`tx learn`/`tx recall`)

**What**: Attach learnings to specific file paths. When a worker is about to modify a file, auto-retrieve learnings attached to that file. "This file has a known issue with X" or "When changing Y, also update Z."

**Why it improves Flow**: Workers in codebase isolation mode modify shared project files. If one worker discovers "this API endpoint has an undocumented rate limit" or "this component breaks if you change the key prop," that knowledge is currently only in HOMR's outcome-scoped context. File-level learnings would survive across outcomes and be automatically surfaced when any worker touches that file.

**What to change**:
- Add `file_path` column to learnings/memories (nullable, for file-specific entries)
- When generating CLAUDE.md, check if any of the task's likely target files have attached learnings
- Surface them in a `## File Notes` section
- CLI: `flow learn <file> "note"`, `flow recall <file>`

**Effort**: Low-Medium. Schema change, query in CLAUDE.md generation, CLI commands.

## What We Should NOT Adopt

### "You Orchestrate It" Philosophy
tx deliberately provides no orchestration opinions. Flow's power comes from its opinionated two-phase orchestration, HOMR protocol, capability detection, and review cycles. Adopting tx's "bring your own orchestration" approach would mean throwing away Flow's most valuable architectural decisions.

### tx's Lease-Based Claiming (Replace Flow's Atomic Claiming)
tx uses time-based leases (30min, max 10 renewals). Flow uses atomic SQLite transactions with heartbeat monitoring. Flow's approach is simpler and sufficient for a single-machine system. Lease management adds complexity without benefit when you're not distributed.

### tx's MCP Server as Worker Tool
While tx exposes 42 MCP tools, adding tx as an MCP server for Flow workers would create confusion — workers would see two task systems (Flow's tasks and tx's tasks). The primitives should be integrated natively, not layered on top.

### tx's Task Hierarchy (Epics → Milestones → Tasks → Subtasks)
tx supports 4-level task hierarchies. Flow's 2-level model (outcomes → tasks, with decomposition creating flat subtasks) is intentionally simpler. Deep nesting creates cognitive overhead and coordination complexity that outweighs the organizational benefit for Flow's use case.

### JSONL Git Sync
tx syncs task state as JSONL files tracked in git for multi-machine collaboration. Flow uses SQLite directly and has its own repository sync system. Adding JSONL exports would be redundant and create sync conflicts.

### tx's Dashboard/Headful Experience
tx provides a web dashboard with keyboard shortcuts and command palette. Flow already has a richer, purpose-built Next.js UI. No need to adopt tx's UI patterns.

## Summary

| Idea | Impact | Effort | Recommendation |
|---|---|---|---|
| Deterministic task verification (`verify_command`) | High | Low-Med | **Do first** — objective pass/fail before expensive LLM review |
| Attempt tracking (approach history on retry) | High | Low-Med | **Do first** — eliminates Groundhog Day retry failures |
| Mid-task checkpointing | High | Medium | **Do second** — saves wasted work on turn exhaustion |
| Task proliferation guards | Medium | Low-Med | **Do second** — prevents runaway decomposition |
| Structured retrospectives | Medium | Low | **Do anytime** — easy win, data already exists |
| Design rule enforcement (invariants) | Medium | Medium | **Consider** — powerful but needs design doc format changes |
| Learning effectiveness feedback | Low-Med | Low | **Do anytime** — improves memory quality over time |
| File-specific knowledge | Low-Med | Low-Med | **Consider** — valuable for codebase-mode outcomes |

**Bottom line**: tx and Flow are complementary — tx is the plumbing, Flow is the house. tx's strongest ideas for Flow are about closing feedback loops: knowing what was tried before (attempts), knowing if it worked objectively (verify), not losing partial progress (checkpoints), and preventing runaway growth (guards). These fill real gaps in Flow without threatening its architectural strengths. The recommended approach is cherry-picking these primitives into Flow natively (Option B), not layering tx on top.
