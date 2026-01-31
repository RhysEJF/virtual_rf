# Supervisor

> Safety and observability layer that monitors workers for stuck states and failures.

---

## Purpose

Workers run autonomously, but things can go wrong:
- A worker gets stuck in a loop
- A task takes forever with no progress
- Multiple tasks fail consecutively
- A worker process dies silently

The Supervisor watches for these conditions and:
1. Creates alerts for human attention
2. Auto-pauses workers when critical
3. Marks dead workers as failed
4. Provides observability into system health

---

## Status

| Capability | Status |
|------------|--------|
| Stuck detection (same task too long) | Complete |
| No progress detection (no updates) | Complete |
| Repeated failure detection (auto-pause) | Complete |
| Stale worker cleanup (dead processes) | Complete |
| Alert severity levels | Complete |
| Per-outcome supervisor config | Complete |

**Overall:** Complete and production-ready

---

## Key Concepts

### Detection Rules

| Rule | Threshold | Action |
|------|-----------|--------|
| **Stuck** | Same task > 10 min | Create alert |
| **No Progress** | No entries > 5 min | Create alert |
| **Repeated Errors** | 3+ consecutive fails | Auto-pause + critical alert |
| **Stale Worker** | No heartbeat > 5 min | Mark failed, release tasks |

### Alert Severity

| Severity | Meaning | Example |
|----------|---------|---------|
| `critical` | Requires immediate action | Worker auto-paused due to failures |
| `high` | Needs attention soon | Worker stuck for 10+ minutes |
| `medium` | Should investigate | No progress for 5 minutes |
| `low` | Informational | Minor anomaly detected |

### Auto-Pause

When a worker fails 3 consecutive tasks:
1. Supervisor creates `critical` alert
2. Creates intervention with `type: 'pause'`
3. Sets `auto_paused: true` on alert
4. Worker stops on next iteration

This prevents runaway failures from wasting resources.

### Alert Lifecycle

```
Alert Created (pending)
       │
       ▼
Human acknowledges (acknowledged)
       │
       ▼
Issue resolved (resolved)
```

Alerts can be:
- Acknowledged via UI (shows human is aware)
- Resolved when underlying issue is fixed
- Auto-resolved when worker completes successfully

---

## Behaviors

1. **Proactive detection** - Catches problems before they waste resources
2. **Graduated response** - Severity levels drive appropriate action
3. **Self-healing** - Auto-resolves alerts when issues clear
4. **Configurable** - Per-outcome settings for different sensitivity levels

---

## Success Criteria

- Stuck workers are detected within 10 minutes
- Repeated failures trigger auto-pause before excessive resource waste
- Dead processes are cleaned up without manual intervention
- Alerts are actionable and not noisy (no false positives)

---

## Open Questions

1. **Smart thresholds** - Should thresholds adapt based on task complexity? A complex task might legitimately take 30+ minutes.

2. **Predictive detection** - Can we detect failures before they happen based on patterns?

3. **Resolution actions** - Beyond pause, what actions should Supervisor take? Restart worker? Skip task? Escalate to human?

4. **Cross-worker patterns** - If multiple workers fail on the same outcome, should we pause the whole outcome?

---

## Related

- **Design:** [SUPERVISOR.md](../design/SUPERVISOR.md) - Implementation details, monitoring loop, and configuration
- **Vision:** [WORKER.md](./WORKER.md) - What the Supervisor monitors
- **Vision:** [ANALYTICS.md](./ANALYTICS.md) - How alerts feed into self-improvement
