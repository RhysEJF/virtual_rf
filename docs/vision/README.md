# Vision Documents

> Modular documentation for each major system in Digital Twin.

---

## How to Use These Docs

Each vision doc describes **what a module does today** based on the actual code. They're organized by system, not by feature or phase.

**When to read a vision doc:**
- You're about to work on that module
- You need to understand how something works
- You're debugging an issue in that area

**When to update a vision doc:**
- You've changed how the module works
- You've added significant new functionality
- The "Open Questions" have been resolved

---

## Module Index

| Module | Purpose | Key Entry Point |
|--------|---------|-----------------|
| [DISPATCHER](./DISPATCHER.md) | Request routing and classification | `lib/agents/dispatcher.ts` |
| [ORCHESTRATION](./ORCHESTRATION.md) | Two-phase execution management | `lib/ralph/orchestrator.ts` |
| [WORKER](./WORKER.md) | Task execution engine (Ralph) | `lib/ralph/worker.ts` |
| [SKILLS](./SKILLS.md) | Reusable instruction system | `lib/agents/skill-manager.ts` |
| [REVIEW](./REVIEW.md) | Quality assurance and iteration | `lib/agents/reviewer.ts` |
| [SUPERVISOR](./SUPERVISOR.md) | Safety monitoring and alerts | `lib/supervisor/index.ts` |
| [DATABASE](./DATABASE.md) | Data layer and schema | `lib/db/` |
| [UI](./UI.md) | Frontend components and pages | `app/components/` |
| [INTEGRATION](./INTEGRATION.md) | External systems (Claude, Git) | `lib/claude/client.ts` |
| [ANALYTICS](./ANALYTICS.md) | Logging, costs, self-improvement | `lib/agents/self-improvement.ts` |

---

## System Overview

```
User Input
    │
    ▼
┌─────────────┐
│ DISPATCHER  │ ← Classifies requests, routes to handlers
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ ORCHESTRATION   │ ← Manages two-phase execution
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│SKILLS │ │WORKER │ ← Infrastructure phase builds skills
└───────┘ └───┬───┘   Execution phase runs tasks
              │
              ▼
       ┌────────────┐
       │  REVIEW    │ ← Checks quality, creates fix tasks
       └──────┬─────┘
              │
              ▼
       ┌────────────┐
       │ SUPERVISOR │ ← Monitors for stuck/failed states
       └────────────┘
```

**Supporting Systems:**
- **DATABASE** - Persists all state
- **UI** - User interaction layer
- **INTEGRATION** - Claude CLI, Git, environment
- **ANALYTICS** - Learning and improvement

---

## Related Documents

- `../homr/VISION.md` - HOMЯ Protocol vision (intelligent orchestration above Ralph)
- `../homr/DESIGN.md` - HOMЯ Protocol technical architecture
- `../IDEAS.md` - Future improvement ideas (not yet approved)
- `../HIERARCHICAL_OUTCOMES.md` - Nested outcomes feature design
- `../SUPERVISOR_DESIGN.md` - Detailed supervisor design
- `../RALPH_UNLEASHED.md` - Vision for enhanced worker capabilities
- `../../VISION.md` - Original north star document (historical)
- `../../DESIGN.md` - Original detailed design (historical)
