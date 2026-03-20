# Sidecar: TUI Architecture Analysis for Flow

> Terminal UI companion for CLI-based AI agents. Go binary with plugin architecture, git integration, conversation history, task management, and file browsing — all features Flow's TUI currently lacks.

## Source Material

- **Repository**: [https://github.com/marcus/sidecar](https://github.com/marcus/sidecar)
- **Language**: Go (single binary, sub-second startup)
- **Framework**: Bubble Tea (Elm-inspired TUI framework for Go)
- **License**: MIT
- **Community**: 453+ themes, active development

## What Is Sidecar?

Sidecar is a terminal companion that runs alongside CLI AI agents (Claude Code, Cursor, Gemini CLI, etc.). It does not replace the agent — it provides contextual panels showing git status, conversation history, task state, and file trees while the agent works. Think of it as a "mission control dashboard" for your terminal AI workflow.

**Key design decision**: Sidecar is read-only with respect to agent data. It reads Claude Code's session JSONL files from `~/.claude/projects/` but never writes to them. It reads git state but lets you stage/unstage through its own UI. This separation keeps it safe to run alongside any agent.

### Plugin Architecture

Sidecar uses a `tea.Msg` broadcasting pattern where every plugin receives every message and decides independently whether to react. Plugins are:

| Plugin | Purpose |
|--------|---------|
| **Git Status** | Real-time file diffs, staging, branch switching |
| **Conversations** | Unified timeline of all AI agent sessions |
| **TD Monitor** | Task management via `td` CLI integration |
| **File Browser** | Tree-view navigation with preview |
| **Workspaces** | Shell management, worktree integration |

Navigation: `Tab` cycles between plugins, `j/k` for vim-style movement within a plugin, `v` toggles views (e.g., inline diff vs side-by-side).

## Comparison to Flow's Current TUI

### Flow's TUI Today

Flow's TUI lives in three files:

- `cli/src/tui/app.ts` — A single-panel blessed-based chat interface (1164 lines)
- `cli/src/tui/claude-session.ts` — Spawns `claude -p` with `--resume` for continuity, streams JSON output
- `cli/src/tui/integrations.ts` — Plugin-like system for loading skills, permissions, and MCP configs from `~/flow-data/integrations/`

The TUI is chat-only. It has a header, a scrollable chat log, a status area (spinner + activity log), and a text input. No panels, no splits, no secondary views. The activity log (`[Tab]` toggle during loading) shows tool calls in real time, which is the closest thing to Sidecar's transparency features.

**What Flow has that Sidecar does not**:
- Deep integration with its own orchestration system (outcomes, tasks, workers, HOMR)
- An integrations system (`~/flow-data/integrations/`) that merges skills, permissions, and MCP configs
- Permission management (`/allow`, `/deny`, auto-detection of permission failures)
- Session continuity via Claude CLI's `--resume` flag with session ID tracking

**What Sidecar has that Flow does not**:
- Git visibility (diffs, staging, branches, history)
- Conversation/session history browsing
- Task board visualization
- Multi-panel layout
- File browser with syntax highlighting
- Mouse support and 453+ themes

### Architecture Gap

Flow's TUI uses `blessed` (Node.js). Sidecar uses Bubble Tea (Go). The fundamental architectural difference is:

| Aspect | Flow TUI | Sidecar |
|--------|----------|---------|
| Language | TypeScript/Node.js | Go |
| Framework | blessed (imperative) | Bubble Tea (Elm architecture) |
| Layout | Single panel, fixed zones | Plugin panels, Tab-switchable |
| Startup | ~500ms (Node.js cold start) | <50ms (compiled binary) |
| State | Mutable `TUIState` object | Immutable model + update functions |
| Rendering | Direct DOM manipulation | Virtual terminal diffing |

Flow cannot adopt Bubble Tea without rewriting in Go, but it can adopt Sidecar's *conceptual patterns* — particularly the panel architecture, read-only data access, and plugin message broadcasting.

## Feature Analysis: What Flow Should Borrow

### 1. Git History Viewing in TUI (HIGH IMPACT)

**Sidecar's approach**: The Git Status plugin watches the filesystem for changes (via fsnotify), runs `git status`, `git diff`, and `git log` to populate a real-time view. Users can:
- See changed files with syntax-highlighted diffs
- Toggle between inline and side-by-side diff views
- Stage/unstage files directly
- Browse commit history with navigation
- Switch branches and stash changes

**Flow's current state**: Zero git visibility in the TUI. The chat agent can run `git` commands if asked, but there is no persistent git panel. Flow does track git config per outcome (`working_directory`, `git_mode`, `base_branch`, `work_branch` columns in `outcomes` table), and workers operate in git-tracked workspaces (`~/flow-data/workspaces/out_{id}/`), but none of this is surfaced in the TUI.

**What to build**:

A `/git` slash command (or a persistent side panel in a future multi-panel layout) that shows:

1. **Current diff** — Run `git diff` and `git diff --cached` in the converse workspace (`~/flow-data/converse-workspace/`) or the active outcome's working directory. Render with ANSI colors in the chat log initially; upgrade to a split pane later.

2. **Recent commits** — Run `git log --oneline -20` for the active workspace. Show as a selectable list; selecting a commit shows its diff.

3. **Branch status** — Show current branch, ahead/behind remote, dirty state. This is especially valuable during evolve mode where iterations create `evolve/iteration-N` branches.

4. **Outcome workspace git** — When the user is working on an outcome, show git status for that outcome's workspace, not just the converse workspace.

**Implementation path**:
- Phase 1: `/git` slash command that dumps formatted `git status` + `git log --oneline -10` into the chat log. Zero new dependencies. Add to `SLASH_COMMANDS` array in `cli/src/tui/app.ts`.
- Phase 2: `/diff` slash command that renders a syntax-highlighted diff. Use `cli/src/tui/app.ts`'s existing `renderMarkdown()` with fenced code blocks for basic coloring.
- Phase 3: Persistent git panel in a split layout (requires blessed's `box` with `left`/`right` positioning, or migration to a more capable framework like Ink).

**Relevant files**:
- `cli/src/tui/app.ts` — Add slash commands in `SLASH_COMMANDS` array (line 65) and handler cases in `handleSlashCommand()` (line 675)
- `lib/config/paths.ts` — Resolve workspace paths for outcome-specific git operations
- Workers already track `branch_name` and `worktree_path` columns on the `workers` table

### 2. Conversation/Session History Browsing (HIGH IMPACT)

**Sidecar's approach**: The Conversations plugin reads Claude Code's session files from `~/.claude/projects/{project-hash}/`. Each session is a `.jsonl` file containing structured messages (user prompts, assistant responses, tool calls, tool results). Sidecar parses these into a chronological timeline, tracks token usage per session, and lets you search/filter across all sessions. You can resume a conversation directly from the UI.

**Flow's current state**: Flow has multiple layers of conversation/session data, but none are browsable in the TUI:

1. **Claude Code JSONL sessions** (`~/.claude/projects/`): The raw session files exist on disk. For the Flow project alone there are 1000+ session files. These contain the complete conversation transcript including tool calls and thinking blocks. The TUI's `ClaudeSession` class (`cli/src/tui/claude-session.ts`) already knows the session ID via `--resume` and could read past session files.

2. **Worker progress entries** (`progress_entries` table): Each worker iteration stores `content` and `full_output` (the complete Claude CLI output). These are searchable via SQL but not browsable.

3. **Conversation sessions/messages** (`conversation_sessions` + `conversation_messages` tables): Flow has a full conversation persistence layer in the database schema, with sessions, messages, roles, and metadata. The converse agent (`cli/src/commands/converse.ts`) uses these via API endpoints, but the TUI (`converse2`) does not — it only stores messages in memory (`this.messages` array in `app.ts` line 171).

4. **Events table** (`events`): All worker, task, HOMR, and experiment events are persisted with 7-day retention. These provide a timeline of system activity.

**What to build**:

A `/history` command that shows past conversations, and a `/sessions` command for browsing Claude Code sessions directly.

1. **TUI session persistence** — The TUI currently loses all messages on exit (in-memory only at `this.messages` in `app.ts`). Step one is persisting TUI conversations to the `conversation_sessions`/`conversation_messages` tables. The schema already exists. The `ClaudeSession` class tracks `sessionId` — use this as the session key.

2. **Session browser** — `/history` shows a list of recent TUI sessions with timestamps and first-message preview. Selecting one loads the transcript into a read-only view. Data source: `conversation_messages` table joined with `conversation_sessions`.

3. **Claude Code session reader** — `/sessions` reads raw `.jsonl` files from `~/.claude/projects/`. This mirrors Sidecar's conversation plugin. Parse the JSONL (format: one JSON object per line, with `type`, `message.role`, `message.content` fields), extract user/assistant messages, skip tool_use blocks for the summary view, show them with timestamps.

4. **Worker history** — `/workers` or `/worker <id>` shows past worker runs with their progress entries and full output. Data source: `progress_entries` table with `full_output` column, joined with `workers` table.

5. **Cross-session search** — `/search <query>` searches across all conversation messages and worker outputs. The `memories_fts` FTS5 virtual table already provides full-text search for memories; a similar approach could index conversation content.

**Implementation path**:
- Phase 1: Persist TUI messages to `conversation_sessions`/`conversation_messages` tables. Add `/history` slash command to list recent sessions. Minimal — just SQL inserts on `appendUserMessage()`/`appendAssistantMessage()` and a SELECT query for the list.
- Phase 2: `/sessions` command that reads `~/.claude/projects/` JSONL files. Parse just the `user` and `assistant` message types, skip tool calls in the summary. Show session list → select → view transcript.
- Phase 3: `/search` command using FTS5 or simple LIKE queries across `conversation_messages.content` and `progress_entries.full_output`.

**Relevant files**:
- `cli/src/tui/app.ts` — `this.messages` array (line 171), `appendUserMessage()` (line 997), `appendAssistantMessage()` (line 1002)
- `cli/src/tui/claude-session.ts` — `this.sessionId` (line 230), `sendMessage()` returns final text (line 260)
- `lib/db/schema.ts` — `conversation_sessions` table (line 1591), `conversation_messages` table (line 1607), `progress_entries` table (line 1142)
- `lib/db/index.ts` — DB initialization with conversation table indexes (line 557)
- Claude Code session path: `~/.claude/projects/{project-hash}/{session-id}.jsonl`
- Session JSONL format: `{"type":"user"|"assistant", "message":{"role":"user"|"assistant", "content":[...]}, "sessionId":"...", "timestamp":"..."}`

### 3. Task Visibility in TUI (MEDIUM IMPACT)

**Sidecar's approach**: The TD Monitor plugin integrates with `td` (a separate task CLI tool) to show a kanban board with seven status columns. Tasks have hierarchical subtasks, cross-context persistence, and state transitions (pending, in-progress, blocked, done).

**Flow's current state**: Flow has a far more sophisticated task system than `td` — tasks belong to outcomes, have statuses (pending/claimed/running/completed/failed), dependencies, gates, complexity scores, evolve configs, and decomposition hierarchies. The CLI already has `flow tasks` and `flow task show` commands. But the TUI has zero task visibility. To see tasks, you must exit the TUI and run `flow tasks <outcome-id>`.

**What to build**:

A `/tasks` slash command that shows the current outcome's task board inline.

1. **Inline task list** — `/tasks` fetches tasks for the current outcome (the user can set context with `/outcome <id>`) and renders a compact status summary in the chat log:
   ```
   Outcome: Build CLI git integration
   [3 pending] [1 running] [0 blocked] [2 completed] [1 failed]

   RUNNING  Build git status command        (worker: w_abc123)
   PENDING  Add diff rendering
   PENDING  Implement branch switching
   FAILED   Parse JSONL sessions            (attempt 2/3)
   DONE     Set up slash command framework
   DONE     Add /help documentation
   ```

2. **Task detail** — `/task <id>` shows full task details including description, dependencies, attempts, gates, and evolve status.

3. **Quick actions** — `/retry <id>` retries a failed task, `/start` deploys a worker for the current outcome. These map directly to existing API endpoints.

**Implementation path**: This is mostly API calls formatted for the terminal. The `/tasks` command would call the same endpoints as `flow tasks` but render inline. Since the TUI runs in the converse workspace and may not have direct DB access, it would work through the Claude agent (asking it to run `flow tasks`) or through direct HTTP calls to `localhost:3000/api/outcomes/{id}/tasks`.

**Relevant files**:
- `cli/src/api.ts` — API client already has task-related calls
- `cli/src/commands/tasks.ts` — Existing task list formatting logic
- `app/api/outcomes/[id]/tasks/route.ts` — Tasks API endpoint

### 4. Multi-Panel Layout (MEDIUM IMPACT, HIGH EFFORT)

**Sidecar's approach**: Full multi-panel layout where each plugin gets its own panel. Tab switches between active panels. Each panel has independent scroll, search, and navigation.

**Flow's current state**: Single-panel blessed layout with fixed zones:
- Header (4 lines, line 254)
- Chat log (variable, line 271)
- Status area (2 lines expandable to 10 for activity log, line 297)
- Input (4 lines, line 312)
- Footer (1 line, line 334)

All zone heights are hardcoded. The activity log toggle (line 602) is the closest thing to a multi-panel system — it expands the status area and shrinks the chat log.

**What to build — and what NOT to build**:

Do NOT attempt a full Sidecar-style multi-panel layout in blessed. The blessed library is unmaintained and fighting it for complex layouts is painful. Instead:

1. **Phase 1: Slash commands as "virtual panels"** — `/git`, `/tasks`, `/history`, `/workers` render their content directly into the chat log. This requires zero layout changes. The information is ephemeral (scrolls away) but immediately useful.

2. **Phase 2: Split pane for context** — Add a right-side panel (30-40% width) that shows persistent context: current outcome, task status, git branch. Use blessed's `box` positioning with `left: '60%'` to create a fixed sidebar. The chat log width shrinks to `'60%'`. This is achievable with blessed.

3. **Phase 3: Framework migration** — If the TUI becomes a primary interface, consider migrating from blessed to [Ink](https://github.com/vadimdemedes/ink) (React for CLI) or building a native companion in Go/Rust. Ink would let you reuse React component patterns from the web UI. A Go companion (like Sidecar itself) would provide the performance and Bubble Tea elegance but require maintaining a second codebase.

**Relevant files**:
- `cli/src/tui/app.ts` — `createLayout()` method (line 252) defines all zones
- blessed's `box` element supports `left`, `right`, `width` as percentages

### 5. Model Selection (LOW PRIORITY)

**Sidecar does not do this** — it delegates to whatever AI agent is running. But the user mentioned model selection as a future interest.

**Flow's current state**: The TUI spawns Claude Code CLI processes. Model selection would need to be passed as a CLI flag to `claude`. The `sendMessage()` method in `claude-session.ts` (line 260) builds the args array — adding `--model <name>` would be straightforward.

**What to build**: A `/model` slash command that sets the model for subsequent messages. Store the model name in session state. Pass it to `claude -p` via `--model` flag. Show current model in the footer bar.

**Implementation**: Add `model` field to `ClaudeSession` class, pass as `--model` arg in the `args` array at line 269 of `claude-session.ts`. Add `/model` to `SLASH_COMMANDS` and `handleSlashCommand()` in `app.ts`.

## Patterns Worth Adopting

### Read-Only Data Access

Sidecar never writes to agent data files. This is a good principle for Flow's TUI panels too. Git status panels should read `git` state but not modify it. Session history should be read-only. The chat input is the only write path — everything else flows through the Claude agent.

### Filesystem Watching

Sidecar uses `fsnotify` for real-time updates. Flow's TUI could watch key files for changes:
- `~/flow-data/data/twin.db` — database changes trigger task/worker status refreshes
- Workspace directories — file changes during worker execution
- `~/.claude/projects/` — new session files appearing

In Node.js, `fs.watch()` or `chokidar` provides this. The event bus (`lib/events/bus.ts`) already has a pub/sub model that could be adapted for filesystem events in the TUI context — though the TUI runs as a separate process, not inside the Next.js server, so it cannot directly subscribe to the in-process event bus. It would need either filesystem polling, a local SSE connection to the server, or direct SQLite reads.

### Plugin as Message Handler

Sidecar's `tea.Msg` broadcasting pattern (every plugin receives every message) maps well to an event-driven TUI. If Flow's TUI had a panel system, each panel could implement an `update(msg)` handler. The `ActivityEvent` type in `claude-session.ts` is already close to this — extending it with git events, task events, and session events would create a unified message bus for the TUI.

## Implementation Priority (Ranked by Impact for CLI-First Conversational Mode)

| Priority | Feature | Effort | Impact | Dependencies |
|----------|---------|--------|--------|-------------|
| **1** | `/git` slash command (status + log + diff) | Small | High | None |
| **2** | TUI session persistence + `/history` | Small | High | DB access from CLI |
| **3** | `/sessions` Claude Code JSONL reader | Medium | High | JSONL parser |
| **4** | `/tasks` inline task board | Small | Medium | API client or DB access |
| **5** | `/search` cross-session search | Medium | Medium | FTS5 or LIKE queries |
| **6** | `/model` selection | Tiny | Low | `--model` CLI flag |
| **7** | Split-pane context sidebar | Large | Medium | blessed layout work |
| **8** | Filesystem watching for auto-refresh | Medium | Medium | chokidar or fs.watch |
| **9** | Framework migration (Ink or Go) | Very Large | High (long-term) | Full rewrite |

## Key Insight

Sidecar solves the "contextual awareness" problem — while you chat with an AI agent, you lose visibility into git state, task progress, and conversation history. Flow's TUI has the same blind spot. The fastest path to fixing it is slash commands that pull contextual data into the chat stream (items 1-5 above). A full panel architecture (items 7-9) is higher effort and should only be pursued if the TUI becomes the primary Flow interface.

The most impactful single feature is **conversation history** (items 2-3). The data already exists — 1000+ Claude Code session JSONL files in `~/.claude/projects/`, plus the `conversation_sessions`/`conversation_messages` tables in the database, plus `progress_entries` with `full_output`. The TUI just needs to read and display it.

## Current Status

Research complete. No implementation started.
