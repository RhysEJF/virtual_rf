# Gap 4: Orchestrator Path Mismatch in CLAUDE.md

> **Verdict: ORIGINAL CLAIM IS WRONG — File exists, but CLAUDE.md has wrong path**
> **Severity: LOW (documentation error only)**
> **Fix complexity: TRIVIAL (update two paths in CLAUDE.md)**

---

## Claimed Gap

The original audit claimed: "No `orchestrator.ts` — `CLAUDE.md` references `lib/agents/orchestrator.ts` but this file does not exist."

## Audit Findings

### The orchestrator file EXISTS — at a different path

**Actual location:** `lib/ralph/orchestrator.ts`

This is a substantial, fully-functional file containing:
- `runOrchestrated()` — the main orchestration entry point
- `OrchestrationState` type definitions
- Phase management logic (capability → execution → review)
- Worker spawning and monitoring
- Integration with HOMR Protocol

The file is not missing. It's a core part of the system.

### CLAUDE.md references the wrong path

**File:** `CLAUDE.md` (project root)

Two locations reference the incorrect path:

1. **Line ~59** (Project Structure section): Lists `lib/agents/orchestrator.ts`
2. **Line ~449** (Key Files section): Lists `lib/agents/orchestrator.ts — Two-phase orchestration controller`

Both should reference `lib/ralph/orchestrator.ts`.

### `lib/agents/` does NOT contain an orchestrator

The `lib/agents/` directory contains:
- `dispatcher.ts`
- `briefer.ts`
- `capability-planner.ts`
- `skill-builder.ts`
- `tool-builder.ts`
- `reviewer.ts`
- `improvement-analyzer.ts`
- `task-complexity-estimator.ts`
- `task-decomposer.ts`
- `bulk-detector.ts`
- `skill-manager.ts`

No `orchestrator.ts` in this directory. The orchestrator lives under `lib/ralph/` alongside `worker.ts`, which makes architectural sense — the orchestrator coordinates Ralph workers.

### The confusion is understandable

The `lib/agents/` directory contains all other AI agents, and the orchestrator is conceptually an agent. But it was placed under `lib/ralph/` because it specifically orchestrates the Ralph worker system, not general agent workflows.

## Impact Assessment

**LOW impact:**

1. **Documentation-only issue** — No runtime behavior is affected. The orchestrator works correctly regardless of what CLAUDE.md says.

2. **Developer confusion** — A new contributor (human or AI) reading CLAUDE.md would look for `lib/agents/orchestrator.ts`, not find it, and might incorrectly conclude it hasn't been built yet — exactly what happened during the original architecture audit.

3. **AI agent misdirection** — When Claude Code workers read CLAUDE.md for project context, they get a wrong file path. This could waste a few seconds of exploration but is unlikely to cause real problems.

## Recommendation

Update both references in `CLAUDE.md`:

```diff
- │   ├── agents/            # AI agent implementations
- │   │   ├── orchestrator.ts
+ No change needed in agents/ list — orchestrator is correctly under ralph/

- `lib/agents/orchestrator.ts` — Two-phase orchestration controller
+ `lib/ralph/orchestrator.ts` — Two-phase orchestration controller
```

## If Left Unfixed

- Continues to mislead anyone reading CLAUDE.md about where the orchestrator lives
- Future architecture audits may repeat the same false finding
- Minimal practical impact on system operation
