# Analytics

> Logging, cost tracking, and self-improvement systems.

---

## Purpose

Digital Twin learns from its own operation:

1. **Activity logging** - What happened and when
2. **Cost tracking** - How much did it cost
3. **Bottleneck detection** - What went wrong
4. **Self-improvement** - What could be better

This enables the system to get smarter over time.

---

## Current State

**Status:** Complete and production-ready

Analytics includes:
- Activity feed with event types
- Cost logging per outcome/worker/task
- Bottleneck logging for failures
- Auto-generated improvement suggestions
- Progress compaction for long runs

---

## Activity Logging

### Event Types

| Type | Meaning |
|------|---------|
| `outcome_created` | New outcome started |
| `task_created` | Task added |
| `task_completed` | Task finished successfully |
| `task_failed` | Task failed |
| `worker_started` | Worker spawned |
| `worker_completed` | Worker finished |
| `review_completed` | Review cycle done |
| `intervention_sent` | Human instruction sent |

### Storage

```sql
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  outcome_name TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata TEXT,  -- JSON for extra data
  created_at TEXT
);
```

### Usage

```typescript
// lib/db/activity.ts
logActivity({
  outcomeId: 'out_123',
  outcomeName: 'Product Landing Page',
  type: 'task_completed',
  title: 'Hero section built',
  description: 'Created responsive hero with animations',
  metadata: { taskId: 'task_456', duration: 120 }
});
```

Displayed in UI via `ActivityFeed.tsx` on dashboard.

---

## Cost Tracking

### Storage

```sql
CREATE TABLE cost_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  worker_id TEXT,
  task_id TEXT,
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT
);
```

### Tracking

Currently minimal - the Claude CLI doesn't report costs directly. Workers track `cost` field but it's not accurately populated.

**Future:** Could estimate based on token counts or track actual API costs if using API.

---

## Bottleneck Detection

### Storage

```sql
CREATE TABLE bottleneck_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  intervention_type TEXT,
  description TEXT,
  resolution TEXT,
  created_at TEXT
);
```

### Tracked Events

- Human interventions (pauses, redirects)
- Task failures
- Worker stuck conditions
- Repeated errors

### Analysis

The Self-Improvement Engine analyzes bottlenecks to find patterns:

```typescript
// lib/agents/self-improvement.ts
interface Pattern {
  type: 'skill_gap' | 'automation' | 'process';
  description: string;
  frequency: number;
  suggestedAction: string;
}
```

---

## Self-Improvement Engine

### Purpose

Analyzes completed work to generate improvement suggestions.

### Pattern Types

| Type | Detection | Suggestion |
|------|-----------|------------|
| `skill_gap` | Repeated redirections on same topic | Build a skill for X |
| `automation` | Repeated manual task creation | Automate X |
| `process` | Repeated pauses/errors in similar contexts | Review process for X |

### Storage

```sql
CREATE TABLE improvement_suggestions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,      -- skill_gap/automation/process
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 2,
  status TEXT DEFAULT 'pending',  -- pending/accepted/dismissed
  created_at TEXT
);
```

### UI

Displayed via `ImprovementSuggestions.tsx` on dashboard.

---

## Progress Compaction

### Problem

Long-running workers generate many progress entries. Context would explode if we kept all of them.

### Solution

The Compactor periodically summarizes old entries:

```typescript
// lib/agents/compactor.ts
export async function compactProgress(
  outcomeId: string,
  threshold: number = 50
): Promise<void> {
  const entries = getProgressEntries(outcomeId);
  if (entries.length < threshold) return;

  // Summarize old entries
  const oldEntries = entries.slice(0, -10);  // Keep last 10 raw
  const summary = await summarizeEntries(oldEntries);

  // Mark as compacted
  markEntriesCompacted(oldEntries, summary.id);
}
```

### Result

Workers see:
- Compacted summary of iterations 1-40
- Raw details of iterations 41-50 (current)

This keeps context manageable while preserving history.

---

## Components

### Files

| File | Purpose |
|------|---------|
| `lib/db/activity.ts` | Activity logging |
| `lib/db/cost.ts` | Cost tracking (minimal) |
| `lib/db/bottleneck.ts` | Bottleneck logging |
| `lib/agents/self-improvement.ts` | Pattern detection |
| `lib/agents/compactor.ts` | Progress compaction |
| `app/api/activity/route.ts` | Activity API |
| `app/api/costs/route.ts` | Costs API |
| `app/api/improvements/route.ts` | Suggestions API |

---

## Dependencies

**Uses:**
- `lib/db/` - All logging goes to database
- `lib/claude/client.ts` - For summarization

**Used by:**
- Dashboard (activity feed, suggestions)
- Worker system (progress logging)
- Analytics queries

---

## Open Questions

1. **Accurate cost tracking** - How to get actual costs when using CLI subscription? Could estimate from token counts.

2. **Pattern sophistication** - Current pattern detection is basic. Could use ML for better detection.

3. **Suggestion actionability** - Suggestions are displayed but not automatically acted upon. Should we auto-create skills?

4. **Data retention** - How long to keep activity/progress data? Need archival policy.

5. **Cross-outcome learning** - Currently patterns are per-outcome. Could learn across all outcomes.
