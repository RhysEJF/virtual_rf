# Gap 3: `create_pr_on_complete` Flag Stored But Not Implemented

> **Verdict: CONFIRMED GAP**
> **Severity: MEDIUM**
> **Fix complexity: MEDIUM (hook into outcome completion flow)**

---

## Claimed Gap

The `create_pr_on_complete` boolean flag is fully wired through the database, UI, and CLI — but no code ever checks it to automatically create a pull request when an outcome is achieved. The flag is a no-op.

## Audit Findings

### The flag is fully wired through the stack

**Schema:** `lib/db/schema.ts:102` (TypeScript), line `857` (SQL DDL)

The field appears across 8+ files in the codebase:

| Layer | File | Lines | What it does |
|-------|------|-------|--------------|
| Schema | `lib/db/schema.ts` | 102, 857 | Field definition and SQL column |
| Migration | `lib/db/index.ts` | 153 | ALTER TABLE to add column |
| DB CRUD | `lib/db/outcomes.ts` | 43, 69, 90, 121, 285, 370-372 | Read/write in all outcome operations |
| UI toggle | `app/components/GitConfigSection.tsx` | 34, 76, 126, 383 | Checkbox labeled "Create PR when outcome achieved" |
| CLI types | `cli/src/api.ts` | 75, 621, 638 | Type definition and API integration |

### Manual PR creation exists and works

**File:** `app/api/outcomes/[id]/git/pr/route.ts`

This endpoint calls `createPullRequest()` from `lib/git/utils.ts:402`, which performs the actual git operations to create a branch, commit, and open a PR. The mechanism works — it just requires manual invocation via the API or UI.

### Automatic PR creation on completion is completely missing

A search for where the flag might be checked in business logic reveals no conditional use:

- No code path checks `outcome.create_pr_on_complete === true` before triggering PR creation
- The outcome achievement flow (when all tasks complete or reviews pass) does not reference this flag
- The reviewer agent (`lib/agents/reviewer.ts`) does not check it after clean reviews
- The orchestrator (`lib/ralph/orchestrator.ts`) does not check it during phase transitions
- The worker completion handler in `worker.ts` does not check it

The flag is stored, displayed, and toggled — but never acted upon.

### UI is misleading

**File:** `app/components/GitConfigSection.tsx:383`

The checkbox label reads "Create PR when outcome achieved" — this implies automatic behavior that does not exist. A user enabling this toggle would reasonably expect a PR to be created when the outcome completes. Nothing happens.

## Data Flow Trace

```
User enables "Create PR when outcome achieved" toggle
        |
        v
GitConfigSection.tsx -> PATCH /api/outcomes/[id]
        |
        v
outcomes.updateOutcome({ create_pr_on_complete: true })
        |
        v
Flag stored in SQLite outcomes table
        |
        v
... outcome tasks complete ...
... reviewer approves ...
... outcome status -> "completed" ...
        |
        |   Check create_pr_on_complete?  ❌ NEVER CHECKED
        |   Call createPullRequest()?     ❌ NEVER CALLED
        v
Outcome completes. No PR created. Flag ignored.
```

## Impact Assessment

**MEDIUM impact:**

1. **Broken user contract** — The UI presents a toggle with a clear behavioral promise ("Create PR when outcome achieved") that is not honored. Users who enable this setting are silently misled.

2. **Manual workaround exists** — Users can manually trigger PR creation via the API endpoint, so this is not blocking. But the automation that the flag promises is absent.

3. **Git workflow gap** — For outcomes using branch-based workflows, the PR is the natural delivery mechanism. Forgetting to manually create a PR after completion defeats the purpose of the git integration.

## Recommendation

Hook into the outcome completion flow to check the flag and trigger PR creation. The most natural location is after the reviewer agent confirms convergence or when outcome status transitions to "completed":

```typescript
// In the outcome completion handler (after reviewer approves)
if (outcome.create_pr_on_complete) {
  await createPullRequest(outcome);
}
```

This requires:
1. Identifying the exact code path where outcome status becomes "completed"
2. Adding the conditional PR creation call
3. Error handling (log failures but don't block completion)

The `createPullRequest()` function already exists and works — this is purely about wiring the trigger.

## If Left Unfixed

- Users who enable "Create PR when outcome achieved" will never see automatic PRs
- The toggle remains a non-functional UI element, eroding trust in the system's configuration options
- Git workflow automation promised by the settings panel is silently broken
- Manual PR creation via the API remains the only option, requiring users to remember to do it
