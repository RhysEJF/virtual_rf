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

## Status

| Capability | Status |
|------------|--------|
| Two-phase execution model | Complete |
| Capability detection from approach | Complete |
| Parallel capability workers (up to 3) | Complete |
| Automatic phase transition | Complete |
| Execution worker spawning | Complete |
| Dynamic capability planning | Complete |
| Capability suggestion UI banner | Complete |
| Manual capability replanning | Complete |

**Overall:** Complete and production-ready

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

### Dynamic Capability Planning

Unlike static "build all upfront" planning, Dynamic Capability Planning allows:

1. **Just-in-time detection** - Capabilities detected when approach is modified
2. **Dependency blocking** - Execution tasks blocked until required capabilities exist
3. **Auto-creation** - Missing capability tasks created dynamically at claim time
4. **User feedback** - UI banner suggests new capabilities after approach optimization

Tasks can specify `required_capabilities` (e.g., `['skill:market-research', 'tool:scraper']`). When a worker tries to claim a task, the system checks if those files exist. If not, it auto-creates capability tasks to build them first.

---

## Behaviors

1. **Approach analysis** - Reads the design doc to detect what skills/tools are needed
2. **Capability task creation** - Creates tasks to build missing capabilities
3. **Parallel building** - Runs up to 3 workers simultaneously for capability phase
4. **Automatic transition** - Moves to execution when all capability tasks complete
5. **Approach change detection** - Resets capabilities when approach significantly changes
6. **Dynamic capability detection** - Detects new capabilities when approach is updated
7. **Capability dependency blocking** - Execution tasks wait for required capabilities
8. **Auto-creation at claim time** - Missing capability tasks created when execution blocked

---

## Success Criteria

- All needed skills are identified before execution starts
- Capability tasks complete before execution tasks are claimed
- Workers are correctly filtered by phase
- Phase transitions happen automatically without user intervention

---

## Open Questions

1. **Parallel execution workers** - Currently defaults to 1 execution worker. When should we use multiple? Need coordination mechanism first.

2. **Skill validation** - How do we know a built skill actually works? Currently just checks file exists.

3. **Partial capability failure** - What if some skills build successfully but others fail? Currently all-or-nothing.

4. **Capability re-evaluation** - When approach changes, we reset capability_ready. But should we also delete the old skills/tools?

---

## Related

- **Design:** [ORCHESTRATION.md](../design/ORCHESTRATION.md) - Implementation details and API specs
- **Vision:** [WORKER.md](./WORKER.md) - How workers execute tasks
- **Vision:** [SKILLS.md](./SKILLS.md) - How skills are structured
