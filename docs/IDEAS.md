# Ideas & Future Improvements

> A backlog of ideas that could improve Digital Twin. Not yet approved for implementation.

---

## How to Use This File

**When to add an idea:**
- You discover a limitation while using the system
- Research reveals a capability that could help
- A user requests something we can't do yet
- You find an interesting pattern in another project

**Idea lifecycle:**
1. `proposed` - Just captured, not yet evaluated
2. `researching` - Actively exploring feasibility
3. `planned` - Approved for implementation, create a feature doc in `docs/`
4. `implemented` - Done, link to the feature doc or PR

**What to include:**
- Clear problem statement (what limitation does this address?)
- High-level solution (not implementation details)
- Value proposition (why this matters)
- Effort estimate (small/medium/large)
- References (repos, articles, related ideas)

**Reviewing ideas:**
- Check this file when planning what to build next
- Check when Ralph workers hit recurring limitations
- Promote ideas to `planned` when ready to implement

---

## Ideas

### 1. MCP Integration for Ralph Workers

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2025-01-31 |
| **Source** | Research into Jeffrey Emanuel's agentic tooling |

**Problem:**
Ralph workers can only access the local filesystem and run shell commands. They can't browse the web, query databases, or access external APIs without custom tool-building for each capability.

**Current Workaround:**
The skill-builder can create TypeScript tools that make HTTP calls (e.g., a tool that calls the Serper API). Workers run these via `npx ts-node`. This works but is brittle - workers must manually invoke tools, parse output, and handle errors.

**Proposed Solution:**
Configure MCP (Model Context Protocol) servers for Ralph workers. MCP tools appear as first-class capabilities that Claude can call directly, like Read/Write/Bash.

Two approaches:
1. **Global MCP** - Configure in `~/.claude.json`, all Ralph workers get the capability
2. **Per-outcome MCP** - Pass MCP config when spawning workers (more complex)

Start with global `mcp-server-fetch` for web research capability.

**Value:**
- Workers can research the web autonomously
- Browser automation becomes possible (Playwright MCP)
- Database queries, vector search, etc. become native capabilities
- Reduces need for custom tool-building for common capabilities

**Effort:** Small (for basic fetch) / Medium (for full MCP gateway)

**References:**
- [mcp-server-fetch](https://github.com/anthropics/claude-code) - Official Anthropic web fetch
- [llm_gateway_mcp_server](https://github.com/Dicklesworthstone/llm_gateway_mcp_server) - Comprehensive MCP gateway
- [RALPH_UNLEASHED.md](./RALPH_UNLEASHED.md) - Vision doc with MCP as "Vision 3"

---

### 2. Agent Messaging System

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2025-01-31 |
| **Source** | Research into Jeffrey Emanuel's mcp_agent_mail |

**Problem:**
Ralph workers operate in isolation. Two workers on the same outcome can't share discoveries, coordinate on files, or avoid duplicate work.

**Proposed Solution:**
Implement an inbox/messaging system between workers. Workers can send messages, share findings, and reserve files to prevent conflicts.

**Value:**
- Complex outcomes can have multiple coordinated workers
- Discoveries compound instead of getting lost
- File conflicts become impossible
- Human can message workers directly

**Effort:** Medium

**References:**
- [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) (1.6k stars)
- [RALPH_UNLEASHED.md](./RALPH_UNLEASHED.md) - "Vision 1: Workers That Talk"

---

### 3. Task Dependency Graph

| Field | Value |
|-------|-------|
| **Status** | `implemented` |
| **Added** | 2025-01-31 |
| **Implemented** | 2026-01-31 |
| **Source** | Research into beads_viewer graph-aware task management |

**Problem:**
Tasks are a flat list. Workers claim whatever's next, sometimes starting work they can't complete because a dependency isn't done yet.

**Solution Implemented:**
- Added `depends_on` column to tasks table (JSON array of task IDs)
- Built dependency validation and circular dependency detection (`lib/db/dependencies.ts`)
- UI shows blocked/blocking relationships in ExpandableTaskCard
- Workers automatically skip blocked tasks when claiming
- HOMЯ steerer can set dependencies when analyzing task relationships

**Value Delivered:**
- Workers never start blocked tasks
- UI clearly shows dependency relationships
- Blocked tasks are visually distinguished
- Task cards show what's blocking them and what they're blocking

**References:**
- [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (1.1k stars)
- [RALPH_UNLEASHED.md](./RALPH_UNLEASHED.md) - "Vision 2: Tasks That Understand Dependencies"

---

### 4. Destructive Command Guard

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2025-01-31 |
| **Source** | Research into safety patterns for autonomous agents |

**Problem:**
Ralph workers run with `--dangerously-skip-permissions`. One bad command (rm -rf, DROP TABLE, force push) could be catastrophic.

**Proposed Solution:**
A safety layer that intercepts dangerous commands before execution. Could be implemented as:
- A wrapper script that filters commands
- A hook in the worker that checks before Bash execution
- An MCP tool that validates commands

**Value:**
- Confidence to let workers run longer unsupervised
- Catastrophic mistakes get caught
- Audit trail of blocked operations
- Builds trust in agent autonomy

**Effort:** Small

**References:**
- [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard) (283 stars)
- [RALPH_UNLEASHED.md](./RALPH_UNLEASHED.md) - "Vision 5: Safety Without Handholding"

---

### 5. Cross-Outcome Session Search

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2025-01-31 |
| **Source** | Research into institutional memory patterns |

**Problem:**
Each outcome is an island. Lessons learned, patterns discovered, and solutions developed stay trapped in that outcome's history.

**Proposed Solution:**
Index all worker outputs and progress logs. Provide semantic search across all past work. Workers can query "how did we handle X before?"

**Value:**
- Past work accelerates future work
- Patterns emerge from history
- New outcomes start with relevant context
- System gets smarter with every completed outcome

**Effort:** Large

**References:**
- [coding_agent_session_search](https://github.com/Dicklesworthstone/coding_agent_session_search) (398 stars)
- [RALPH_UNLEASHED.md](./RALPH_UNLEASHED.md) - "Vision 4: Memory That Persists"

---

### 6. Multi-Model Routing

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2025-01-31 |
| **Source** | Cost optimization research |

**Problem:**
Every task uses Claude via CLI subscription. Simple formatting and complex architecture decisions get the same heavyweight treatment.

**Proposed Solution:**
Route tasks to appropriate models based on complexity:
- Trivial tasks → cheap/fast models (DeepSeek, Haiku)
- Complex reasoning → Claude Opus
- Simple checks → local WASM models

**Value:**
- 10x more work at same cost
- Faster turnaround on simple tasks
- Premium reasoning preserved for what matters

**Effort:** Large (requires model routing infrastructure)

**References:**
- [swiss_army_llama](https://github.com/Dicklesworthstone/swiss_army_llama) (1k stars)
- [RALPH_UNLEASHED.md](./RALPH_UNLEASHED.md) - "Vision 6: Smart Routing"

---

## Implemented Ideas

*Move ideas here when they ship, with links to the feature doc or PR.*

| Idea | Implemented | Link |
|------|-------------|------|
| Task Dependency Graph | 2026-01-31 | `lib/db/dependencies.ts`, PR #1 |

---

## Rejected Ideas

*Move ideas here if we decide not to pursue them, with reasoning.*

| Idea | Rejected | Reason |
|------|----------|--------|
| *(none yet)* | | |
