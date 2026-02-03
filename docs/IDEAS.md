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

### 7. HOMЯ Auto-Resolve Mode

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2026-02-03 |
| **Source** | User feedback - manual escalation resolution is poor UX |

**Problem:**
Currently, every HOMЯ escalation requires human intervention. User must:
1. See the escalation in the UI
2. Read the options and context
3. Make a decision
4. Wait for the action to complete (e.g., decomposition)
5. Manually restart workers

This creates friction and defeats the purpose of autonomous workers. The human becomes a bottleneck.

**Proposed Solution:**
Add an "auto-resolve" capability where Claude evaluates escalations and makes decisions autonomously, with human oversight.

#### Core Components

**1. Auto-Resolver Agent**
```typescript
async function autoResolveEscalation(escalation: Escalation): Promise<{
  shouldAutoResolve: boolean;
  selectedOption: string;
  reasoning: string;
  confidence: number;  // 0.0 - 1.0
}> {
  const context = {
    escalation,
    task: getTaskById(escalation.trigger_task_id),
    pastDecisions: getDecisionPatterns(escalation.outcome_id),
    outcomeContext: getHomrContext(escalation.outcome_id),
  };

  return await claudeComplete(AUTO_RESOLVER_PROMPT, context);
}
```

**2. Configurable Confidence Threshold**
- Setting: `auto_resolve_confidence_threshold` (default: 0.8)
- If confidence >= threshold → auto-resolve
- If confidence < threshold → escalate to human
- User can adjust from 0.0 (always human) to 1.0 (always auto)

**3. Escalation Type Heuristics**
| Escalation Type | Default Behavior | Reasoning |
|-----------------|------------------|-----------|
| Complexity (turn limit) | Auto: break_into_subtasks | Safe, well-understood outcome |
| Ambiguous requirements | Human | Needs domain knowledge |
| Multiple failures | Auto: increase limit once, then human | First retry is safe |
| Security/destructive | Always human | Too risky to auto-resolve |

#### Timing: Handling Async Operations

When auto-resolve triggers an async operation (like decomposition), the system needs to handle timing. Three options:

| Option | Pros | Cons |
|--------|------|------|
| **A. Synchronous decomposition** | Simple, no race conditions, immediate feedback | Blocks the resolution flow, slower perceived response |
| **B. Worker orchestrator tracks pending ops** | Non-blocking, can parallelize, responsive UI | More complex state management, need to track operations |
| **C. Worker polls for "ready" state** | Workers are self-managing, decentralized | Wastes worker turns polling, could miss edge cases |

**Recommendation: Option B (Worker Orchestrator)**
- Add `pending_operations` tracking to outcome or worker state
- Before claiming tasks, worker checks for pending operations
- Decomposition adds entry: `{ type: 'decomposition', taskId, startedAt }`
- On completion, entry is removed
- Worker waits if any pending operations affect its next task

#### Human Stays "On The Loop"

**Activity Feed Enhancements:**
- Auto-resolved escalations appear with distinct styling (different color/icon)
- Show: "🤖 Auto-resolved: [decision] (confidence: 85%)"
- Clickable to expand reasoning

**Override Capability:**
- Human can undo auto-decisions within N minutes
- "Undo" reverts the action if possible (mark task pending again, etc.)
- Builds dataset of when auto-resolve was wrong

**Configurable Modes:**
| Mode | Behavior |
|------|----------|
| `manual` | All escalations go to human (current behavior) |
| `semi-auto` | Auto-resolve with human review before applying |
| `full-auto` | Auto-resolve and apply immediately |

#### Future Enhancement: Pattern Learning

**Deferred to v2** - Track decision outcomes to improve auto-resolve:

1. **Store decision outcomes**
   - When task completes after escalation → record "good outcome"
   - When task fails after escalation → record "bad outcome"

2. **Build pattern database**
   ```typescript
   interface DecisionPattern {
     escalationType: string;
     contextSignals: string[];  // e.g., "high_complexity", "bulk_task"
     decision: string;
     outcomeCount: number;
     successRate: number;
   }
   ```

3. **Use patterns in auto-resolve**
   - If pattern has >80% success rate and >5 occurrences → boost confidence
   - "We've seen this 12 times, chose 'decompose' 10 times, succeeded 9 times"

This is more complex because it requires:
- Tracking long-term outcomes (did the task eventually succeed?)
- Correlating decisions to outcomes across sessions
- Building a queryable pattern database

**Value:**
- 80% reduction in human interruptions
- Workers can run truly autonomously for hours
- Human time focused on genuinely ambiguous decisions
- System learns from human decisions over time

**Effort:** Medium (core auto-resolve) / Large (pattern learning)

**References:**
- [HOMЯ DESIGN.md](./homr/DESIGN.md) - Current escalation architecture
- Existing `homr_context.decisions` table - Already stores some decision data

---

### 8. Persistent Learnings Layer (Cross-Outcome Memory)

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2026-02-03 |
| **Source** | James conversation (james-call-3.txt) - Memory architecture discussion |

**Problem:**
Each outcome is an island. HOMЯ discovers patterns and constraints during one outcome, but those learnings don't carry forward. A worker solving a similar problem next month starts from scratch.

Current system:
- Discoveries stored in `homr_context` JSON blob per outcome
- No cross-outcome search capability
- No tracking of which discoveries were actually helpful

**Proposed Solution:**
Build a persistent learnings layer with semantic search across all outcomes.

#### Core Components

**1. Learnings Table**
```typescript
interface Learning {
  id: string;
  content: string;
  format: 'COIA';  // Context, Observation, Implication, Action
  confidence: number;  // 0.0-1.0, decays over time if unused
  times_used: number;
  times_helpful: number;  // Worker marked it useful
  last_used_at: number;
  source_outcome_id: string;
  source_task_id: string;
  embedding?: number[];  // For semantic search
  tags: string[];  // e.g., ["api", "authentication", "oauth"]
}
```

**2. COIA Format (from James's RALPH system)**
```markdown
### [Date] - [Brief Title]

**Context**: What were you working on?
**Observation**: What did you notice?
**Implication**: How should this change future work?
**Action**: Specific change to make
```

**3. Hybrid Search at Task Claim**
```typescript
const relevantLearnings = await searchLearnings({
  query: task.title + task.description,
  strategy: 'hybrid',  // BM25 + semantic embedding search
  outcomeContext: task.outcome_id,  // Boost same-outcome learnings
  limit: 5,
  minConfidence: 0.6,
});
```

**4. Usage Tracking**
- Inject learning ID with content
- Worker can mark learning as helpful: `LEARNING_HELPFUL: learn_123`
- Track usage → boost confidence for helpful learnings
- Decay confidence for unused learnings over time

**Value:**
- System gets smarter with every completed outcome
- Past solutions accelerate future work
- Confidence scoring surfaces the most valuable learnings
- "How did we handle X before?" becomes a real capability

**Effort:** Large

**References:**
- [Cross-Outcome Session Search](#5-cross-outcome-session-search) - Related idea
- [LEARNINGS.md format](james-call-3.txt) - COIA pattern from James's book project
- [HOMЯ Observer](../lib/homr/observer.ts) - Current discovery extraction

---

### 9. Dynamic Task Scoring Formula

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2026-02-03 |
| **Source** | James conversation - Task orchestration discussion |

**Problem:**
Currently, workers claim tasks by simple priority number. This doesn't account for:
- How many tasks are blocked waiting on this one
- How long the task has been pending
- Task type (capability tasks should complete first)
- Worker specialization (some workers better at certain tasks)

**Proposed Solution:**
Replace simple priority with a scoring formula:

```typescript
function calculateTaskScore(task: Task): number {
  const base = task.priority || 3;  // Default priority
  const typeBonus = task.phase === 'capability' ? 10 : 0;  // Capability tasks first
  const blockingBonus = getTasksDependingOn(task.id).length * 5;  // More dependents = higher priority
  const ageBonus = Math.min(10, (Date.now() - task.created_at) / (1000 * 60 * 60));  // +1 per hour, max 10

  return base + typeBonus + blockingBonus + ageBonus;
}
```

**Value:**
- Critical path tasks naturally bubble up
- Stale tasks don't get forgotten
- Capability phase completes faster
- Better parallelization of independent work

**Effort:** Small

**References:**
- James's formula: `priority + type_bonus + blocking_bonus + age_bonus`
- Current implementation: `lib/db/tasks.ts` - `claimNextTask()`

---

### 10. Parallel Review Swarm

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2026-02-03 |
| **Source** | James conversation - Two-phase generation pattern |

**Problem:**
Current review is single-pass: one Reviewer agent checks all work. This misses issues that require specialized attention (security, performance, accessibility, etc.).

**Proposed Solution:**
Replace single reviewer with parallel specialized sub-agents:

```typescript
const reviewSwarm = [
  { name: 'security', prompt: 'Check for OWASP top 10 vulnerabilities...' },
  { name: 'performance', prompt: 'Check for N+1 queries, unnecessary renders...' },
  { name: 'accessibility', prompt: 'Check for WCAG 2.1 compliance...' },
  { name: 'consistency', prompt: 'Check naming conventions, code style...' },
];

// Run all reviews in parallel
const results = await Promise.all(
  reviewSwarm.map(r => reviewWithAgent(r.name, r.prompt, completedWork))
);

// Merge findings, deduplicate, create tasks
const allIssues = mergeReviewResults(results);
```

**Value:**
- Specialized expertise catches more issues
- Parallel execution = faster reviews
- Each reviewer has focused, smaller context
- Easy to add new review dimensions

**Effort:** Medium

**References:**
- James's "Generate then polish" pattern
- Current implementation: `lib/agents/reviewer.ts`

---

### 11. Evaluation Harness

| Field | Value |
|-------|-------|
| **Status** | `proposed` |
| **Added** | 2026-02-03 |
| **Source** | James conversation - "Metrics not vibes" philosophy |

**Problem:**
We have no systematic way to measure if changes improve the system. Questions like "Does the new capability planner work better?" require manual testing and gut feel.

**Proposed Solution:**
Build an eval suite that measures agent performance against known test cases.

```typescript
interface Evaluation {
  id: string;
  name: string;
  description: string;
  input: {
    intent: string;
    expectedSkills?: string[];
    expectedTasks?: string[];
    testFiles?: string[];  // For code quality evals
  };
  assertions: {
    type: 'tasks_generated' | 'skills_matched' | 'code_compiles' | 'tests_pass';
    expected: unknown;
  }[];
}

// Run eval suite
const results = await runEvalSuite('capability-planner', [
  { input: 'Build a REST API', assertions: [{ type: 'skills_matched', expected: ['api-design'] }] },
  { input: 'Scrape website', assertions: [{ type: 'tasks_generated', expected: 3 }] },
]);

console.log(`Pass rate: ${results.passRate}%`);
```

**Value:**
- Regression detection when changing agents
- A/B test different prompts or models
- Confidence to refactor core systems
- Documentation of expected behavior

**Effort:** Medium

**References:**
- James's eval approach in his codebase
- Anthropic's eval patterns
- [improvement-analyzer.ts](../lib/agents/improvement-analyzer.ts) - Could generate evals from escalation patterns

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
