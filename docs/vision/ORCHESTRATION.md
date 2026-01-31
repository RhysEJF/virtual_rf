# Orchestration

> Manages two-phase execution: build capabilities first, then execute tasks.

---

## Purpose

Complex outcomes need preparation before execution. The Orchestrator ensures workers have the right skills and tools before starting actual work. It manages:

1. **Capability Phase** - Build skills, tools, and capabilities
2. **Execution Phase** - Run tasks using the built capabilities
3. **Phase transitions** - Know when capabilities are ready
4. **Worker spawning** - Start the right number of workers per phase

---

## Current State

**Status:** Complete and production-ready

The Orchestrator:
- Analyzes outcomes to detect capability needs
- Creates capability tasks from design docs
- Runs parallel workers for skill/tool building
- Transitions to execution when capabilities are ready
- Spawns execution workers with skill context

---

## Key Concepts

### Two-Phase Model

```
Outcome Created
      │
      ▼
┌─────────────────┐
│   CAPABILITY    │ ← Build what workers will need
│     PHASE       │   (skills, tools, capabilities)
│                 │   Up to 3 parallel workers
└────────┬────────┘
         │ capability_ready = 2
         ▼
┌─────────────────┐
│   EXECUTION     │ ← Do the actual work
│     PHASE       │   using built capabilities
│                 │   Default: 1 worker
└─────────────────┘
```

### Capability Ready States

| Value | Meaning |
|-------|---------|
| `0` | Capabilities needed (not started) |
| `1` | Capabilities building (in progress) |
| `2` | Capabilities ready (can execute) |

When the approach changes significantly, `capability_ready` resets to `0` to force re-evaluation.

### Task Phases

Tasks are tagged with their phase:
- `phase: 'capability'` - Skill/tool building tasks
- `phase: 'execution'` - Actual work tasks

Workers only claim tasks matching their current phase.

---

## Components

### Primary Files

| File | Purpose |
|------|---------|
| `lib/ralph/orchestrator.ts` | Main orchestration logic (16KB) |
| `lib/agents/infrastructure-planner.ts` | Analyzes what infrastructure is needed |
| `app/api/outcomes/[id]/orchestrate/route.ts` | API endpoint |

### Orchestration Flow

```
POST /api/outcomes/{id}/orchestrate
              │
              ▼
┌─────────────────────────────────┐
│     Check infrastructure_ready   │
└─────────────┬───────────────────┘
              │
    ┌─────────┴─────────┐
    ▼                   ▼
 ready=0,1           ready=2
    │                   │
    ▼                   ▼
Infrastructure      Execution
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
│ infra tasks │    │ worker(s)   │
└──────┬──────┘    └─────────────┘
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

## Dependencies

**Uses:**
- `lib/agents/infrastructure-planner.ts` - Detects infrastructure needs
- `lib/ralph/worker.ts` - Spawns workers
- `lib/db/outcomes.ts` - Updates infrastructure_ready state
- `lib/db/tasks.ts` - Creates infrastructure tasks

**Used by:**
- `app/api/outcomes/[id]/orchestrate/route.ts` - API trigger
- `app/api/outcomes/[id]/execute-plan/route.ts` - Execute plan action

---

## Infrastructure Planner

The Infrastructure Planner reads the outcome's approach/design doc and extracts infrastructure requirements.

**Detection patterns:**
- Explicit skill references: "Use the web-research skill..."
- Capability needs: "Need to scrape competitor websites..."
- Tool requirements: "Build a CLI tool for..."

**Output:**
```typescript
interface InfrastructureNeeds {
  skills: SkillSpec[];      // Skills to build
  tools: ToolSpec[];        // Tools to create
  existingSkills: string[]; // Already available
}
```

---

## API

### POST /api/outcomes/{id}/orchestrate

**Request:**
```json
{
  "async": true,
  "suggestedSkills": ["web-research", "competitor-analysis"]
}
```

**Response:**
```json
{
  "success": true,
  "phase": "infrastructure",
  "workersSpawned": 2,
  "tasksCreated": 3,
  "message": "Infrastructure phase started"
}
```

### GET /api/outcomes/{id}/orchestrate

Returns current orchestration status.

---

## Open Questions

1. **Parallel execution workers** - Currently defaults to 1 execution worker. When should we use multiple? Need coordination mechanism first.

2. **Skill validation** - How do we know a built skill actually works? Currently just checks file exists.

3. **Partial infrastructure** - What if some skills build successfully but others fail? Currently all-or-nothing.

4. **Infrastructure re-evaluation** - When approach changes, we reset infrastructure_ready. But should we also delete the old skills/tools?
