# Review

> Quality assurance system that checks work and creates fix tasks.

---

## Purpose

Work isn't done when tasks complete. The Review system:

1. **Evaluates completed work** against success criteria
2. **Identifies issues** with severity levels
3. **Creates fix tasks** for problems found
4. **Tracks convergence** - fewer issues each cycle means we're getting close

The goal is autonomous quality assurance with human-level thoroughness.

---

## Current State

**Status:** Complete and production-ready

The review system handles:
- PRD-based success criteria checking
- Issue detection with severity levels
- Automatic fix task generation
- Convergence tracking (consecutive clean reviews)
- Verification checklist validation

---

## Key Concepts

### Review Cycles

Reviews happen periodically during execution:

```
Cycle 1: 12 issues found → 12 fix tasks created
Cycle 2: 7 issues found  → 7 fix tasks (improving)
Cycle 3: 3 issues found  → 3 fix tasks (improving)
Cycle 4: 0 issues found  → converging
Cycle 5: 0 issues found  → DONE (2 consecutive zeros)
```

### Convergence

**Convergence = consistent improvement toward done.**

The system tracks `consecutive_clean_reviews`. When this reaches 2, the outcome is considered truly complete - not just "tasks done" but "quality verified."

### Severity Levels

| Severity | Meaning | Action |
|----------|---------|--------|
| `critical` | Blocks core functionality | High priority fix task |
| `high` | Significant issue | Standard fix task |
| `medium` | Should be addressed | Lower priority task |
| `low` | Nice to have | Optional task |

### Verification Checklist

Before marking complete, the reviewer checks:
- [ ] BUILD - Code compiles without errors
- [ ] TEST - All tests pass
- [ ] LINT - No linting errors
- [ ] FUNCTION - Core functionality works
- [ ] PRD - All PRD items addressed
- [ ] TASKS - All tasks complete

---

## Components

### Primary Files

| File | Purpose |
|------|---------|
| `lib/agents/reviewer.ts` | Main review logic (12.5KB) |
| `lib/db/review-cycles.ts` | Review cycle persistence |
| `lib/db/tasks.ts` | Fix task creation |
| `app/api/outcomes/[id]/review/route.ts` | API endpoint |

### Review Flow

```
POST /api/outcomes/{id}/review
              │
              ▼
┌─────────────────────────────────┐
│     Load outcome context        │
│     - Intent (PRD)              │
│     - Design doc                │
│     - Completed tasks           │
│     - Failed tasks              │
│     - Workspace outputs         │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│     Analyze via Claude          │
│     - Check success criteria    │
│     - Identify issues           │
│     - Assign severity           │
│     - Suggest fixes             │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│     Create fix tasks            │
│     (priority based on severity)│
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│     Record review cycle         │
│     - issues_found count        │
│     - tasks_added count         │
│     - verification results      │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│     Update convergence          │
│     (consecutive clean count)   │
└─────────────────────────────────┘
```

---

## Review Output

```typescript
interface ReviewResult {
  issues: ReviewIssue[];
  tasksCreated: number;
  convergenceStatus: 'improving' | 'stable' | 'regressing';
  consecutiveCleanReviews: number;
  verification: {
    build: boolean;
    test: boolean;
    lint: boolean;
    function: boolean;
    prd: boolean;
    tasks: boolean;
  };
}

interface ReviewIssue {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestedFix: string;
  relatedTask?: string;
}
```

---

## Iteration System

Post-completion, users can provide feedback via the Iterate section:

1. User describes bug or desired change
2. System parses feedback into structured tasks
3. Tasks created with `from_review: true`
4. Worker can be auto-started

This enables continuous improvement even after "completion."

### Files

| File | Purpose |
|------|---------|
| `app/api/outcomes/[id]/iterate/route.ts` | Process user feedback |
| `app/components/IterateSection.tsx` | Feedback UI |

---

## Dependencies

**Uses:**
- `lib/claude/client.ts` - For AI-powered review
- `lib/db/tasks.ts` - Create fix tasks
- `lib/db/review-cycles.ts` - Record reviews
- `lib/db/outcomes.ts` - Get outcome context

**Used by:**
- `app/api/outcomes/[id]/review/route.ts` - Manual trigger
- Review can be auto-triggered (not yet implemented)

---

## API

### POST /api/outcomes/{id}/review

Trigger a review cycle.

**Response:**
```json
{
  "success": true,
  "issues": 3,
  "tasksCreated": 3,
  "convergence": "improving",
  "consecutiveClean": 0
}
```

### POST /api/outcomes/{id}/iterate

Submit user feedback.

**Request:**
```json
{
  "feedback": "The login button doesn't work on mobile"
}
```

---

## Open Questions

1. **Review frequency** - When should reviews auto-trigger? Every N tasks? Every N iterations? Currently manual.

2. **Review depth** - Should the reviewer actually run the code? Currently analyzes code statically.

3. **False positives** - Reviewer sometimes creates unnecessary tasks. Need better calibration.

4. **Workspace inspection** - Reviewer should check actual outputs (screenshots, logs). Currently limited to code analysis.
