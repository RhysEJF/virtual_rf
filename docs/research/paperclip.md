# Paperclip: Integration Analysis for Flow

> Open-source AI company orchestration platform (20k+ GitHub stars) that models agent teams as corporate org charts with budgets, governance, and heartbeat-based scheduling. Different philosophy than Flow but several ideas worth stealing.

## Source Material

- [Paperclip Website](https://paperclip.ing/) — landing page and feature overview
- [GitHub: paperclipai/paperclip](https://github.com/paperclipai/paperclip) — MIT licensed, TypeScript, Node.js + React + PostgreSQL
- [VibeSparking Deep Dive](https://www.vibesparking.com/en/blog/ai/agent-orchestration/2026-03-05-paperclip-open-source-orchestration-zero-human-companies/) — technical overview article

## What Is Paperclip?

Paperclip is an open-source orchestration platform for managing teams of AI agents modeled as a corporate organization. Where Flow treats AI workers as autonomous executors of user-defined outcomes, Paperclip treats them as *employees* in a company with org charts, job titles, reporting lines, budgets, and governance structures. A single deployment can run multiple "companies," each with isolated data.

The core abstraction is the **company**: a mission statement that cascades through goals → projects → issues (tickets), with agents assigned roles (CEO, CTO, Content Writer) and budgets. Agents wake on scheduled **heartbeats**, check their assigned work, execute tasks, and report results. The human user acts as the "board of directors" — approving hires, strategies, and budgets.

Paperclip is deliberately **agent-agnostic**. It doesn't care what runtime an agent uses — Claude Code, OpenClaw, Codex, Cursor, Bash scripts, HTTP webhooks — anything that can receive a heartbeat signal qualifies. This "Bring Your Own Agent" philosophy means Paperclip is purely the orchestration and governance layer, not the execution layer.

The project is well-engineered: 95% TypeScript, Drizzle ORM with PostgreSQL, clean service layer architecture, proper config versioning with rollback, immutable audit logs, and real-time SSE events. ~879 commits, 20.5k stars, active community.

## Core Architecture

| Component | Implementation |
|-----------|---------------|
| **Backend** | Node.js + Express, Drizzle ORM |
| **Database** | PostgreSQL (embedded for local, managed for prod) |
| **Frontend** | React dashboard |
| **Agent Adapters** | Process (shell), HTTP, Codex, Cursor — pluggable registry |
| **Events** | In-memory EventEmitter per company, SSE to clients |
| **Auth** | JWT tokens per agent, board-level user auth |
| **Skills** | Markdown SKILL.md files injected at runtime |

### Key Services (from `server/src/services/`)

- **`heartbeat.ts`** — Core scheduling loop. Manages wakeup requests, concurrent run limits, session persistence across heartbeats, log capture, and result summarization.
- **`costs.ts`** — Per-agent budget enforcement. Atomic cost event recording, auto-pause at budget limit, per-agent/project/company aggregation.
- **`agents.ts`** — Agent CRUD with config versioning. Every config change creates a revision with rollback capability. Shortname resolution, API key management.
- **`issues.ts`** — Ticket system (backlog → todo → in_progress → in_review → blocked → done → cancelled). Status side effects (auto-set startedAt, completedAt). Atomic checkout prevents double-assignment.
- **`goals.ts`** — Hierarchical goal tree (company → project → task level). Every issue traces back to a company goal.
- **`approvals.ts`** — Governance gates. Pending → approved/rejected/revision_requested workflow. Applied on approval (e.g., hire-hook creates agents).
- **`live-events.ts`** — In-memory EventEmitter, SSE subscriptions per company. Simple but effective.
- **`activity-log.ts`** — Append-only audit log with redaction support. Every action logged with actor, entity, details.

### Process Adapter (`adapters/process/execute.ts`)

Spawns child processes with configurable command, args, cwd, env, timeout. Captures stdout/stderr. Timeout with grace period. Very similar to Flow's Ralph worker spawning Claude CLI — but generalized to any command.

## Where Flow and Paperclip Overlap

### 1. Agent Orchestration
- **Paperclip**: Heartbeat-based scheduling. Agents wake on intervals, check work queue, execute, sleep. Persistent session state across heartbeats. Configurable concurrency per agent.
- **Flow today**: Ralph worker loop — claim task, spawn Claude CLI, monitor progress.txt, repeat. No scheduling; workers run continuously until paused/stopped.
- **Gap/Opportunity**: Paperclip's heartbeat model is better for cost control and multi-agent scenarios. Flow's continuous loop is better for throughput on single outcomes. Flow has no concept of scheduled agent wake cycles.

### 2. Task/Work Management
- **Paperclip**: Issues (tickets) with rich status flow (backlog → todo → in_progress → in_review → blocked → done → cancelled). Atomic checkout. Comments/threads. Labels. Parent-child issues.
- **Flow today**: Tasks with simpler status flow (pending → claimed → running → completed → failed). Dependencies, gates, decomposition. No comment threads on tasks.
- **Gap/Opportunity**: Paperclip's `in_review` and `blocked` statuses are explicit; Flow handles these implicitly (HOMR review, dependency blocking). Paperclip's issue comments/threads are useful for audit trail.

### 3. Cost Tracking
- **Paperclip**: Per-agent monthly budgets in cents. Atomic cost event recording. Auto-pause when budget exhausted. Dashboard with per-agent/project/company breakdowns. First-class concern.
- **Flow today**: `worker.cost` field updated during execution. No budget limits. No auto-pause on cost. Cost is tracked but not enforced.
- **Gap/Opportunity**: **This is the biggest gap.** Flow has zero cost enforcement. A runaway worker can burn unlimited Claude subscription time. Paperclip's atomic budget enforcement with auto-pause is exactly what Flow needs for overnight runs.

### 4. Governance / Human-in-the-Loop
- **Paperclip**: Approval system with pending → approved/rejected → applied workflow. Config changes require approval. Agent hires require board approval. Full revision history with rollback.
- **Flow today**: Gates (document_required, human_approval) on tasks. HOMR escalations. Auto-resolve with confidence thresholds.
- **Gap/Opportunity**: Flow's gate system is task-level; Paperclip's approval system is config-level (agent changes, strategy changes). Flow doesn't have config versioning with rollback. Paperclip doesn't have Flow's nuanced auto-resolve with confidence thresholds.

### 5. Event Systems
- **Paperclip**: In-memory EventEmitter per company, SSE to clients. `publishLiveEvent()` called from services. Event types: `activity.logged`, agent status changes, etc.
- **Flow today**: Event bus with typed events (`worker.*`, `task.*`, `homr.*`, `gate.*`, `experiment.*`), SSE endpoint, React hooks, SQLite persistence with 7-day retention.
- **Gap/Opportunity**: Flow's event system is more mature — persistence, typed hierarchy, wildcard subscriptions, write-behind batching. Paperclip's is simpler (in-memory only, no persistence).

### 6. Audit Logging
- **Paperclip**: Dedicated `activityLog` table. Every action logged with actor type (agent/user/system), action, entity, details. Redaction support for sensitive data. Append-only.
- **Flow today**: `progress_entries` for worker iterations. `events` table for event bus. HOMR observations. No unified audit log.
- **Gap/Opportunity**: Paperclip's unified audit log with redaction is cleaner. Flow's audit data is scattered across multiple tables.

### 7. Agent Configuration
- **Paperclip**: Agent config revisions. Every change to an agent (name, role, adapter, budget, capabilities) creates a new revision. Rollback to any previous revision. Diff support.
- **Flow today**: Worker config is implicit (outcome settings + system config). No revision history. No rollback.
- **Gap/Opportunity**: Config versioning is elegant for a multi-agent system. Less critical for Flow's single-worker-per-outcome model, but useful for system config changes.

### 8. Skills
- **Paperclip**: SKILL.md files injected at runtime during heartbeats. Agent learns workflows without retraining.
- **Flow today**: Three-tier skill system (app, user, outcome). Skills injected into CLAUDE.md. Skill builder, scanner, reverse search.
- **Gap/Opportunity**: Flow's skill system is significantly more mature. Paperclip's is basic in comparison.

### 9. Multi-Agent Coordination
- **Paperclip**: Org chart hierarchy. Delegation up/down reporting lines. Role-based assignment. Multiple agents per company (20+ typical).
- **Flow today**: Single worker per outcome (sequential). HOMR provides cross-task intelligence. No org chart or role concept. Worker-to-worker coordination via event bus (stigmergy signals planned).
- **Gap/Opportunity**: Paperclip is built for multi-agent from the ground up. Flow is built for single-agent depth. Different design choices, not necessarily a gap to close.

## What We Should Borrow (Ranked by Impact)

### 1. Per-Outcome Cost Budgets with Auto-Pause — HIGH IMPACT

**What**: Set a cost budget per outcome (or per worker). Auto-pause worker when budget is exhausted. Soft warning at 80%.

**Why it improves Flow**:
- Prevents runaway overnight runs from burning unlimited subscription time
- Gives users confidence to start workers unattended
- The `worker.cost` field already tracks spend — just needs enforcement
- Directly addresses the "trust it to run overnight" use case

**What to change**:
- Add `budget_cents` column to `outcomes` table (nullable, null = unlimited)
- Add `getOutcomeBudget()` / `setOutcomeBudget()` to `lib/db/system-config.ts`
- In `lib/ralph/worker.ts`, check budget before claiming next task (between-task window)
- Add budget display + input to outcome page and Settings
- Add `budget` CLI option to `flow start` and `flow config`

**Effort**: Low. The cost tracking already exists. Just add the check + pause logic.

### 2. Unified Audit Log with Redaction — MEDIUM IMPACT

**What**: Single `audit_log` table that captures all system actions (worker started, task claimed, escalation created, config changed, intervention sent) with actor attribution and sensitive data redaction.

**Why it improves Flow**:
- Currently audit data is scattered across `progress_entries`, `events`, `review_cycles`, `interventions`, `guard_blocks`
- No single place to answer "what happened to this outcome in the last hour?"
- Redaction support important when logging worker output that may contain secrets
- Foundation for compliance and debugging

**What to change**:
- Create `audit_log` table: `id, outcome_id, actor_type (worker/user/system/homr), actor_id, action, entity_type, entity_id, details (JSON), created_at`
- Add `logAuditEvent()` function called from key points (worker.ts, orchestrator.ts, HOMR modules, API routes)
- Add redaction utility for sensitive patterns (API keys, tokens)
- Add Audit Log viewer to outcome page (or new `/audit` page)

**Effort**: Medium. New table + logging calls across existing code + UI.

### 3. Issue/Task Comment Threads — MEDIUM IMPACT

**What**: Allow comments on tasks, creating a threaded conversation log. Workers, HOMR, and users can all add comments.

**Why it improves Flow**:
- Currently worker observations, escalations, and user interventions are disconnected from the task they relate to
- A comment thread on a task would unify: HOMR observations about that task, user interventions targeting that task, worker progress notes, gate responses
- Makes task history much more readable than piecing together multiple tables

**What to change**:
- Create `task_comments` table: `id, task_id, author_type (worker/user/homr), author_id, content, created_at`
- Post HOMR observations as task comments
- Post interventions as task comments
- Post gate responses as task comments
- Add comment thread UI to ExpandableTaskCard expanded view

**Effort**: Medium. New table + integration points + UI.

### 4. Approval Workflows for Dangerous Operations — LOW IMPACT

**What**: Require explicit approval before certain operations: starting workers on production codebases, archiving outcomes with running workers, changing isolation mode.

**Why it improves Flow**:
- Guard rails complement the existing destructive command guard
- Prevents accidental damage from CLI automation
- Paperclip's approval → applied pattern is clean

**What to change**:
- Extend existing `interventions` table or create `approvals` table
- Add approval checks before `startRalphWorker()` when isolation_mode is 'codebase'
- Add approval flow in Settings for system-level changes
- Could integrate with existing gate system

**Effort**: Medium. But low priority — Flow is personal-use, not multi-tenant.

### 5. Heartbeat Scheduling Mode — LOW IMPACT (for now)

**What**: Option to run workers on a schedule (every N minutes) instead of continuously, with session persistence between heartbeats.

**Why it improves Flow**:
- Reduces cost for outcomes that don't need continuous attention
- Useful for monitoring/maintenance outcomes
- Enables "check on this every hour" workflows

**What to change**:
- Add `schedule_interval_minutes` to workers table
- Add cron-like scheduler to `lib/ralph/worker.ts`
- Persist worker session state between heartbeats (checkpoint system partially covers this)

**Effort**: High. Fundamentally different execution model from current continuous loop. Defer until multi-worker is needed.

## What We Should NOT Adopt

- **Org chart / corporate hierarchy** — Flow is a personal tool, not a multi-tenant business. The company/role/reporting-line abstraction adds complexity without value for single-user operation. Flow's flat outcome → tasks model is simpler and sufficient.

- **PostgreSQL** — Paperclip uses Postgres for multi-company data isolation and concurrent access. Flow's SQLite is perfect for single-user, zero-config operation. The migration cost and operational overhead isn't justified.

- **Multi-company / multi-tenant** — Flow is one user, one system. Data isolation between "companies" is unnecessary complexity.

- **Agent-agnostic adapter registry** — Paperclip supports any agent runtime. Flow is purpose-built for Claude Code CLI. The tight integration (CLAUDE.md generation, progress.txt monitoring, intervention system) is a feature, not a limitation. Generalizing would lose the deep integration advantages.

- **Board approval for everything** — Paperclip requires board approval for agent hires and strategy changes. Flow's auto-resolve with confidence thresholds is more efficient for a personal tool. Over-governance slows down a single user.

## Summary

| Idea | Impact | Effort | Recommendation |
|------|--------|--------|----------------|
| Cost budgets with auto-pause | HIGH | Low | **Build immediately** — biggest safety gap |
| Unified audit log + redaction | MEDIUM | Medium | Build in next cycle — improves debuggability |
| Task comment threads | MEDIUM | Medium | Build in next cycle — unifies scattered context |
| Approval for dangerous ops | LOW | Medium | Defer — personal tool doesn't need heavy governance |
| Heartbeat scheduling | LOW | High | Defer — only matters for multi-worker/monitoring use cases |

**Bottom line**: Paperclip solves a fundamentally different problem — orchestrating *teams* of diverse agents across *business operations*. Flow solves *deep single-agent execution* of complex technical outcomes. The systems barely compete. But Paperclip's **cost budget enforcement** is a genuine gap in Flow that directly affects the "trust it overnight" use case, and their **unified audit log** is a cleaner pattern than Flow's scattered logging. Everything else (org charts, multi-tenant, agent-agnostic adapters) is complexity Flow doesn't need. The biggest lesson is philosophical: Paperclip treats agents as employees to be managed; Flow treats agents as autonomous workers to be empowered. Both are valid — Flow's approach produces better individual task quality, Paperclip's scales better across many simple tasks.
