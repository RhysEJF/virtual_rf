---
name: Update Documentation
description: Update vision docs after code changes
triggers:
  - update docs
  - update documentation
  - sync docs
  - document changes
---

# Update Documentation

## Purpose

After making code changes, this skill ensures the modular vision docs in `docs/vision/` stay in sync with the actual implementation.

## When to Use

- After completing a feature or fix
- At the end of a coding session
- When you notice docs are out of date
- Before starting work on a module (to verify docs are current)

## Process

### Step 1: Identify Changed Modules

Check what files changed recently:

```bash
git diff --name-only HEAD~5
```

Or for uncommitted changes:

```bash
git status --short
```

Map changed files to modules:

| File Path | Vision Doc |
|-----------|------------|
| `lib/agents/dispatcher.ts` | `docs/vision/DISPATCHER.md` |
| `lib/ralph/orchestrator.ts` | `docs/vision/ORCHESTRATION.md` |
| `lib/ralph/worker.ts` | `docs/vision/WORKER.md` |
| `lib/agents/skill-*.ts` | `docs/vision/SKILLS.md` |
| `lib/agents/reviewer.ts` | `docs/vision/REVIEW.md` |
| `lib/supervisor/` | `docs/vision/SUPERVISOR.md` |
| `lib/db/` | `docs/vision/DATABASE.md` |
| `app/components/`, `app/page.tsx`, `app/outcome/` | `docs/vision/UI.md` |
| `lib/claude/`, `lib/git/`, `lib/worktree/` | `docs/vision/INTEGRATION.md` |
| `lib/agents/self-improvement.ts`, activity/cost | `docs/vision/ANALYTICS.md` |

### Step 2: Read the Relevant Vision Doc

For each affected module, read its vision doc to understand what's documented.

### Step 3: Compare with Code Changes

Ask:
- Did we add a new capability? → Add to "Key Concepts" or "Components"
- Did we change how something works? → Update the relevant section
- Did we fix an "Open Question"? → Move it to resolved or remove
- Did we add new files? → Add to "Components" table
- Did we change the API? → Update "API" section if present

### Step 4: Make Updates

Update the vision doc with concise changes:
- Keep the same structure and style
- Be factual (what exists now, not what we plan)
- Update "Current State" if status changed
- Add new "Open Questions" if we discovered issues

### Step 5: Verify

Ensure the doc still reads coherently after updates.

## Example Updates

**Adding a new capability:**
```markdown
## Key Concepts

### New: Retry Logic  ← ADD THIS

When a task fails, the worker will retry up to `max_attempts` times
before marking it as permanently failed.
```

**Fixing an open question:**
```markdown
## Open Questions

1. ~~**Task timeout** - What if a task runs forever?~~
   **Resolved:** Supervisor now detects stuck tasks after 10 minutes.

2. **Retry logic** - When should we give up?
```

**Adding a new file:**
```markdown
## Components

| File | Purpose |
|------|---------|
| `lib/ralph/worker.ts` | Main worker logic |
| `lib/ralph/retry.ts` | Retry handling (NEW) |  ← ADD THIS
```

## Quality Checklist

- [ ] All changed modules have updated vision docs
- [ ] New capabilities are documented
- [ ] Removed features are removed from docs
- [ ] Open Questions are current
- [ ] Doc still reads coherently
