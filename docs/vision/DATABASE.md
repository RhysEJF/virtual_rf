# Database

> SQLite-based persistence layer for all system state.

---

## Purpose

All state in Digital Twin is persisted to SQLite. The database:

1. Stores outcomes, tasks, workers, and their relationships
2. Provides atomic operations for safe multi-worker access
3. Tracks history (progress, reviews, activity)
4. Enables queries for UI and analytics

---

## Status

| Capability | Status |
|------------|--------|
| Core tables (outcomes, tasks, workers) | Complete |
| Support tables (progress, reviews, skills) | Complete |
| Analytics tables (activity, costs, bottlenecks) | Complete |
| Atomic task claiming | Complete |
| WAL mode for concurrency | Complete |
| Auto-migrations | Complete |
| Orphan cleanup | Complete |

**Overall:** Complete and production-ready (18 tables)

---

## Key Concepts

### Core Entities

| Entity | Purpose | Key Relationships |
|--------|---------|-------------------|
| **Outcomes** | Goals/projects | Parent of tasks, workers |
| **Tasks** | Executable work | Belongs to outcome, claimed by worker |
| **Workers** | Execution instances | Belongs to outcome, has current task |
| **Design Docs** | Approach documents | Belongs to outcome, versioned |

### Support Entities

| Entity | Purpose |
|--------|---------|
| **Progress Entries** | Worker episodic memory (full output capture) |
| **Review Cycles** | Review history with convergence tracking |
| **Skills** | Registered global skills |
| **Interventions** | Human instructions to workers |
| **Supervisor Alerts** | Safety alerts from monitoring |

### Analytics Entities

| Entity | Purpose |
|--------|---------|
| **Activity Log** | Event feed for dashboard |
| **Cost Log** | API cost tracking |
| **Bottleneck Log** | Failure analysis for improvements |
| **Improvement Suggestions** | Auto-generated ideas |

### Atomic Task Claiming

Multiple workers can safely race to claim tasks. Uses SQLite's IMMEDIATE transactions to ensure only one worker wins each task. Losers retry for the next one.

### Heartbeat Mechanism

Workers send heartbeats every 30 seconds. Stale workers (no heartbeat > 5 min) are detected and their tasks released.

---

## Behaviors

1. **Single source of truth** - All state lives in the database
2. **Concurrent-safe** - WAL mode and atomic transactions prevent conflicts
3. **Self-healing** - Orphan cleanup handles crashed processes
4. **Additive migrations** - Schema changes never drop data

---

## Success Criteria

- Multiple workers can run without data conflicts
- No data loss from crashes or restarts
- Queries are fast enough for UI responsiveness
- History is preserved for auditing and debugging

---

## Open Questions

1. **Database size** - `full_output` in progress_entries can grow large. Need archival strategy?

2. **Query performance** - No indexes defined explicitly. May need as data grows.

3. **Backup strategy** - SQLite is a single file. Easy to backup but no automated process.

4. **Multi-instance** - What if we run multiple Digital Twin instances? Currently assumes single instance.

---

## Related

- **Design:** [DATABASE.md](../design/DATABASE.md) - Full schema definitions, SQL, and CRUD operations
- **Vision:** [WORKER.md](./WORKER.md) - How workers use atomic claiming
- **Vision:** [ANALYTICS.md](./ANALYTICS.md) - How analytics tables are used
