# Flow 2.0: Cross-Research Synthesis

> Analysis of 11 research evaluations combined with real-world usage pain points to identify major re-architecture opportunities and quick wins for Flow 2.0.

## Source Material

This synthesis draws from all research evaluations in `docs/research/`:

| Research | Core Contribution |
|----------|-------------------|
| [ag-ui.md](./ag-ui.md) | Event streaming, state sync, structured interrupts |
| [tx-primitives.md](./tx-primitives.md) | Verification commands, attempt tracking, checkpointing, task guards |
| [loom-integration.md](./loom-integration.md) | Worker state machine, auto-commit, multi-LLM oracle, subscription pooling |
| [autoresearch.md](./autoresearch.md) | Metric-driven loops, keep/revert, research mode, simplicity criterion |
| [harness-engineering.md](./harness-engineering.md) | Deterministic quality gates, teaching errors, garbage collection |
| [agent-teams.md](./agent-teams.md) | Multi-agent within a single complex task |
| [mcp-integration.md](./mcp-integration.md) | Worker capability expansion (browser, DB, APIs) |
| [agent-messaging.md](./agent-messaging.md) | Inter-worker communication |
| [session-search.md](./session-search.md) | Cross-outcome knowledge retrieval |
| [multi-model-routing.md](./multi-model-routing.md) | Cost/speed optimization per task |
| [VECTOR-SEARCH-SQLITE.md](./VECTOR-SEARCH-SQLITE.md) | Already implemented (sqlite-vec) |

## User Pain Points Driving This Analysis

1. **Task generation is too shallow** — initial tasks are vague, workers get stuck, decomposition happens reactively mid-run instead of proactively
2. **No confidence in set-and-forget** — tasks fail, things go off the rails, no self-healing, user ends up in Claude Code debugging
3. **Planning happens outside Flow** — using Claude Code to interview, research, iterate on plans, then manually bringing it back to Flow
4. **HOMR complexity detection is too late** — problems discovered mid-execution, not pre-flight
5. **Frontend is secondary** — Telegram works well, Claude Code is the real power tool, web UI is buggy and not trusted
6. **Direction**: Telegram-first, voice while cycling, client-facing agents, long-running autonomous operation

---

## Big Re-Architecture Ideas

### 1. The Discovery Engine — Fix the "garbage in" problem

**Combines**: Pain about shallow tasks + autoresearch's constrained action spaces + harness engineering's architectural constraints + tx's verification + agent teams

**The problem**: Flow's current flow is `ramble → intent optimization → task generation → workers`. The task generation step produces shallow, vague tasks because it happens in a single Claude call with no research, no interview, no decomposition analysis. The user compensates by doing deep planning in Claude Code first, then manually feeding it to Flow.

**The idea**: Replace the current single-shot task generation with a **multi-turn discovery agent** that runs *before* any worker touches anything. This agent:

1. **Interviews you** — asks clarifying questions about scope, constraints, success criteria (like Claude Code naturally does). Works via Telegram voice messages or text.
2. **Researches** — uses WebSearch/WebFetch/MCP to understand the domain, check existing code, look at competitors, read documentation
3. **Proposes a plan** — decomposed tasks that are already worker-ready (not "build the frontend" but "create React component X with props Y, verify with `npm run typecheck`")
4. **Attaches verification commands** — every task gets a `verify_command` where possible (tx's `verify` + harness engineering's deterministic gates)
5. **Attaches complexity estimates** — pre-scores every task so decomposition happens at planning time, not mid-run
6. **Sets invariants** — extracts design rules from the approach doc that can be mechanically checked (tx's `invariant`)
7. **You approve/edit** — iteratively, via Telegram or web

**Why this is transformative**: It moves the intelligence upstream. Instead of "generate tasks → hope workers don't get stuck → escalate → decompose → retry", you get "deeply plan → verify plan is worker-ready → execute with confidence". The discovery agent is essentially what the user already does manually in Claude Code, but automated and integrated into Flow.

**What changes**:
- New `lib/agents/discovery-agent.ts` — multi-turn planning agent with tool access
- Replace single-shot `generateTasksFromIntent()` with discovery agent session
- Tasks created with `verify_command`, `complexity_score`, `decomposition_status: 'pre-checked'`
- New conversation flow in Telegram: discovery agent interviews you, proposes tasks, you approve
- Outcome creation becomes a conversation, not a form submission

---

### 2. The Resilient Worker — Fix the "everything breaks" problem

**Combines**: Loom's state machine + tx's attempt tracking + tx's checkpointing + harness engineering's teaching errors + Loom's auto-commit + Loom's subscription pooling + autoresearch's crash recovery

**The problem**: When tasks fail, workers die, or rate limits hit, the whole system falls apart. Retries repeat the same mistakes. Partial progress is lost. Manual intervention required.

**The idea**: Rebuild the Ralph worker as a **self-healing state machine** with memory:

1. **Explicit state machine** (from Loom) — not 2500 lines of imperative code, but named states with deterministic transitions: `Claiming → PreFlight → Executing → PostTask → Observing → NextTask`, with error substates: `RateLimited → PoolRotation → Retry`, `Failed → TeachingErrors → Retry`, `TurnExhausted → Checkpoint → Release`
2. **Auto-commit after every turn** (from Loom) — each Claude CLI turn that modifies files gets a git commit. Failed tasks have a reviewable commit history. HOMR can diff commits instead of parsing raw output.
3. **Attempt tracking** (from tx) — when a task fails, record what was tried and why it failed. On retry, inject previous attempts into CLAUDE.md: "Attempt 1 tried X, failed because Y. Try a different approach."
4. **Mid-task checkpointing** (from tx) — on turn exhaustion, rate limit, or pause, save structured progress (files modified, what's done, what remains). Next worker picks up where the last left off instead of starting from scratch.
5. **Deterministic verification** (from tx + harness engineering) — run `verify_command` after task completion. Exit code 0 = pass. Only fall back to LLM review for tasks without objective verification.
6. **Subscription pooling** (from Loom) — when rate limited, rotate to next Claude profile instead of pausing all workers.
7. **Teaching errors** (from harness engineering) — failed verification output becomes structured context for retry: "TypeScript compilation failed: error TS2345 at line 42. The previous worker passed a string where number was expected."

**Why this is transformative**: This turns Flow from a system that needs babysitting into one you can trust overnight. The combination of attempt tracking + teaching errors + checkpointing means retries actually get smarter, not just repeat. Auto-commit means you can always roll back. Subscription pooling means rate limits don't halt everything.

**What changes**:
- Refactor `lib/ralph/worker.ts` into state machine pattern (~high effort but incremental)
- New `task_attempts` table for approach history
- New `task_checkpoints` table for mid-task progress
- Add `verify_command` column to tasks
- Post-turn git commit hook in worker
- Subscription pool config in `system_config`

---

### 3. The Event Backbone — Fix the "polling everywhere" problem and enable voice/Telegram-first

**Combines**: AG-UI's event streaming + state sync + interrupts + Telegram/voice vision

**The problem**: 12+ `setInterval` polls across the UI (3-30 second delays), gates/escalations are disconnected from the execution context, Telegram integration relies on the same polling APIs, and there's no foundation for real-time voice interaction.

**The idea**: Replace the entire polling architecture with an **event bus** that pushes typed events to all connected clients (web UI, Telegram bot, CLI, future voice interface):

1. **SSE endpoint** — `app/api/outcomes/[id]/stream/route.ts` emits typed events: `worker.started`, `task.completed`, `escalation.created`, `gate.triggered`, `progress.update`, etc.
2. **State sync** (from AG-UI) — initial `SNAPSHOT` on connect, then `DELTA` events (JSON Patch) for efficient updates
3. **Structured interrupts** (from AG-UI) — when a worker hits a gate or HOMR creates an escalation, emit an `INTERRUPT` event with structured data. The client (web, Telegram, voice) renders the appropriate UI. User responds. Worker resumes immediately.
4. **Client-agnostic events** — same event stream drives the web UI, Telegram bot, and future voice interface. Each client renders events in its own way:
   - Web: React components with real-time updates
   - Telegram: formatted messages with inline keyboards for interrupts
   - Voice: spoken summaries with approval via voice command

**Why this is transformative**: This is the infrastructure that makes Telegram-first and voice-while-cycling actually work. Instead of the Telegram bot polling Flow's API, it subscribes to the event stream and gets instant notifications. Gates and escalations become interactive Telegram messages. You ride your bike, get a voice notification "Worker 3 needs approval to proceed with the database migration", say "approved", and the worker continues.

**What changes**:
- New SSE endpoint and event bus (in-memory pub/sub or DB-backed)
- `useEventStream` React hook replaces all `setInterval` polling
- Telegram bot subscribes to event stream instead of polling
- `InterruptEvent` type and handler for gates/escalations
- Foundation for future voice interface

---

### 4. Research Mode — A fundamentally new outcome type

**Combines**: Autoresearch's metric loop + keep/revert + fixed-budget + experiment tracking + simplicity criterion

**The problem**: Flow is built for "complete a PRD" outcomes. But many valuable outcomes are optimization problems: improve test coverage, reduce bundle size, tune a prompt, find the best architecture. These don't fit the task-completion model.

**The idea**: Add a **research mode** where workers run an infinite hill-climbing loop against a measurable metric:

1. Worker modifies code/config → commits → runs evaluation → metric improved? Keep. Worse? Revert.
2. All experiments tracked in an `experiments` table with metric values
3. HOMR analyzes experiment *trends* instead of individual task outputs (plateau detection, diminishing returns)
4. Fixed time budget per experiment for fair comparison
5. Multiple workers can run concurrently, sharing results via HOMR so they don't duplicate failed experiments
6. Simplicity criterion injected into worker context: "prefer smaller changes, value removing complexity"

**Why this is transformative**: Opens entirely new use cases for Flow — ML training optimization, prompt engineering, performance tuning, A/B testing — that currently require manual iteration. The hill-climbing loop with objective metrics is radically more efficient than LLM-judged task completion for quantifiable goals.

**What changes**:
- `outcome_type` enum: `standard` | `research`
- `metric_command`, `metric_baseline`, `time_budget_seconds` on tasks
- `experiments` table
- Worker research loop variant (~200 lines alongside existing task loop)
- Experiment visualization UI/CLI

---

### 5. Client-Facing Agent Gateway — Flow as a service

**Combines**: AG-UI's frontend tool calls + client-facing vision + MCP integration + the discovery engine

**The problem**: Flow is a personal tool with no external-facing surface. The user wants to give clients a structured interface that collects requirements and feeds them into Flow.

**The idea**: Build a **gateway agent** that sits between external clients and Flow:

1. **Client intake bot** — a Telegram bot (or web form, or API) that interviews clients using a structured skill. Collects requirements, constraints, examples, assets.
2. **Outcome creation** — gateway agent creates a Flow outcome from the client conversation, with user cc'd for approval (gate on the outcome before workers start)
3. **Progress updates** — gateway pushes event stream updates to the client in their format (Telegram messages, email summaries, webhook)
4. **Delivery** — when the outcome completes, gateway notifies the client and shares outputs
5. **Iteration** — client can provide feedback through the gateway, which creates iterate tasks

This is Flow-as-a-service. The user is the orchestrator, Flow does the work, clients interact through a controlled interface.

**What changes**:
- Gateway agent skill (`skills/client-gateway.md`)
- Client-specific Telegram bot (or shared bot with client routing)
- Gate on outcome creation requiring user approval
- Client-facing event stream (filtered — they don't see worker internals)
- API key/auth for client access

---

### 6. The Oracle Network — Multi-LLM intelligence

**Combines**: Loom's oracle pattern + multi-model routing + agent teams' reviewer teammate

**The problem**: Everything runs through Claude CLI. Workers get stuck in reasoning loops. HOMR observation is Claude judging Claude. No diversity of perspective.

**The idea**: Add a **multi-LLM layer** where different models serve different roles:

1. **Oracle tool for workers** (from Loom) — workers can consult GPT-4o/Gemini mid-task for a second opinion. File-based: write question to `oracle_query.txt`, watcher sends to second LLM, response in `oracle_response.txt`.
2. **HOMR cross-validation** — observer uses a second LLM to validate alignment scores. "Claude says this task is 85% aligned. GPT says 60%. Flag for review."
3. **Smart routing** (from multi-model routing) — simple tasks (formatting, renaming, boilerplate) route to fast/cheap models. Complex reasoning stays on Claude Opus.
4. **Review diversity** — reviewer agent runs parallel checks with different models

**What changes**:
- Oracle watcher service (small Node process watching for query files)
- API key management for secondary providers
- HOMR observer dual-check mode
- Task routing based on complexity score

---

## Quick Wins (implement any time, minimal effort)

| # | Idea | Source | Effort | What It Does |
|---|------|--------|--------|-------------|
| 1 | **Simplicity criterion in CLAUDE.md** | Autoresearch | Tiny | Add "prefer simpler solutions" to worker instructions. Reduces complexity drift. |
| 2 | **Attempt tracking on retries** | tx | Low | Record what previous workers tried. Inject into retry context. Eliminates Groundhog Day failures. |
| 3 | **Task proliferation guards** | tx | Low | Hard limits on pending tasks, subtask depth, children per parent. Prevents runaway decomposition. |
| 4 | **`verify_command` on tasks** | tx + Harness | Low-Med | Attach `npm run typecheck && npm test` to tasks. Objective pass/fail before LLM review. |
| 5 | **Learning effectiveness feedback** | tx | Low | Track whether surfaced memories were actually useful. Improve memory quality over time. |
| 6 | **Secret redaction on output** | Loom | Medium | Scrub API keys/tokens from stored worker output. Security hygiene. |
| 7 | **Structured retro health metrics** | tx | Low | SQL queries on existing data: task creation vs completion ratio, failure rates, worker utilization. |
| 8 | **Research loop skill template** | Autoresearch | Small | Markdown skill for optimization outcomes. Works with current infrastructure, no code changes. |

---

## How These Pieces Connect (The Compound Effect)

The real power isn't any single idea — it's how they chain together:

```
Discovery Engine (deep planning)
    → Tasks with verify_commands + pre-decomposed + complexity-scored
    → Resilient Worker (state machine + auto-commit + attempt tracking)
        → Deterministic verification before LLM review
        → On failure: teaching errors + checkpoint → smarter retry
        → On success: auto-commit history for HOMR to analyze diffs
    → Event Backbone (SSE)
        → Telegram gets instant updates while you cycle
        → Interrupts render as Telegram inline keyboards
        → Client gateway pushes filtered events to clients
    → Oracle Network
        → Workers consult second LLM when stuck (instead of failing)
        → HOMR cross-validates with second model
        → Catch mistakes before they compound across tasks
```

**The end state**: You tell Flow what you want via voice message on your bike. The discovery engine interviews you in a few back-and-forth messages. It creates decomposed, verified, worker-ready tasks. Workers execute with auto-commit, attempt tracking, and checkpointing. If something fails, the next worker knows what was tried. If a gate triggers, your phone buzzes and you approve with a tap. If a client needs something, they talk to the gateway bot and you approve the outcome. You check in the next morning and see a clean commit history, experiment results, and completed work.

---

## Recommended Phasing

| Phase | Focus | Effort |
|-------|-------|--------|
| **Phase 1: Stop the bleeding** | Attempt tracking, verify commands, simplicity criterion, task guards | Low — all quick wins that fix the "everything breaks" pain |
| **Phase 2: Event backbone** | SSE endpoint, replace polling, Telegram event subscription | Medium — infrastructure that enables everything else |
| **Phase 3: Resilient worker** | State machine refactor, auto-commit, checkpointing, teaching errors | High — the core reliability rewrite |
| **Phase 4: Discovery engine** | Multi-turn planning agent, pre-decomposition, interview flow | Medium — fixes the "garbage in" problem |
| **Phase 5: New capabilities** | Research mode, oracle network, client gateway | Medium each — new outcome types and interfaces |
