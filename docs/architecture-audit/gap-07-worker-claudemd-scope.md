# Gap 7: Worker CLAUDE.md Scope — Workers May See Root CLAUDE.md

> **Verdict: BY DESIGN (not a gap, but needs documentation)**
> **Severity: LOW**
> **Fix complexity: N/A (documentation only)**

---

## Claimed Gap

The original audit suggested that workers might not be properly scoped — that the generated per-task CLAUDE.md could conflict with or be superseded by the root project CLAUDE.md, or that workers might lack proper contextual boundaries.

## Audit Findings

### Two distinct CLAUDE.md files exist

1. **Root CLAUDE.md** (`/flow/CLAUDE.md`) — Human-authored project documentation. Contains tech stack, coding standards, project structure, git workflow guidelines. ~500 lines.

2. **Generated per-task CLAUDE.md** — Created by `generateTaskInstructions()` in `lib/ralph/worker.ts:668-779`. Contains task-specific instructions, PRD context, design context, skill content, and behavioral rules. Written to the task's working directory.

### Worker `cwd` determines which CLAUDE.md is primary

**File:** `lib/ralph/worker.ts:1577`

```typescript
cwd: taskWorkspace
```

The Claude CLI process is launched with `cwd` set to the task workspace directory (e.g., `workspaces/out_{id}/task_{id}/`). The generated CLAUDE.md is written to this directory.

### Claude Code CLI reads CLAUDE.md hierarchically

Claude Code CLI reads CLAUDE.md files from the current directory upward to the project root. This means:

- **Workspace-isolated tasks** (`workspaces/out_{id}/task_{id}/`): See the generated CLAUDE.md. May or may not traverse up to the root depending on git boundaries.
- **Codebase-mode tasks** (cwd is the project root): See BOTH the generated CLAUDE.md in the task dir AND the root CLAUDE.md. The root file provides project context (coding standards, etc.) that is actually useful for codebase modifications.

### This is intentional, not a bug

For **workspace-isolated** tasks:
- Workers operate in a sandboxed workspace
- The generated CLAUDE.md is the primary (often only) instruction source
- Root CLAUDE.md may not be visible depending on directory traversal rules

For **codebase-mode** tasks:
- Workers modify the actual project files
- Having access to root CLAUDE.md (coding standards, project structure) is *beneficial*
- The generated task CLAUDE.md provides task-specific context on top of project context
- Both files complement each other

### Potential concern: instruction conflicts

If the generated CLAUDE.md and root CLAUDE.md give contradictory instructions, the worker could be confused. However:
- The generated CLAUDE.md focuses on *what to do* (task, PRD, design)
- The root CLAUDE.md focuses on *how to write code* (standards, conventions)
- These are orthogonal concerns with minimal overlap

### The generated CLAUDE.md explicitly scopes the worker

**File:** `lib/ralph/worker.ts:~700-720`

The generated instructions include explicit scoping:
- "You are a worker executing a specific task"
- "Do NOT modify files outside your workspace" (for isolated mode)
- Task-specific behavioral rules

This scoping is sufficient to prevent workers from ignoring their task context in favor of root-level instructions.

## Impact Assessment

**LOW impact:**

1. **Working as designed** — The dual CLAUDE.md system is a feature, not a bug. Codebase-mode workers benefit from root project context.

2. **No observed conflicts** — In practice, the two files address different concerns and coexist without contradiction.

3. **Documentation gap** — The behavior is not documented anywhere. A developer might be surprised to learn that codebase-mode workers see both CLAUDE.md files. This should be documented but doesn't need a code change.

## Recommendation

Document the CLAUDE.md hierarchy behavior in `docs/vision/WORKER.md`:

- Explain that workers in workspace-isolated mode see only the generated CLAUDE.md
- Explain that workers in codebase mode see both generated + root CLAUDE.md
- Note that the root CLAUDE.md provides coding standards while the generated one provides task context
- Clarify that this is intentional complementary behavior

No code changes needed.

## If Left Unfixed

- No runtime impact — system works correctly as-is
- New developers/agents may be confused about which CLAUDE.md takes precedence
- Could become a real issue if someone adds task-contradictory instructions to root CLAUDE.md
