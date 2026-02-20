# Vision Documents

> WHAT each module does - purpose, behaviors, success criteria, status.

---

## Two-Document System

Digital Twin documentation is split into two types:

| Doc Type | Location | Contains |
|----------|----------|----------|
| **Vision** (this folder) | `docs/vision/` | WHAT - Purpose, behaviors, success criteria, status |
| **Design** | `docs/design/` | HOW - Implementation, APIs, file paths, code snippets |

**Why separate them?**

As noted in compound engineering research: "The PRD shows WHAT the app will do, the Design shows HOW. You can change the design doc, but the PRD stays the same in terms of its original intent."

- Vision docs are stable - they capture intent and track if we've achieved it
- Design docs can evolve - implementation details change without changing the goal

---

## How to Use These Docs

**When to read a vision doc:**
- You need to understand what a module should do
- You want to check if a capability is implemented
- You're reviewing the system's current state

**When to read the design doc:**
- You need implementation details
- You're looking for file paths or code examples
- You want API request/response formats

**When to update:**
- Use the [update-docs skill](/skills/update-docs.md) for guidance on updating both doc types

---

## Module Index

| Module | Vision | Design | Purpose |
|--------|--------|--------|---------|
| **API** | [API.md](./API.md) | [Design](../design/API.md) | Unified conversational API layer |
| **CLI** | [CLI.md](./CLI.md) | [Design](../design/CLI.md) | Terminal interface (`flow` command) |
| **Conversational** | [CONVERSATIONAL-API.md](./CONVERSATIONAL-API.md) | - | Telegram/chat interface |
| **Deployment** | [DEPLOYMENT.md](./DEPLOYMENT.md) | [Design](../design/DEPLOYMENT.md) | Always-on hosting and chat interfaces |
| **Dispatcher** | [DISPATCHER.md](./DISPATCHER.md) | [Design](../design/DISPATCHER.md) | Request routing and classification |
| **Orchestration** | [ORCHESTRATION.md](./ORCHESTRATION.md) | [Design](../design/ORCHESTRATION.md) | Two-phase execution management |
| **Worker** | [WORKER.md](./WORKER.md) | [Design](../design/WORKER.md) | Task execution engine (Ralph) |
| **HOMЯ** | [HOMЯ](../homr/VISION.md) | [Design](../homr/DESIGN.md) | Intelligent orchestration layer |
| **Learnings** | [Learnings](../learnings/VISION.md) | [Design](../learnings/DESIGN.md) | Cross-outcome memory system |
| **Skills** | [SKILLS.md](./SKILLS.md) | [Design](../design/SKILLS.md) | Reusable instruction system |
| **Review** | [REVIEW.md](./REVIEW.md) | [Design](../design/REVIEW.md) | Quality assurance and iteration |
| **Supervisor** | [SUPERVISOR.md](./SUPERVISOR.md) | [Design](../design/SUPERVISOR.md) | Safety monitoring and alerts |
| **Database** | [DATABASE.md](./DATABASE.md) | [Design](../design/DATABASE.md) | Data layer and schema |
| **UI** | [UI.md](./UI.md) | [Design](../design/UI.md) | Frontend components and pages |
| **Integration** | [INTEGRATION.md](./INTEGRATION.md) | [Design](../design/INTEGRATION.md) | External systems (Claude, Git) |
| **Analytics** | [ANALYTICS.md](./ANALYTICS.md) | [Design](../design/ANALYTICS.md) | Logging, costs, self-improvement |

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
│SKILLS │ │WORKER │ ← Capability phase builds skills
└───────┘ └───┬───┘   Execution phase runs tasks
              │
              ├────────────────────┐
              ▼                    ▼
       ┌────────────┐      ┌────────────┐
       │   HOMЯ     │ ←──→ │  REVIEW    │ ← HOMЯ observes tasks, steers work
       └──────┬─────┘      └──────┬─────┘   Review checks quality at intervals
              │                   │
              └─────────┬─────────┘
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

- [Design Docs](../design/README.md) - HOW each module is implemented
- [HOMЯ Protocol](../homr/VISION.md) - Intelligent orchestration layer
- [IDEAS.md](../IDEAS.md) - Future improvement ideas
- [VISION.md](../../VISION.md) - Original north star document (historical)

### Research

- [Harness Engineering](../research/harness-engineering.md) - Gap analysis vs Flow (deterministic quality gates, teaching errors, garbage collection agents)
- [Agent Teams](../research/agent-teams.md) - Integration patterns for Ralph Worker engine (inner execution engine, real-time review teammate)
