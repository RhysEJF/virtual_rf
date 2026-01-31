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

## Current State

**Status:** Complete and production-ready

The Supervisor handles:
- Stuck detection (same task too long)
- No progress detection (no updates)
- Repeated failure detection (auto-pause)
- Stale worker cleanup (dead processes)
- Alert severity levels
- Optional per-outcome supervisor

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

---

## Components

### Primary Files

| File | Purpose |
|------|---------|
| `lib/supervisor/index.ts` | Main monitoring daemon |
| `lib/db/supervisor-alerts.ts` | Alert persistence |
| `app/api/supervisor/route.ts` | Start/stop supervisor |
| `app/api/supervisor/alerts/route.ts` | List alerts |
| `app/components/SupervisorAlerts.tsx` | Alert display UI |

### Monitoring Loop

```
startSupervisor()
       │
       ▼
┌─────────────────────────────────┐◀──────────┐
│     Sleep 30 seconds            │           │
└─────────────┬───────────────────┘           │
              │                               │
              ▼                               │
┌─────────────────────────────────┐           │
│     Get all running workers     │           │
└─────────────┬───────────────────┘           │
              │                               │
              ▼                               │
┌─────────────────────────────────┐           │
│     For each worker:            │           │
│     - Check stuck condition     │           │
│     - Check no progress         │           │
│     - Check consecutive fails   │           │
│     - Check stale heartbeat     │           │
└─────────────┬───────────────────┘           │
              │                               │
              ▼                               │
┌─────────────────────────────────┐           │
│     Create alerts as needed     │           │
│     (skip if active alert exists)│          │
└─────────────┬───────────────────┘           │
              │                               │
              ▼                               │
┌─────────────────────────────────┐           │
│     Handle repeated failures    │           │
│     (auto-pause if threshold)   │           │
└─────────────┬───────────────────┘           │
              │                               │
              └───────────────────────────────┘
```

---

## Configuration

```typescript
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;        // 10 minutes
const NO_PROGRESS_THRESHOLD_MS = 5 * 60 * 1000;   // 5 minutes
const CONSECUTIVE_FAILURES_THRESHOLD = 3;          // 3 fails
const CHECK_INTERVAL_MS = 30 * 1000;              // Check every 30s
```

Per-outcome configuration (optional):
```typescript
interface OutcomeSupervsorConfig {
  supervisor_enabled: boolean;     // Enable/disable
  pause_sensitivity: 'low' | 'medium' | 'high';
  cot_review_frequency: number;    // Not yet used
}
```

---

## Alert Lifecycle

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

## Dependencies

**Uses:**
- `lib/db/workers.ts` - Get running workers
- `lib/db/tasks.ts` - Check task status
- `lib/db/progress.ts` - Check progress entries
- `lib/db/interventions.ts` - Create pause interventions
- `lib/db/supervisor-alerts.ts` - Create/manage alerts

**Used by:**
- Dashboard displays active alerts
- Worker pages show alert status

---

## API

### GET /api/supervisor

Get supervisor status.

```json
{
  "running": true,
  "lastCheck": "2025-01-31T10:30:00Z",
  "activeAlerts": 2
}
```

### POST /api/supervisor

Start or stop supervisor.

```json
{
  "action": "start" | "stop"
}
```

### GET /api/supervisor/alerts

List alerts with optional filters.

```json
{
  "alerts": [
    {
      "id": "alert_123",
      "type": "stuck",
      "severity": "high",
      "message": "Worker stuck on task for 12 minutes",
      "status": "pending",
      "auto_paused": false
    }
  ]
}
```

---

## Open Questions

1. **Smart thresholds** - Should thresholds adapt based on task complexity? A complex task might legitimately take 30+ minutes.

2. **Predictive detection** - Can we detect failures before they happen based on patterns?

3. **Resolution actions** - Beyond pause, what actions should Supervisor take? Restart worker? Skip task? Escalate to human?

4. **Cross-worker patterns** - If multiple workers fail on the same outcome, should we pause the whole outcome?
