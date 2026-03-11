# Loom: Integration Analysis for Flow

> Full-stack Rust AI coding agent with explicit state machines, per-operation VCS snapshots, multi-LLM consultation, and subscription pooling — complementary to Flow as a better individual agent runtime.

## Source Material

- **Repository**: [https://github.com/ghuntley/loom](https://github.com/ghuntley/loom)
- **Author**: Geoffrey Huntley
- **Language**: Rust (~2000 files, 90+ crate workspace)
- **Architecture**: Client-server model where API keys never leave the server

## What Is Loom?

Loom is a self-hosted AI coding agent built entirely in Rust. Where Flow is a *workforce management system* that orchestrates multiple Claude CLI processes, Loom is a single-agent developer tool — essentially building a Claude Code alternative from scratch with full infrastructure control.

**Core philosophy**: Modularity, extensibility, and user sovereignty over API keys, infrastructure, and data.

### Key Components

| Component | What It Does |
|-----------|-------------|
| **loom-cli** | TUI-based agent client (Ratatui) |
| **loom-server** | HTTP proxy that holds API keys, routes LLM requests |
| **Agent State Machine** | 7-state synchronous FSM driving the agent loop |
| **Spool** | Fork of Jujutsu (jj) VCS with per-operation snapshots |
| **Weavers** | Ephemeral Kubernetes pods for remote execution |
| **Oracle** | Tool that lets Claude consult GPT-4o mid-task |
| **OAuth Pool** | Multiple subscription rotation with quota failover |
| **eBPF Auditing** | Kernel-level syscall tracing for security monitoring |
| **Secret Redaction** | Two-layer defense (compile-time type + runtime gitleaks patterns) |

### How It Works

```
loom-cli (client) → HTTP → loom-server → Anthropic/OpenAI APIs
```

The CLI talks to `loom-server` via HTTP proxy endpoints (`/proxy/anthropic/complete`, `/proxy/openai/stream`). The server holds all provider credentials and routes requests. A single server can serve multiple clients with centralized credential management.

### Agent State Machine

The core is an explicit, synchronous state machine with 7 states:

```
WaitingForUserInput → CallingLlm → ProcessingLlmResponse → ExecutingTools → PostToolsHook → CallingLlm
                                                                                              ↕
                                                                                         Error (with retry)
                                                                                         ShuttingDown
```

The state machine receives `AgentEvent`s and returns `AgentAction`s. **Critical design decision**: the state machine is pure and synchronous — the caller handles all async I/O. This makes it deterministic, testable, and replayable.

### Tool System

- `bash` — shell execution with workspace sandboxing, timeout, output truncation
- `read_file` — file reading with 1MB limit
- `list_files` — directory listing
- `edit_file` — snippet-based text replacement (same paradigm as Claude Code's Edit tool)
- `oracle` — queries a second LLM (OpenAI) through the server proxy for a "second opinion"
- `web_search` — Google CSE via server proxy

### Auto-Commit as Infrastructure

After mutating tool executions (`edit_file`, `bash`), a post-tool hook automatically:
1. Stages all changes
2. Uses Claude Haiku via the LLM proxy to generate a conventional commit message from the diff
3. Commits

This is **invisible to the agent** — it's infrastructure behavior, not an agent tool. The state machine has a dedicated `PostToolsHook` state for this.

### Spool: jj Fork with Per-Operation Snapshots

A fork of Jujutsu (jj) version control with a weaving-themed renaming:

| Git/jj Term | Spool Term |
|-------------|-----------|
| Changes | Stitches |
| Commits | Knots |
| Bookmarks | Pins |
| Rebase | Rethread |
| Conflicts | Tangles |
| Undo | Unpick |

Each tool execution automatically creates a stitch, and the agent can "unpick" (undo) failed operations without losing subsequent work.

### OAuth Pool with Quota Failover

Pools multiple Claude Pro/Max OAuth subscriptions. When one hits the 5-hour rolling quota, automatically fails over to the next available account. Includes:
- Error classification (transient vs quota vs permanent)
- Configurable cooldown periods
- Automatic rotation without user intervention

### Security: Two-Layer Secret Redaction

**Layer 1 — Compile-time**: `loom-secret::Secret<T>` wrapper that auto-redacts in Debug/Display/Serialize/tracing. You must call `.expose()` to access the raw value.

**Layer 2 — Runtime**: `loom-redact` crate with 200+ regex patterns from gitleaks, compiled at build time via `build.rs`. Includes Shannon entropy checks and keyword pre-filtering. A custom `RedactingMakeWriter` filters secrets from all log output.

### Other Notable Patterns

- **Property-based testing** (`proptest`) on every tool, type, and state transition
- **Thread persistence** as JSON documents with UUID7 IDs (time-sortable), FTS5 search
- **eBPF syscall auditing** sidecar on Kubernetes pods (captures exec, file writes, network, DNS, privilege changes)
- **WireGuard VPN** with DERP relay for NAT traversal to Weaver pods
- **Agent Client Protocol (ACP)** integration for editor support (Zed, VSCode)
- **Every TUI widget is its own crate** — maximizes incremental compilation caching
- **Nix for reproducible builds** — auto-deploy on push to `trunk`

## Where Flow and Loom Overlap

### Architecture Comparison

| Dimension | Flow | Loom |
|-----------|------|------|
| **Scope** | Multi-agent workforce manager | Single-agent developer tool |
| **Execution** | Spawns Claude CLI processes | *Is* the CLI (custom agent loop) |
| **Orchestration** | Two-phase (capability → execution) with HOMЯ oversight | Single state machine, no multi-task orchestration |
| **Memory** | HOMЯ cross-task context store + global memories table | Thread persistence (JSON), no cross-thread learning |
| **Skills** | 3-tier skill injection (app/user/outcome) | No skill system |
| **Self-improvement** | Escalation analysis → improvement outcomes → retros | None |
| **Language** | TypeScript/Next.js | Rust |
| **VCS** | Standard git (no per-operation tracking) | Spool (jj fork) with per-operation snapshots |
| **Safety** | Destructive command guard + workspace isolation | eBPF syscall auditing + secret redaction |
| **Infra** | Local SQLite, runs on Mac | K8s weavers, WireGuard tunnels, Nix deployments |
| **Multi-LLM** | Claude only | Oracle tool (Claude + GPT), pluggable providers |
| **Rate Limits** | Detect and pause worker | Pool multiple subscriptions, auto-failover |
| **Testing** | Manual + typecheck + lint | Property-based testing (proptest) on everything |

### Key Insight: Complementary, Not Competing

Loom is a better *individual agent runtime*. Flow is a better *multi-agent orchestration layer*. Loom has no concept of outcomes, tasks, capability phases, or cross-task learning. Flow has no concept of per-operation VCS snapshots, secret redaction, or multi-LLM consultation.

The most valuable integration path is borrowing Loom's individual-agent innovations into Flow's workers, or potentially using Loom as a worker runtime.

### 1. Worker Execution Loop

- **Loom**: Pure synchronous state machine with explicit states and transitions. `PostToolsHook` is a first-class state. Each state produces deterministic output. Testable with property-based tests.
- **Flow**: `worker.ts` is ~2500 lines of imperative async code with complex error handling, retry logic, and state scattered across variables. Self-healing restart loop, circuit breaker, rate-limit detection all woven into the imperative flow.
- **Gap**: Flow's worker is powerful but hard to reason about. Loom's state machine approach would make the same features more predictable and testable.

### 2. VCS Integration

- **Loom**: Every tool execution creates a VCS snapshot (Spool stitch). Failed operations can be surgically undone ("unpicked") without affecting subsequent work. Auto-commit with LLM-generated messages after every mutation.
- **Flow**: Workers operate in workspaces with standard git. No per-operation tracking. If a worker goes off-rails mid-task, the entire task's changes are a single blob.
- **Gap**: Flow has no granular rollback capability. If HOMЯ detects drift at observation time, the damage is already done with no way to revert to the last good state.

### 3. Secret Handling

- **Loom**: Compile-time `Secret<T>` prevents accidental exposure + runtime redaction with 200+ patterns scrubs all output.
- **Flow**: Workers have `--dangerously-skip-permissions`. Full output captured to `progress_entries.full_output` in plaintext. No redaction layer.
- **Gap**: Sensitive data (API keys, tokens, credentials) encountered during worker execution is stored unredacted in the database.

### 4. Multi-LLM Consultation

- **Loom**: Oracle tool lets the primary agent (Claude) ask GPT-4o questions mid-conversation. Routed through the server proxy so the agent never handles API keys.
- **Flow**: Claude-only. All workers, HOMЯ observations, capability detection — everything uses Claude CLI.
- **Gap**: Workers can get stuck in local reasoning optima. A second model perspective could catch mistakes before they propagate across tasks.

### 5. Rate Limit Handling

- **Loom**: OAuth pool with multiple subscriptions, automatic failover on quota hit, configurable cooldowns.
- **Flow**: Detects rate limits via regex in worker output, pauses the entire worker. See `detectRateLimitExit()` in `worker.ts`.
- **Gap**: Multi-worker outcomes burn through Claude limits fast. Pausing all workers on rate limit is the nuclear option.

## What We Should Borrow (Ranked by Impact)

### 1. Auto-Commit After Mutations — HIGH IMPACT

**What**: After every Claude CLI turn that modifies files, automatically commit with a generated message. This is infrastructure behavior invisible to the agent.

**Why it improves Flow**: Ralph workers currently make changes without granular VCS tracking. If a worker goes off-rails on step 5 of 10, you lose everything. With per-operation commits:
- HOMЯ observer can analyze *diffs* instead of raw full output
- You can revert to the last good state when drift is detected
- Progress becomes auditable at the commit level
- Task branches become a reviewable history of worker reasoning

**What to change**:
- Add a post-turn hook in `lib/ralph/worker.ts` that watches the workspace for git changes
- After each Claude CLI turn completes, auto-commit with a short generated message (use Claude Haiku via API or a simple diff summary)
- Store commit SHAs in `progress_entries` for precise rollback points
- Each task gets its own branch: `task/{taskId}`, merged on completion
- HOMЯ observer receives commit history alongside full output
- Failed tasks can be inspected via `git log` on the task branch

**Effort**: Medium. Core changes: workspace git init, post-turn commit hook in worker loop, SHA tracking in progress_entries. The task branching is additive.

### 2. Oracle Pattern — Multi-LLM Consultation — HIGH IMPACT

**What**: Let workers consult a second LLM (GPT-4o, Gemini, etc.) mid-task for second opinions on architecture, code review, or cross-checking reasoning.

**Why it improves Flow**: Workers sometimes make confident-but-wrong decisions that compound across tasks. A second LLM perspective could catch mistakes before HOMЯ observation (which happens after the task is done). This is especially valuable for:
- Architecture decisions that affect downstream tasks
- Code review of complex logic
- Validating assumptions before building on them

**What to change**:
- **Simple version**: Add an instruction to the worker's CLAUDE.md telling it to write questions to an `oracle_query.txt` file. A watcher process picks it up, sends to OpenAI/Gemini API, writes response to `oracle_response.txt`. Worker reads and continues.
- **Simpler version**: Add a skill that teaches workers to use `curl` to hit an external LLM API endpoint (requires API key management).
- **HOMЯ integration**: Observer could use a second LLM for higher-confidence drift detection (Claude observes, GPT validates).
- Store oracle interactions in `progress_entries` for auditing.

**Effort**: Low-Medium. The file-based oracle is simple. API key management is the main complexity. Could also be a standalone microservice.

### 3. OAuth Pool / Subscription Rotation — HIGH IMPACT

**What**: Pool multiple Claude CLI profiles/sessions. When one hits the quota, automatically rotate to the next available account.

**Why it improves Flow**: Running multiple Ralph workers burns through Claude subscription limits fast. Current behavior (`detectRateLimitExit`) pauses the entire worker. With subscription rotation, workers keep going.

**What to change**:
- Flow already detects rate limits in `worker.ts` (`detectRateLimitExit`)
- Instead of pausing, rotate to a different Claude CLI profile/session
- Could be as simple as: maintain multiple Claude CLI configs (different `~/.claude/` directories), round-robin on rate limit
- Store account pool in `system_config` table with cooldown tracking
- Worker tries next account before falling back to pause
- Dashboard shows which accounts are active/cooling down

**Effort**: Low. The detection infrastructure exists. Adding rotation is configuration + a small change to the spawn logic in `worker.ts`.

### 4. Secret Redaction Layer — MEDIUM IMPACT

**What**: Scrub sensitive data from worker output before storing it in the database. Two-layer approach: runtime regex patterns (gitleaks-style) + output filtering.

**Why it improves Flow**: Workers have `--dangerously-skip-permissions` and full output is captured to `progress_entries.full_output`. If a worker encounters or generates sensitive data (API keys, tokens, connection strings, passwords), it's stored in plaintext. This data is also displayed in the worker drill-down UI and passed through HOMЯ observation.

**What to change**:
- Add a `redact(text: string): string` utility using key gitleaks patterns (npm: `@nicktomlin/gitleaks` or port the top 50 patterns manually)
- Run on `full_output` before storing to `progress_entries`
- Run on CLAUDE.md context injection to prevent cross-task secret leakage via HOMЯ
- Add to the guard system alongside destructive command detection (`lib/guard/index.ts`)
- Optionally: detect secrets in workspace files and alert via supervisor

**Effort**: Medium. The regex patterns are available from gitleaks. The integration points are clear: worker output capture, HOMЯ context injection, guard system.

### 5. Explicit State Machine for Worker Loop — MEDIUM IMPACT

**What**: Refactor the Ralph worker from imperative async code into an explicit state machine with named states and deterministic transitions.

**Why it improves Flow**: `worker.ts` is ~2500 lines of imperative async code. The self-healing restart loop, circuit breaker, rate-limit detection, turn exhaustion handling, intervention checking, complexity estimation, decomposition, and HOMЯ observation are all interleaved. An explicit state machine would:
- Make each state's behavior isolated and testable
- Make error recovery paths explicit (not hidden in catch blocks)
- Make it easy to add new states (oracle consultation, auto-commit, pre-task validation)
- Enable property-based testing on state transitions

**What to change**:
- Define worker states: `Idle → Claiming → BuildingContext → Executing → MonitoringProgress → PostTaskHook → Observing → NextTask`
- Error substates: `RateLimited → Backoff → Retry`, `CircuitTripped → Paused`
- Each state transition is logged and auditable
- Extract the ~2500 line worker into a state machine + handlers pattern
- Property-based tests: "from any state, an error transitions to the correct recovery state"

**Effort**: High. This is a significant refactor of the core worker loop. Should be done incrementally — extract states one at a time, not a big-bang rewrite.

### 6. Per-Operation VCS Snapshots (Lightweight Version) — MEDIUM IMPACT

**What**: Give each task its own git branch with frequent auto-commits, enabling surgical rollback without full Spool/jj adoption.

**Why it improves Flow**: Currently if a worker makes a mistake mid-task, the only options are: fail the task, or hope review catches it. With operation-level snapshots:
- HOMЯ could diff between commits to find exactly where things went wrong
- Failed tasks preserve their partial progress for debugging
- Successful partial work can be cherry-picked even from failed tasks
- Review cycles could reference specific commits

**What to change**:
- On task claim: `git checkout -b task/{taskId}` in the workspace
- Auto-commit after each Claude CLI turn (builds on idea #1)
- On task completion: merge task branch back, tag with `task/{taskId}/complete`
- On task failure: branch preserved for inspection, not merged
- HOMЯ observer receives branch diff alongside full output
- UI: worker drill-down shows commit history per task

**Effort**: Medium. Builds naturally on idea #1 (auto-commit). The branching strategy is additive. Main complexity is handling concurrent tasks in the same workspace (already mitigated by task-level subdirectories).

### 7. Property-Based Testing for Core Systems — LOW-MEDIUM IMPACT

**What**: Add property-based testing (using `fast-check` for TypeScript) to critical subsystems: state transitions, dependency validation, guard patterns, HOMЯ context compaction.

**Why it improves Flow**: Loom tests invariants like "redaction is idempotent", "edit operations preserve surrounding text", "retry delay never exceeds max". Flow's critical systems (worker loop, dependency cycle detection, guard patterns) have no automated tests. Property-based tests would catch edge cases that unit tests miss.

**What to change**:
- Add `fast-check` dependency
- Priority targets for property tests:
  - `lib/db/dependencies.ts` — "no valid dependency graph contains a cycle"
  - `lib/guard/index.ts` — "guard never blocks safe commands", "guard always blocks dangerous patterns"
  - `lib/ralph/worker.ts` (after state machine refactor) — "error states always have recovery paths"
  - `lib/homr/observer.ts` — "observation always produces a valid assessment"

**Effort**: Low per-test, medium cumulative. `fast-check` is a single dependency. Tests can be added incrementally to the highest-risk areas.

## What We Should NOT Adopt

### Spool (Full jj Fork)
Loom's custom VCS is deeply integrated with its Rust codebase and weaving metaphor. Porting a jj fork to TypeScript would be enormous effort for marginal gain over git branches + auto-commits. The lightweight version (idea #6) captures 80% of the value.

### Rust Rewrite
Loom's Rust architecture is impressive but Flow's TypeScript/Next.js stack is the right choice for a web-first application with rapid iteration. The performance-critical paths (worker spawning, LLM calls) are I/O-bound, not CPU-bound.

### eBPF Syscall Auditing
Overkill for Flow's threat model. Workers run locally on the user's Mac with workspace isolation. eBPF makes sense for Loom's multi-tenant Kubernetes pods but not for single-user local execution.

### WireGuard/DERP Networking
Flow runs locally. There's no remote execution environment to tunnel into. If Flow ever adds remote workers, this becomes relevant.

### TUI (Ratatui-based Terminal UI)
Flow already has a web UI and CLI. Adding a TUI is a third interface to maintain for minimal gain. The CLI + web combination covers the use cases.

### Nix Build System
Flow's npm-based build is simple and sufficient. Nix adds reproducibility but also significant complexity for a single-user TypeScript project.

### ACP (Agent Client Protocol) for Editor Integration
Premature for Flow. Workers are autonomous background processes, not interactive coding assistants. Editor integration would be a different product.

### Granular Crate-Per-Widget Architecture
Loom splits every TUI widget into its own Rust crate for incremental compilation. This is a Rust-specific optimization. TypeScript's module system and Next.js's incremental compilation don't need this pattern.

## Integration Path: Loom as a Worker Runtime

The most ambitious integration: instead of spawning raw `claude --dangerously-skip-permissions`, Flow could spawn Loom as the worker runtime.

**Benefits**:
- Auto-commit for free (Loom does it automatically)
- Secret redaction built in
- Oracle tool available to workers
- Better error handling via state machine
- Thread persistence for debugging
- Per-operation VCS snapshots via Spool

**Challenge**: Loom is Rust, Flow is TypeScript. Integration would be via CLI (`loom` command) or HTTP (loom-server API). Loom would need a "headless" mode where Flow provides the task prompt and Loom executes it — this doesn't exist yet.

**Verdict**: Worth tracking as Loom matures. For now, borrowing the *ideas* (auto-commit, oracle, subscription pooling) into Flow's existing worker is more practical than swapping runtimes.

## Summary

| Idea | Impact | Effort | Recommendation |
|------|--------|--------|----------------|
| Auto-commit after mutations | High | Medium | **Do first** — enables rollback, audit trail, HOMЯ diffs |
| Oracle (multi-LLM consultation) | High | Low-Med | **Do second** — catches worker mistakes before they compound |
| OAuth pool / subscription rotation | High | Low | **Do second** — keeps workers running through rate limits |
| Secret redaction on output | Medium | Medium | **Do third** — security hygiene for stored worker output |
| Task-level git branches | Medium-High | Medium | **Do after auto-commit** — natural extension of #1 |
| Worker state machine refactor | Medium | High | **Plan for Flow 2.0** — major reliability improvement |
| Property-based testing | Low-Med | Low-Med | **Ongoing** — add incrementally to highest-risk code |
| Loom as worker runtime | High | Very High | **Track** — revisit when Loom has headless mode |

**Bottom line**: Loom and Flow are complementary systems. Loom excels at individual agent execution quality (state machines, per-operation snapshots, secret safety, multi-LLM). Flow excels at multi-agent orchestration (outcomes, task decomposition, HOMЯ learning, skill injection, review cycles). The highest-value ideas to borrow — auto-commit, oracle, subscription pooling — can each be implemented independently in Flow's existing architecture without major rewrites. The state machine refactor is the biggest structural improvement but should be planned as a Flow 2.0 workstream, not a bolt-on.
