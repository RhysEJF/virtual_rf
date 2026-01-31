# Review - Design

> Implementation details for quality assurance and convergence tracking.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/agents/reviewer.ts` | Main review logic | ~12.5KB |
| `lib/db/review-cycles.ts` | Review cycle persistence | ~3KB |
| `lib/db/tasks.ts` | Fix task creation | ~6KB |
| `app/api/outcomes/[id]/review/route.ts` | Review API endpoint | ~2KB |
| `app/api/outcomes/[id]/iterate/route.ts` | User feedback endpoint | ~3KB |
| `app/components/IterateSection.tsx` | Feedback UI | ~4KB |

---

## Review Flow

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

## API Specification

### POST /api/outcomes/{id}/review

Trigger a review cycle.

**Response:**
```json
{
  "success": true,
  "issues": 3,
  "tasksCreated": 3,
  "convergence": "improving",
  "consecutiveClean": 0,
  "verification": {
    "build": true,
    "test": true,
    "lint": false,
    "function": true,
    "prd": true,
    "tasks": true
  }
}
```

### POST /api/outcomes/{id}/iterate

Submit user feedback for post-completion changes.

**Request:**
```json
{
  "feedback": "The login button doesn't work on mobile",
  "autoStartWorker": true
}
```

**Response:**
```json
{
  "success": true,
  "tasksCreated": 2,
  "workerStarted": true,
  "workerId": "worker_789"
}
```

---

## Data Structures

### Review Result

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
```

### Review Issue

```typescript
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

## Database Schema

```sql
CREATE TABLE review_cycles (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  cycle_number INTEGER NOT NULL,
  issues_found INTEGER DEFAULT 0,
  tasks_added INTEGER DEFAULT 0,
  verification_results TEXT,  -- JSON
  created_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id)
);
```

---

## Severity to Priority Mapping

| Severity | Task Priority |
|----------|---------------|
| `critical` | 1 (highest) |
| `high` | 2 |
| `medium` | 3 |
| `low` | 4 (lowest) |

---

## Convergence Calculation

```typescript
function updateConvergence(outcomeId: string, issuesFound: number): void {
  const outcome = getOutcomeById(outcomeId);

  if (issuesFound === 0) {
    // Increment consecutive clean count
    updateOutcome(outcomeId, {
      consecutive_clean_reviews: (outcome.consecutive_clean_reviews || 0) + 1
    });
  } else {
    // Reset consecutive clean count
    updateOutcome(outcomeId, {
      consecutive_clean_reviews: 0
    });
  }
}
```

Completion is reached when `consecutive_clean_reviews >= 2`.
