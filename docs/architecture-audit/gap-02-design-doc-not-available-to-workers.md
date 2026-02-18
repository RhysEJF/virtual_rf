# Gap 2: Design Doc Not Directly Available to Workers

> **Verdict: CONFIRMED GAP (PARTIAL)**
> **Severity: MEDIUM**
> **Fix complexity: LOW (template injection in worker.ts)**

---

## Claimed Gap

The full design document (approach) is stored in the `design_docs` table but is never passed to workers. Workers only receive truncated `design_context` snippets at the task level, not the complete approach document that describes the overall system design.

## Audit Findings

### The design doc is stored and retrievable

**Storage:** `design_docs` table, fetched via `getDesignDoc()` at `lib/db/outcomes.ts:572-580`

The design doc contains the full approach — architecture decisions, component relationships, data flow, implementation strategy. It is the authoritative "how" document for an outcome.

### `generateTaskInstructions()` does NOT inject the design doc

**File:** `lib/ralph/worker.ts:668-779`

The worker CLAUDE.md template includes:
- `task.description` — the task's own text
- `task.prd_context` — a PRD excerpt relevant to this task
- `task.design_context` — a design excerpt relevant to this task

It does NOT call `getDesignDoc()` or include the full approach document anywhere in the template.

### `task.design_context` is a task-level excerpt, not the full doc

The `design_context` field is populated at task creation time (either manually or during AI-driven task generation). It is a short excerpt scoped to the individual task — typically 1-3 paragraphs — not the full multi-section design document.

This means a worker implementing "Build the API layer" gets a snippet about the API, but has no visibility into how the API relates to the database layer, the frontend, or the overall architecture described in the full design doc.

### Other agents DO read the full design doc

| Agent | File | Usage |
|-------|------|-------|
| HOMR Observer | `lib/homr/observer.ts` | Reads full design doc for alignment checking |
| Orchestrator | `lib/ralph/orchestrator.ts` | References design doc during phase planning |
| Capability planner | `lib/agents/capability-planner.ts` | Analyzes design doc to determine needed skills/tools |

Workers are the only execution context that lacks the full document.

## Data Flow Trace

```
User/AI writes full design doc
        |
        v
design_docs table (full document, often 2000+ words)
        |
        +-------> observer.ts           (READS full doc)
        +-------> orchestrator.ts       (READS full doc)
        +-------> capability-planner.ts (READS full doc)
        |
        v
Task creation: extract small design_context snippet
        |
        v
Worker claims task -> generateTaskInstructions()
        |
        |   task.design_context  ✅ INCLUDED (truncated snippet)
        |   Full design doc      ❌ MISSING
        v
Claude worker executes (sees only a fragment of the approach)
```

## Impact Assessment

**MEDIUM impact:**

1. **Architectural coherence** — Workers making implementation decisions (naming conventions, data structures, API patterns) cannot reference the overall design. Each task executes in isolation from the broader architectural vision.

2. **Cross-component alignment** — When multiple workers build different parts of a system, they have no shared reference document describing how pieces fit together. Each only sees its own `design_context` snippet.

3. **Codebase-mode is worse** — In codebase mode, workers modify the actual project. Without the full design doc, they may make changes that are locally correct but globally inconsistent with the intended architecture.

4. **Partial mitigation exists** — Workers DO get some design context via `task.design_context`, which prevents this from being a HIGH severity issue. The gap is the difference between a snippet and the full document.

## Recommendation

Inject a summary or the full design doc into the worker CLAUDE.md template in `generateTaskInstructions()` at `lib/ralph/worker.ts`:

```typescript
// Fetch and inject design doc
const designDoc = getDesignDoc(outcome.id);
if (designDoc) {
  instructions += `\n## Outcome Design Document\n${designDoc.content}\n`;
}
```

For large design docs, consider injecting a summary section or the first N characters with a note that the full doc is available. For codebase-mode outcomes, the full doc should always be included since workers are making real architectural decisions.

## If Left Unfixed

- Workers continue making implementation decisions without the full architectural context
- Cross-task consistency relies entirely on the small `design_context` snippets being sufficiently detailed
- HOMR Observer may flag alignment issues that could have been prevented if workers had the full design doc
- The gap between what pre-execution agents know (full doc) and what workers know (snippet) creates a planning-execution asymmetry
