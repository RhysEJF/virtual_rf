# Orchestration - Design

> Implementation details for two-phase execution management.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/ralph/orchestrator.ts` | Main orchestration logic | ~16KB |
| `lib/agents/capability-planner.ts` | Analyzes what capabilities are needed | ~8KB |
| `app/api/outcomes/[id]/orchestrate/route.ts` | API endpoint | ~3KB |
| `app/api/outcomes/[id]/execute-plan/route.ts` | Execute plan actions | ~6KB |

---

## Orchestration Flow

```
POST /api/outcomes/{id}/orchestrate
              │
              ▼
┌─────────────────────────────────┐
│     Check capability_ready      │
└─────────────┬───────────────────┘
              │
    ┌─────────┴─────────┐
    ▼                   ▼
 ready=0,1           ready=2
    │                   │
    ▼                   ▼
Capability          Execution
   Phase              Phase
    │                   │
    ▼                   ▼
┌─────────────┐   ┌─────────────┐
│ Planner     │   │ Load skills │
│ analyzes    │   │ into context│
│ approach    │   └──────┬──────┘
└──────┬──────┘          │
       │                 ▼
       ▼           ┌─────────────┐
┌─────────────┐    │ Spawn       │
│ Create      │    │ execution   │
│ capability  │    │ worker(s)   │
│ tasks       │    └─────────────┘
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Spawn up to │
│ 3 parallel  │
│ workers     │
└──────┬──────┘
       │
       ▼
 Wait for completion
       │
       ▼
 Set ready=2
       │
       ▼
 Transition to execution
```

---

## State Machine

### capability_ready Values

| Value | Meaning | Transition |
|-------|---------|------------|
| `0` | Capabilities needed (not started) | → 1 when planner runs |
| `1` | Capabilities building (in progress) | → 2 when all tasks complete |
| `2` | Capabilities ready (can execute) | Stays at 2 |

When the approach changes significantly, `capability_ready` resets to `0` to force re-evaluation.

---

## Dependencies

**Uses:**
- `lib/agents/capability-planner.ts` - Detects capability needs
- `lib/ralph/worker.ts` - Spawns workers
- `lib/db/outcomes.ts` - Updates capability_ready state
- `lib/db/tasks.ts` - Creates capability tasks

**Used by:**
- `app/api/outcomes/[id]/orchestrate/route.ts` - API trigger
- `app/api/outcomes/[id]/execute-plan/route.ts` - Execute plan action

---

## API Specification

### POST /api/outcomes/{id}/orchestrate

Trigger orchestration for an outcome.

**Request:**
```json
{
  "async": true,
  "suggestedSkills": ["web-research", "competitor-analysis"],
  "maxCapabilityWorkers": 3
}
```

**Response:**
```json
{
  "success": true,
  "phase": "capability",
  "workersSpawned": 2,
  "tasksCreated": 3,
  "message": "Capability phase started"
}
```

### GET /api/outcomes/{id}/orchestrate

Get current orchestration status.

**Response:**
```json
{
  "phase": "capability",
  "capabilityReady": 1,
  "pendingCapabilityTasks": 2,
  "completedCapabilityTasks": 1,
  "activeWorkers": 2
}
```

---

## Capability Planner Output

```typescript
interface CapabilityPlan {
  skills: CapabilityNeed[];
  tools: CapabilityNeed[];
  existingSkills: string[];
}

interface CapabilityNeed {
  name: string;
  description: string;
  reason: string;  // Why this is needed
}
```

---

## Task Phase Filtering

Workers only claim tasks matching their current phase:

```typescript
// In claimNextTask
const task = db.prepare(`
  SELECT * FROM tasks
  WHERE outcome_id = ?
    AND status = 'pending'
    AND phase = ?
  ORDER BY priority ASC
  LIMIT 1
`).get(outcomeId, phase);
```
