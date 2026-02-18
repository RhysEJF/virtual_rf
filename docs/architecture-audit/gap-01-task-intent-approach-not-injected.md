# Gap 1: `task_intent` and `task_approach` Not Injected into Worker CLAUDE.md

> **Verdict: CONFIRMED GAP**
> **Severity: HIGH**
> **Fix complexity: LOW (2-line template addition)**

---

## Claimed Gap

`task_intent` and `task_approach` fields exist on the Task schema (`lib/db/schema.ts:173-175`) but `generateTaskInstructions()` in `worker.ts` doesn't use them. Task-level HOW overrides are stored but never reach the worker.

## Audit Findings

### The fields exist and are actively populated

**Schema:** `lib/db/schema.ts:173-175`
```typescript
task_intent: string | null;       // Mini-PRD: what this task should achieve
task_approach: string | null;     // How to execute: methodology, tools, constraints
```

**Five active write paths populate these fields:**

| Path | File | What happens |
|------|------|--------------|
| UI direct edit | `app/components/ExpandableTaskCard.tsx:298-305` | Users type intent/approach overrides in task card |
| AI optimize | `app/api/tasks/[id]/optimize-context/route.ts:109-124` | Claude generates structured intent/approach from ramble text |
| Converse agent | `lib/converse/tool-executor.ts:260-261` | Conversational agent sets fields when creating/updating tasks |
| Improvements pipeline | `app/api/improvements/create/route.ts:293-314` | Self-improvement system creates tasks with precise AI-generated intent/approach |
| DB layer | `lib/db/tasks.ts:33-34, 85-86` | `createTask()` and `updateTask()` fully support both fields |

### The fields ARE used by pre-execution agents

| Agent | File | Uses |
|-------|------|------|
| Complexity estimator | `lib/agents/task-complexity-estimator.ts:100-101, 134-135` | Includes both fields in complexity analysis prompt |
| Task decomposer | `lib/agents/task-decomposer.ts:250-251, 272-273` | Includes both fields in decomposition prompt |
| Bulk detector | `lib/agents/bulk-detector.ts:192-193` | Reads both fields for pattern detection |

### But `generateTaskInstructions()` ignores them completely

**File:** `lib/ralph/worker.ts:668-779`

The template includes `task.description`, `task.prd_context`, and `task.design_context` — but never references `task.task_intent` or `task.task_approach`. The worker CLAUDE.md that Claude reads at execution time is missing this context entirely.

## Data Flow Trace

```
User/AI sets task_intent + task_approach
        |
        v
Stored in tasks table (SQLite)
        |
        +-------> task-complexity-estimator.ts  (READS both fields)
        +-------> task-decomposer.ts            (READS both fields)
        +-------> bulk-detector.ts              (READS both fields)
        |
        v
Worker claims task → generateTaskInstructions()
        |
        |   task.description     ✅ INCLUDED
        |   task.prd_context     ✅ INCLUDED
        |   task.design_context  ✅ INCLUDED
        |   task.task_intent     ❌ MISSING
        |   task.task_approach   ❌ MISSING
        v
Claude worker executes (never sees task_intent or task_approach)
```

## Impact Assessment

**HIGH impact**, particularly for:

1. **Self-improvement tasks** — The improvements pipeline generates precise, AI-crafted `task_intent` and `task_approach` values (e.g., "Understand why these escalations occur and what information workers are missing"). These instructions are completely invisible to the executing worker.

2. **User intent overrides silently ignored** — When a user edits a task's intent or approach through the UI (or optimizes it with AI), the worker never sees those changes. No indication is given that edits aren't reaching the worker.

3. **Pre-execution / execution asymmetry** — The complexity estimator can make decisions based on enriched context that the executing worker never sees. A task might be kept intact because its `task_approach` suggests tractability — but the worker must re-infer the approach from scratch.

## Recommendation

Add both fields to the CLAUDE.md template in `generateTaskInstructions()` at `lib/ralph/worker.ts` around line 754:

```typescript
${task.task_intent ? `### Task Intent\n${task.task_intent}\n` : ''}
${task.task_approach ? `### Task Approach\n${task.task_approach}\n` : ''}
```

No schema, DB, or API changes needed. Two-line template addition.

## If Left Unfixed

- Workers continue operating without enriched task context that users and AI agents actively populate
- Self-improvement outcomes produce tasks with detailed instructions that are silently discarded at execution time
- User edits to task intent/approach via the UI have no effect on worker behavior
