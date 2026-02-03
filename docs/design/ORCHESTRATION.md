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

---

## Dynamic Capability Planning

### Overview

Dynamic Capability Planning allows the system to detect and create capability tasks on-the-fly, rather than requiring all capabilities to be planned upfront.

### Files

| File | Purpose |
|------|---------|
| `lib/agents/capability-planner.ts` | Pattern detection & task creation |
| `lib/db/tasks.ts` | Capability dependency checking |
| `app/components/CapabilitySuggestionBanner.tsx` | UI feedback component |
| `app/api/outcomes/[id]/capabilities/replan/route.ts` | Manual replanning endpoint |

### Capability Detection Patterns

The system uses 6 strategies to detect capabilities from approach text:

1. Explicit `skills/` and `tools/` path references
2. Skill document structure references
3. Architecture code blocks
4. Natural language patterns (e.g., "**Market Intelligence Skill**")
5. Section headers with capability keywords
6. Claude-based extraction (fallback)

### Task Capability Dependencies

Tasks can specify required capabilities:

```typescript
interface Task {
  required_capabilities?: string[];  // e.g., ['skill:market-research', 'tool:scraper']
}
```

### Dependency Checking

```typescript
// In claimNextTask - checks if capabilities exist as files
const result = checkTaskCapabilityDependencies(task, outcomeId);
if (!result.satisfied) {
  // Task is blocked, collect missing capabilities
  missingCapabilities.add(...result.missing);
}
```

### Dynamic Task Creation

When all execution tasks are blocked by missing capabilities:

```typescript
// Creates capability task dynamically
createDynamicCapabilityTask(outcomeId, 'skill:market-research');
```

### API: POST /api/outcomes/{id}/capabilities/replan

Manually trigger capability replanning.

**Request:**
```json
{
  "detectOnlyNew": true
}
```

**Response:**
```json
{
  "success": true,
  "capabilities": [
    { "type": "skill", "name": "market-research", "taskId": "123" }
  ],
  "tasksCreated": 1
}
```

### UI Component

`CapabilitySuggestionBanner` displays after approach optimization:
- Shows count of detected skills/tools
- Expandable list with details
- Create/Dismiss actions
- Loading and error states
