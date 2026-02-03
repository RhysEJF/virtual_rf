# Analytics

> Logging, tracking, and self-improvement capabilities.

---

## Purpose

Digital Twin should get smarter over time. The Analytics system:

1. **Logs activity** - What happened, when, for which outcome
2. **Tracks costs** - API usage and resource consumption
3. **Identifies bottlenecks** - Where do things get stuck
4. **Suggests improvements** - Patterns that indicate skill gaps or automation opportunities

---

## Status

| Capability | Status |
|------------|--------|
| Activity logging | Complete |
| Cost tracking | Complete |
| Bottleneck logging | Complete |
| Pattern detection | Complete |
| Improvement suggestions | Complete |
| Progress compaction | Complete |
| Escalation insights (trends, clustering) | Complete |
| Improvement analyzer agent | Complete |
| Self-improvement outcome creation | Complete |
| Background analysis jobs | Complete |
| Analysis activity logging | Complete |

**Overall:** Complete and production-ready

---

## Key Concepts

### Activity Types

| Type | Trigger |
|------|---------|
| `outcome_created` | New outcome created |
| `task_created` | Task added |
| `task_completed` | Task finished successfully |
| `task_failed` | Task failed |
| `worker_started` | Worker spawned |
| `worker_completed` | Worker finished all tasks |
| `worker_failed` | Worker crashed or was stopped |
| `review_completed` | Review cycle finished |
| `intervention_sent` | Human instruction sent |
| `analysis_started` | Improvement analysis began |
| `analysis_completed` | Improvement analysis finished |
| `analysis_failed` | Improvement analysis errored |
| `improvement_created` | Improvement outcome created |

### Pattern Detection

The self-improvement engine watches for patterns:

| Pattern | Detection | Suggestion |
|---------|-----------|------------|
| **Skill Gap** | Repeated redirections on same topic | Build a skill for X |
| **Automation** | Repeated manual task creation | Automate X |
| **Process** | Repeated pauses/errors in similar contexts | Review process for X |

### Progress Compaction

Worker progress entries can grow large. The compactor:
1. Keeps recent entries raw (last 10)
2. Summarizes older entries via Claude
3. Preserves history while managing context size

### Convergence to Self-Improvement

When enough data accumulates:
1. Pattern detection runs periodically
2. Suggestions are created with priorities
3. Users can accept (creates tasks) or dismiss
4. Accepted suggestions become capability-building work

### Escalation Insights

The system analyzes HOMЯ escalations to find patterns:

| Insight Type | Description |
|--------------|-------------|
| **Trends over time** | Escalation volume, resolution times, dismissal rates |
| **Root cause clustering** | Group escalations by underlying issue, not trigger type |
| **Recurring patterns** | Same questions appearing across outcomes |

### Improvement Analyzer Agent

The `improvement-analyzer.ts` agent analyzes escalation patterns and generates improvement proposals:

1. **Clusters escalations** - Groups by root cause (e.g., "unclear requirements", "missing skills")
2. **Identifies systemic issues** - Patterns that appear across multiple outcomes
3. **Generates improvement outcomes** - Proposes fixes with intent, approach, and tasks
4. **Creates parent-child hierarchy** - Improvements link to a "Self-Improvement" parent outcome

The analyzer can be triggered via `/api/improvements/analyze` to create new improvement outcomes automatically.

### Background Analysis Jobs

Analysis can take several minutes. To improve UX, analysis runs as background jobs:

1. **POST starts job** - Returns job ID immediately (202 Accepted)
2. **Job runs async** - Progress messages updated in database
3. **User can navigate away** - Analysis continues in background
4. **Poll for results** - GET `/api/improvements/jobs/{jobId}` returns status
5. **Toast notification** - User notified when job completes with "View Results" action

This prevents the UI from blocking during long analysis operations.

---

## Behaviors

1. **Automatic logging** - Every significant event is captured
2. **Pattern recognition** - Detects recurring issues
3. **Proactive suggestions** - Offers improvements before users ask
4. **Context management** - Compacts history to prevent bloat

---

## Success Criteria

- Complete audit trail of all work
- Recurring issues are detected and surfaced
- Suggestions are actionable and valuable
- Progress history doesn't blow up context windows

---

## Open Questions

1. **Suggestion quality** - How do we know if suggestions are good? Track accept/dismiss rates?

2. **Pattern thresholds** - When is something a pattern vs. coincidence? Currently uses simple frequency (3+ occurrences).

3. **Compaction quality** - Does summarization lose important details? Need validation.

4. **Cost attribution** - How to attribute costs to specific tasks/outcomes accurately?

---

## Related

- **Design:** [ANALYTICS.md](../design/ANALYTICS.md) - Database schemas, API specs, and algorithm details
- **Vision:** [SUPERVISOR.md](./SUPERVISOR.md) - Feeds bottleneck data into analytics
- **Vision:** [SKILLS.md](./SKILLS.md) - Skill gaps trigger skill building
