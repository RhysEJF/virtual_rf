# Supervisor - Design

> Implementation details for worker monitoring and alert management.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/supervisor/index.ts` | Main monitoring daemon | ~8KB |
| `lib/agents/supervisor.ts` | Supervisor agent logic | ~6KB |
| `lib/db/supervisor-alerts.ts` | Alert persistence | ~3KB |
| `app/api/supervisor/route.ts` | Start/stop supervisor | ~2KB |
| `app/api/supervisor/alerts/route.ts` | List alerts | ~2KB |
| `app/components/SupervisorAlerts.tsx` | Alert display UI | ~4KB |

---

## Monitoring Loop

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

### Global Thresholds

```typescript
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;        // 10 minutes
const NO_PROGRESS_THRESHOLD_MS = 5 * 60 * 1000;   // 5 minutes
const CONSECUTIVE_FAILURES_THRESHOLD = 3;          // 3 fails
const CHECK_INTERVAL_MS = 30 * 1000;              // Check every 30s
const STALE_HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
```

### Per-Outcome Configuration

```typescript
interface OutcomeSupervsorConfig {
  supervisor_enabled: boolean;     // Enable/disable for this outcome
  pause_sensitivity: 'low' | 'medium' | 'high';
  cot_review_frequency: number;    // Not yet used
}
```

**Pause Sensitivity Mapping:**

| Sensitivity | Consecutive Failures Threshold |
|-------------|-------------------------------|
| `low` | 5 |
| `medium` | 3 |
| `high` | 2 |

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

## API Specification

### GET /api/supervisor

Get supervisor status.

**Response:**
```json
{
  "running": true,
  "lastCheck": "2025-01-31T10:30:00Z",
  "activeAlerts": 2,
  "checkIntervalMs": 30000
}
```

### POST /api/supervisor

Start or stop supervisor.

**Request:**
```json
{
  "action": "start"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Supervisor started"
}
```

### GET /api/supervisor/alerts

List alerts with optional filters.

**Query Parameters:**
- `status`: `pending` | `acknowledged` | `resolved`
- `severity`: `critical` | `high` | `medium` | `low`
- `outcomeId`: Filter by outcome

**Response:**
```json
{
  "alerts": [
    {
      "id": "alert_123",
      "type": "stuck",
      "severity": "high",
      "message": "Worker stuck on task for 12 minutes",
      "workerId": "worker_456",
      "outcomeId": "out_789",
      "status": "pending",
      "auto_paused": false,
      "created_at": "2025-01-31T10:20:00Z"
    }
  ]
}
```

### PATCH /api/supervisor/alerts/{id}

Update alert status.

**Request:**
```json
{
  "status": "acknowledged"
}
```

---

## Database Schema

```sql
CREATE TABLE supervisor_alerts (
  id TEXT PRIMARY KEY,
  outcome_id TEXT,
  worker_id TEXT,
  type TEXT NOT NULL,      -- stuck/no_progress/repeated_failure/stale
  severity TEXT NOT NULL,   -- critical/high/medium/low
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending/acknowledged/resolved
  auto_paused INTEGER DEFAULT 0,
  created_at TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id),
  FOREIGN KEY (worker_id) REFERENCES workers(id)
);
```

---

## Alert Type Detection

### Stuck Detection

```typescript
function checkStuck(worker: Worker): boolean {
  if (!worker.current_task_id) return false;

  const task = getTaskById(worker.current_task_id);
  if (!task?.claimed_at) return false;

  const claimedTime = new Date(task.claimed_at).getTime();
  const now = Date.now();

  return (now - claimedTime) > STUCK_THRESHOLD_MS;
}
```

### No Progress Detection

```typescript
function checkNoProgress(worker: Worker): boolean {
  const latestEntry = getLatestProgressEntry(worker.id);
  if (!latestEntry) return false;

  const entryTime = new Date(latestEntry.created_at).getTime();
  const now = Date.now();

  return (now - entryTime) > NO_PROGRESS_THRESHOLD_MS;
}
```

### Repeated Failure Detection

```typescript
function checkRepeatedFailures(worker: Worker): boolean {
  const recentTasks = getRecentTasksForWorker(worker.id, 5);
  const failedCount = recentTasks.filter(t => t.status === 'failed').length;

  return failedCount >= CONSECUTIVE_FAILURES_THRESHOLD;
}
```

---

## Auto-Pause Logic

```typescript
if (repeatedFailureDetected) {
  // Create critical alert
  createAlert({
    type: 'repeated_failure',
    severity: 'critical',
    message: `Worker failed ${failedCount} consecutive tasks`,
    auto_paused: true
  });

  // Create pause intervention
  createIntervention({
    worker_id: worker.id,
    type: 'pause',
    content: 'Auto-paused due to repeated failures'
  });
}
```
