---
name: Update Documentation
description: Update vision and design docs after code changes
triggers:
  - update docs
  - update documentation
  - sync docs
  - document changes
---

# Update Documentation

## Purpose

After making code changes, this skill ensures both vision docs (`docs/vision/`) and design docs (`docs/design/`) stay in sync with the actual implementation.

## Two-Document System

| Doc Type | Location | Contains |
|----------|----------|----------|
| **Vision** | `docs/vision/` | WHAT - Purpose, behaviors, success criteria, status |
| **Design** | `docs/design/` | HOW - Implementation, APIs, file paths, code snippets |

**Rule of thumb:**
- Vision docs answer: "What should this do? Is it working?"
- Design docs answer: "How is it built? How do I use it?"

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

| File Path | Vision Doc | Design Doc |
|-----------|------------|------------|
| `app/api/converse/`, `lib/api/session.ts` | `API.md` | `API.md` |
| `app/api/telegram/`, deployment configs | `DEPLOYMENT.md` | `DEPLOYMENT.md` |
| `lib/agents/dispatcher.ts` | `DISPATCHER.md` | `DISPATCHER.md` |
| `lib/ralph/orchestrator.ts` | `ORCHESTRATION.md` | `ORCHESTRATION.md` |
| `lib/ralph/worker.ts` | `WORKER.md` | `WORKER.md` |
| `lib/agents/skill-*.ts` | `SKILLS.md` | `SKILLS.md` |
| `lib/agents/reviewer.ts` | `REVIEW.md` | `REVIEW.md` |
| `lib/supervisor/` | `SUPERVISOR.md` | `SUPERVISOR.md` |
| `lib/db/` | `DATABASE.md` | `DATABASE.md` |
| `app/components/`, `app/page.tsx`, `app/outcome/` | `UI.md` | `UI.md` |
| `lib/claude/`, `lib/git/`, `lib/worktree/` | `INTEGRATION.md` | `INTEGRATION.md` |
| `lib/agents/self-improvement.ts`, activity/cost | `ANALYTICS.md` | `ANALYTICS.md` |

### Step 2: Read Both Docs

For each affected module, read both its vision doc AND design doc to understand what's documented.

### Step 3: Determine What Changed

**For Vision Docs (WHAT), ask:**
- Did we add a new capability? → Update "Status" table
- Did we change what the module does? → Update "Key Concepts" or "Behaviors"
- Did we fix an "Open Question"? → Move it to resolved or remove
- Did something break or regress? → Update "Status" table

**For Design Docs (HOW), ask:**
- Did we add new files? → Add to file tables
- Did we change how something works? → Update implementation sections
- Did we change the API? → Update API sections
- Did we add new code patterns? → Add code examples

### Step 4: Make Updates

**Vision doc updates should be:**
- Status-focused (what works now)
- Behavior-focused (what it does)
- Concise and high-level
- No code snippets (unless essential to explain a concept)

**Design doc updates should be:**
- Implementation-focused (how it's built)
- Include file paths and code examples
- Document APIs with request/response examples
- Include dependency information

### Step 5: Verify

Ensure both docs still read coherently after updates.

## Example Updates

### Vision Doc - Adding a capability:

```markdown
## Status

| Capability | Status |
|------------|--------|
| Atomic task claiming | Complete |
| Heartbeat mechanism | Complete |
| Retry logic | Complete |        ← ADD THIS
```

### Vision Doc - Fixing an open question:

```markdown
## Open Questions

1. ~~**Task timeout** - What if a task runs forever?~~
   **Resolved:** Supervisor now detects stuck tasks after 10 minutes.
```

### Design Doc - Adding a new file:

```markdown
## Files

| File | Purpose | Size |
|------|---------|------|
| `lib/ralph/worker.ts` | Main worker logic | 29KB |
| `lib/ralph/retry.ts` | Retry handling | 3KB |  ← ADD THIS
```

### Design Doc - Adding API endpoint:

```markdown
### POST /api/workers/{id}/retry

Retry a failed task.

**Request:**
```json
{
  "taskId": "task_123"
}
```

**Response:**
```json
{
  "success": true,
  "newAttempt": 2
}
```
```

## Quality Checklist

- [ ] All changed modules have updated vision docs
- [ ] All changed modules have updated design docs
- [ ] Status tables reflect current reality
- [ ] New capabilities are documented in both docs
- [ ] Removed features are removed from both docs
- [ ] Open Questions are current
- [ ] Code examples in design docs are accurate
- [ ] Both docs read coherently
