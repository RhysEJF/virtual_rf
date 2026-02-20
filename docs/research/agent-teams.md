# Agent Teams: Integration Patterns for Ralph Worker Engine

> Research on Claude Code's Agent Teams feature (Feb 2026) and how it could integrate with Flow's Ralph Worker (Wiggum loop) engine.

## Source Material

- [Claude Code Agent Teams - Official Docs](https://code.claude.com/docs/en/agent-teams)
- [Claude Code Agent Teams: Complete Guide](https://claudefa.st/blog/guide/agents/agent-teams)
- [From Tasks to Swarms: Agent Teams in Claude Code](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/)
- [Claude Code Swarms - Addy Osmani](https://addyosmani.com/blog/claude-code-agent-teams/)

## What Are Agent Teams?

Agent teams let you coordinate multiple Claude Code instances working together. One session acts as the **team lead** (coordinating, delegating, synthesizing) while **teammates** work independently, each in its own context window, communicating directly with each other.

### Key Properties

- **Enable via:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in env or settings.json
- **Backend:** tmux panes (auto-detected), iTerm2, or in-process fallback
- **Communication:** Teammates message each other directly (not just back to lead)
- **Task list:** Shared task list with dependency tracking, file-lock-based claiming
- **Delegate mode:** Restricts lead to coordination only — no code writing
- **Context:** Teammates load CLAUDE.md, MCP servers, skills — but NOT the lead's conversation history
- **Spawn time:** 20-30 seconds per teammate
- **Token cost:** ~3-5x a single session for equivalent work
- **Team size sweet spot:** 2-5 teammates (3 usually beats 6)

### Key Limitations (as of Feb 2026)

- No session resumption (`/resume` and `/rewind` don't restore teammates)
- One team per session, no nested teams
- Lead is fixed (can't promote a teammate)
- Permissions propagate (all teammates inherit lead's permissions)
- **Two teammates editing the same file will cause overwrites** — biggest footgun
- Task status can lag (teammates sometimes fail to mark tasks complete)

## How Ralph Workers Differ From Agent Teams

| | Ralph Workers (Current) | Agent Teams |
|---|---|---|
| **CLI mode** | `claude -p` (one-shot print mode) | Full interactive Claude Code sessions |
| **Communication** | None — DB task queue only | Direct peer-to-peer messaging |
| **Coordination** | Flow's Node.js process manages everything | A "team lead" Claude session delegates |
| **Context injection** | Pre-baked CLAUDE.md, no runtime injection (`stdin: 'ignore'`) | Teammates share findings mid-execution |
| **Lifecycle** | Flow spawns → polls progress.txt → kills process | Claude manages tmux panes internally |
| **Runtime input** | Impossible (stdin ignored) | Teammates receive messages mid-work |
| **Task decomposition** | Flow's task-decomposer agent, pre-execution | Team lead decomposes and delegates dynamically |
| **Cost tracking** | Per-task via JSON output parsing | Per-session (harder to attribute to individual tasks) |

### The Core Tension

Flow's power is its **programmatic orchestration layer** — HOMR observation between tasks, circuit breakers, complexity estimation, intervention system, per-task cost tracking, progress polling. Agent teams hand all of that control to Claude itself.

**The question isn't "replace Ralph" — it's where can agent teams slot in without gutting the orchestration?**

## Integration Patterns

### Pattern 1: Agent Team as Inner Execution Engine (Recommended First Step)

Keep Flow's outer loop exactly as-is. But when a worker claims a **complex task** (complexity score >= 6), instead of decomposing it into subtasks via the task-decomposer, spawn it as an agent team session.

```
Flow outer loop (unchanged):
  claim task → complexity check → ...

  IF simple (score < 6):
    claude -p (current Ralph behavior)

  IF complex (score >= 6):
    claude (interactive, agent teams enabled, delegate mode)
    → team lead decomposes internally
    → teammates implement, test, review in parallel
    → Flow monitors outer session for completion

  ... → HOMR observes → next task
```

**What you gain:**
- Complex tasks get parallel internal execution with teammates that can coordinate ("I just changed the API interface" → "OK, updating the tests")
- Solves the problem where decomposed subtasks currently run sequentially with no awareness of each other
- The `stdin: 'ignore'` limitation doesn't apply — teammates communicate freely within the team

**What you keep:**
- Task claiming, HOMR observation, circuit breakers, cost tracking, progress monitoring — all intact at the outer loop level
- Flow still controls the lifecycle — it spawns the team session and monitors for completion

**Implementation sketch:**
1. Add `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` to the worker's spawned env
2. For complex tasks, switch from `claude -p` to interactive `claude` with a team-structured prompt
3. Write team instructions into CLAUDE.md: team structure, delegate mode, file ownership rules
4. Monitor the outer session for completion (adapt progress.txt convention or monitor tmux session state)
5. On completion, feed results into HOMR as usual

**Key risk:** Per-task cost tracking becomes harder — the team session is one process, not N separate ones. Would need to parse the aggregate cost from the session output.

### Pattern 2: Capability + Execution as One Team

Currently the orchestrator runs two distinct phases sequentially — capability workers build skills/tools, then execution workers use them. With agent teams, you could spawn a single team where:

- Teammate A builds the required skill
- Teammate B's task depends on A's task in the shared task list
- When A completes, B automatically unblocks and starts executing using the skill A just built
- No hard phase boundary, no validation step in between

**What you gain:**
- Eliminates the capability → validation → execution phase boundary
- The team's built-in dependency tracking handles sequencing naturally
- Faster end-to-end: no server-side phase transition logic

**What you lose:**
- Flow's explicit `validateBuiltSkills` step
- HOMR's ability to observe between phases
- Fine-grained control over capability vs execution workers

**Verdict:** Interesting for simple outcomes with few capabilities needed. Not worth it for complex outcomes where the phase boundary provides valuable checkpoints.

### Pattern 3: Real-Time Review Teammate (Ties to Harness Engineering)

This directly addresses the biggest gap identified in the harness engineering analysis — the lack of deterministic quality gates.

Currently review is sequential: workers finish → reviewer agent runs → creates fix tasks → workers restart. That's a full round-trip for every issue found.

With agent teams, add a **reviewer teammate** that works alongside implementation:

```
Team for a complex task:
  - Teammate "impl": writes the code
  - Teammate "quality": runs lints/tests continuously, messages impl with failures
  - Teammate "review" (optional): checks architectural alignment

  When quality finds an issue → messages impl directly
  impl fixes in-context (no round-trip, no lost context, no new task)
```

**What you gain:**
- "Teaching errors" pattern from harness engineering, implemented through a live teammate
- Quality issues caught and fixed in-context rather than across task boundaries
- The reviewer teammate could run `npm run typecheck`, `npm run lint`, tests after each file change
- Errors fed back to implementation teammate *in real time*

**What you lose:**
- Clean separation between implementation and review
- HOMR's structured observation of completed work (would need to adapt)

**Key risk:** The "two teammates editing the same file" problem. The reviewer must be read-only / test-only, never editing files. File ownership boundaries are critical.

**Verdict:** High potential. This is the pattern that most directly solves the harness engineering gap. But requires careful file ownership rules to avoid the overwrite footgun.

## What's Not Worth It

### Full Ralph Replacement
Replacing the entire Ralph loop with agent teams would lose too much orchestration control — HOMR observation between tasks, circuit breakers, per-task complexity estimation, intervention system, cost tracking. Flow's value is in this programmatic layer.

### Agent Teams for Simple Tasks
The overhead isn't justified: ~5x token cost, 20-30 second spawn time per teammate. A simple task that `claude -p` finishes in under a minute doesn't benefit from a 3-teammate team.

### Nested Teams
Not supported (teammates can't spawn their own teams). Don't architect around this.

### Cross-Outcome Teams
Agent teams are per-session. Having teammates from different outcomes collaborate would require a fundamentally different coordination model that doesn't exist yet.

## Decision: When to Use What

```
Task complexity < 6:
  → Ralph worker, claude -p (current behavior)
  → Fast, cheap, Flow has full control

Task complexity >= 6, single-domain:
  → Agent team (Pattern 1)
  → Parallel execution, teammate coordination
  → Flow monitors outer session

Task complexity >= 6, needs quality gates:
  → Agent team with reviewer teammate (Pattern 3)
  → Real-time quality enforcement
  → Addresses harness engineering gap

Capability + Execution, simple outcome:
  → Consider Pattern 2 (single team, dependency-based phasing)
  → Only if few capabilities and low complexity

Everything else:
  → Current Ralph loop with HOMR
  → Proven, battle-tested, full orchestration control
```

## Open Questions

1. **Progress monitoring:** How does Flow detect team completion? progress.txt still works if the lead writes it, but teammates don't know about this convention. May need to monitor tmux session state or process exit instead.

2. **Cost attribution:** Agent teams report aggregate cost per session, not per-teammate or per-task. How to attribute cost back to Flow's per-task tracking?

3. **HOMR integration:** When does HOMR observe? After the whole team finishes? Or can we hook into individual teammate completions? Probably only after the outer session completes.

4. **Intervention compatibility:** Flow's current intervention system (`redirect`, `pause`) writes to the DB and checks between tasks. With agent teams running inside a single task, interventions can't reach the teammates. Would need a different mechanism (perhaps messaging the lead via tmux).

5. **Delegate mode control:** Can Flow programmatically toggle delegate mode, or does it need to be in the initial prompt/CLAUDE.md?
