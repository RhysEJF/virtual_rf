# The HOMЯ Protocol: Vision Document

> The intelligent orchestration layer that keeps autonomous agents aligned, coordinated, and accountable.

**Related Documents:**
- [DESIGN.md](./DESIGN.md) - Technical architecture and implementation details
- [../VISION.md](../VISION.md) - Overall Digital Twin vision
- [../DESIGN.md](../DESIGN.md) - Overall system design

---

## Executive Summary

The HOMЯ Protocol is the outer orchestration layer that sits above Ralph workers, providing continuous observation, intelligent steering, and human escalation. It solves the fundamental limitation of autonomous agent loops: **they work hard but not smart** - grinding through tasks without awareness of drift, cross-dependencies, or emerging blockers.

HOMЯ maintains the big picture that individual workers lose, ensuring that brute-force execution stays aligned with intent.

---

## The Problem: Ralph Loops Aren't Enough

### What Ralph Does Well

Our Ralph workers are effective at:
- Claiming and executing individual tasks
- Working autonomously without constant supervision
- Following instructions in CLAUDE.md
- Signaling completion via progress.txt

### What Ralph Cannot Do

Based on analysis of autonomous agent patterns (and our own implementation), Ralph loops have fundamental limitations:

| Limitation | Description | Impact |
|------------|-------------|--------|
| **Context Rot** | Each task starts fresh. Workers lose accumulated wisdom about "why" decisions were made. | Later tasks repeat early mistakes or contradict established patterns |
| **No Drift Detection** | Workers execute tasks but don't check if output aligns with original intent | Work can go off-rails without anyone noticing until review |
| **Cross-Task Blindness** | Parallel workers can't share discoveries | Worker A solves a problem that Worker B is also struggling with |
| **Static Task Lists** | Tasks are defined upfront and don't adapt to learnings | Mid-implementation discoveries require manual intervention |
| **Ambiguity Paralysis** | Workers either guess (wrong) or block (wasteful) when requirements are unclear | Both outcomes are suboptimal |
| **No Proactive Escalation** | System only alerts on failures, not on confusion or uncertainty | Human learns about problems too late |

### The Core Insight

> **Individual workers optimize locally. HOMЯ optimizes globally.**

A worker completing Task A doesn't know that:
- Task B just discovered the API they're both using has a rate limit
- Task C's approach contradicts the design doc
- The user would want to know about an architectural decision before proceeding
- Three workers are all blocked on the same unclear requirement

HOMЯ sees all of this and acts on it.

---

## What HOMЯ Does

The HOMЯ Protocol performs three core functions:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        THE HOMЯ PROTOCOL                            │
│                                                                     │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐       │
│  │               │    │               │    │               │       │
│  │   OBSERVE     │───▶│    STEER      │───▶│   ESCALATE    │       │
│  │               │    │               │    │               │       │
│  │ • Read output │    │ • Update tasks│    │ • Detect      │       │
│  │ • Check drift │    │ • Inject ctx  │    │   ambiguity   │       │
│  │ • Track state │    │ • Reprioritize│    │ • Pause work  │       │
│  │ • Find issues │    │ • Create tasks│    │ • Ask human   │       │
│  │               │    │               │    │               │       │
│  └───────────────┘    └───────────────┘    └───────────────┘       │
│         │                                          │                │
│         └──────────────────────────────────────────┘                │
│                    Continuous feedback loop                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 1. OBSERVE - Maintain Situational Awareness

After each task completes (and periodically during long tasks), HOMЯ:

- **Reads the full output** - What did the worker actually produce?
- **Compares against intent** - Does this align with the PRD/Design Doc?
- **Detects patterns** - Is the worker struggling? Going in circles?
- **Extracts discoveries** - What did this task learn that others should know?
- **Assesses quality** - Is this good work or does it need fixing?

HOMЯ builds a **living context** that persists across tasks and workers.

### 2. STEER - Keep Work Aligned

When observation reveals issues, HOMЯ takes corrective action:

- **Inject context** - Tell upcoming tasks about discoveries from completed ones
- **Modify tasks** - Update descriptions based on new learnings
- **Reprioritize** - Change task order when dependencies shift
- **Create tasks** - Add work items for issues discovered
- **Mark obsolete** - Remove tasks that are no longer relevant
- **Adjust approach** - Recommend design doc updates when patterns emerge

HOMЯ ensures the task list **evolves with the work**, not static from the start.

### 3. ESCALATE - Know When to Ask

The hardest problem in autonomous systems: **knowing what you don't know.**

HOMЯ detects ambiguity signals:
- Worker output contains uncertainty markers ("I'm not sure if...", "assuming that...")
- Multiple valid approaches with no clear winner
- Requirements that contradict each other
- Decisions that would be hard to reverse
- Work that affects shared code or collaborators
- **Failure patterns** - Consecutive task failures indicating systemic issues

When detected, HOMЯ:
- **Pauses affected work** - Don't proceed on shaky ground
- **Formulates a clear question** - Not "help", but specific options with tradeoffs
- **Presents to human** - Via alert, notification, or UI prompt
- **Resumes on answer** - Injects clarification and continues

---

## What HOMЯ Is NOT

To prevent scope creep and maintain focus:

| HOMЯ Is | HOMЯ Is Not |
|---------|-------------|
| Coordination layer | Replacement for Ralph workers |
| Observer and advisor | Executor of tasks |
| Human escalation point | Autonomous decision maker for big choices |
| Context maintainer | Database or state store |
| Quality checker | Full code reviewer (that's the Reviewer agent) |

HOMЯ augments the existing system, it doesn't replace it.

---

## Integration with Existing Systems

HOMЯ works alongside (not replacing) current components:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DIGITAL TWIN SYSTEM                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                       THE HOMЯ PROTOCOL                            │  │
│  │                    (New Orchestration Layer)                       │  │
│  │                                                                    │  │
│  │  Observe ──▶ Steer ──▶ Escalate                                   │  │
│  │      │          │          │                                       │  │
│  └──────┼──────────┼──────────┼───────────────────────────────────────┘  │
│         │          │          │                                          │
│         ▼          ▼          ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                     EXISTING COMPONENTS                             │ │
│  │                                                                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │ Supervisor  │  │   Ralph     │  │  Reviewer   │                 │ │
│  │  │ (Security)  │  │  Workers    │  │   Agent     │                 │ │
│  │  │             │  │             │  │             │                 │ │
│  │  │ File watch  │  │ Task exec   │  │ Quality     │                 │ │
│  │  │ Patterns    │  │ Progress    │  │ Convergence │                 │ │
│  │  │ Auto-pause  │  │ Commits     │  │ Fix tasks   │                 │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │ │
│  │                                                                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Relationship to Supervisor (Security Layer):**
- Supervisor handles file-level security (patterns, suspicious behavior)
- HOMЯ handles semantic-level coordination (drift, quality, steering)
- They complement each other - Supervisor is "don't do bad things", HOMЯ is "do the right things"

**Relationship to Reviewer Agent:**
- Reviewer does deep quality checks at review cycles
- HOMЯ does lightweight continuous observation
- Reviewer creates fix tasks, HOMЯ steers ongoing work

**Relationship to Ralph Workers:**
- Ralph executes tasks autonomously
- HOMЯ provides context and steering between tasks
- Ralph signals completion, HOMЯ decides what happens next

---

## Success Criteria

### Measurable Outcomes

1. **Reduced Drift**
   - Work stays aligned with intent throughout execution
   - Fewer "wait, that's not what I wanted" moments at completion

2. **Faster Convergence**
   - Cross-task learning reduces repeated mistakes
   - Review cycles find fewer issues because HOMЯ caught them earlier

3. **Smarter Escalation**
   - Human is asked before costly mistakes, not after
   - Questions are specific and actionable, not vague

4. **Context Continuity**
   - Later tasks benefit from early task learnings
   - Parallel workers share discoveries

### Qualitative Goals

- **User trusts the system** - Confident that work is progressing correctly
- **Intervention is optional** - System handles routine steering, human handles exceptions
- **Transparency** - User can see what HOMЯ observed, steered, and why

---

## Design Principles

### 1. Observe Before Acting

HOMЯ never steers blind. Every steering decision is based on concrete observations from task outputs, not assumptions.

### 2. Steer Gently, Escalate Rarely

Most work should proceed without human intervention. HOMЯ adjusts trajectory continuously so major corrections aren't needed. Escalation is for genuine ambiguity, not routine decisions.

### 3. Context is King

The value of HOMЯ is maintaining context that workers lose. Every observation should extract learnings. Every steering action should inject relevant context.

### 4. Fail Safe

When HOMЯ is uncertain, it escalates rather than guessing. When it can't reach the human, it pauses rather than proceeding. The cost of waiting is lower than the cost of wrong work.

### 5. Transparent Operations

Every HOMЯ decision should be explainable. "I paused Task B because Task A discovered X" not "I paused Task B for reasons."

---

## User Experience Vision

### What the User Sees

**On the Outcome Detail Page:**

```
┌─ HOMЯ STATUS ────────────────────────────────────────────────────────┐
│                                                                       │
│  ● Active  │  Last check: 2 min ago  │  3 tasks observed             │
│                                                                       │
│  Recent Activity:                                                     │
│  • Injected API rate limit discovery into Task #7, #8                │
│  • Reprioritized Task #9 (now depends on #6 completion)              │
│  • ⚠ Question pending: Database schema approach (see below)          │
│                                                                       │
│  [View Full Log]                                           [Pause]    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

**When Escalation is Needed:**

```
┌─ HOMЯ NEEDS YOUR INPUT ──────────────────────────────────────────────┐
│                                                                       │
│  While working on "User Authentication", I discovered two valid       │
│  approaches and need your preference:                                 │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Option A: JWT with refresh tokens                              │ │
│  │  • Stateless, scalable                                          │ │
│  │  • More complex client-side logic                               │ │
│  │  • Industry standard for SPAs                                    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Option B: Session-based with cookies                           │ │
│  │  • Simpler implementation                                       │ │
│  │  • Requires server-side session storage                         │ │
│  │  • Better for traditional web apps                              │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  Tasks #4, #5, #6 are paused pending this decision.                  │
│                                                                       │
│  [Choose A]  [Choose B]  [Let me think...]                           │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### What the User Doesn't See

- Raw observation logs (summarized)
- Every minor steering adjustment (aggregated)
- Internal HOMЯ reasoning (unless they drill in)

The goal is **confidence without noise**.

---

## Naming Rationale

**HOMЯ** (pronounced "Homer") evokes:

- **Home** - The central place everything returns to
- **Homing** - Keeping things on course, returning to target
- **The reversed Я** - A nod to doing things differently, seeing things from another angle

The **Protocol** suffix emphasizes that this is a systematic approach, not just another agent.

---

## Open Questions

~~To be resolved during design/implementation:~~

1. ~~**Observation Frequency** - After every task? On a timer? Both?~~
   **Resolved:** After every task completion. HOMЯ observes when a Ralph worker completes a task.

2. ~~**Context Window** - How much context does HOMЯ maintain before compacting?~~
   **Resolved:** Default 50 discoveries max. Context compaction runs automatically via `compactContext()`.

3. ~~**Steering Limits** - What changes can HOMЯ make autonomously vs. needing approval?~~
   **Resolved:** HOMЯ can autonomously: inject context, create corrective tasks for high-severity drift, update task priorities. It escalates when ambiguity is detected.

4. **Escalation Channels** - UI only? Push notifications? Telegram?
   **Partially Resolved:** UI-based escalation alerts are implemented. Telegram/push notifications are future work.

5. ~~**Learning Persistence** - Do HOMЯ learnings persist across outcomes or reset?~~
   **Resolved:** Learnings are per-outcome only. Cross-outcome learning is out of scope for now.

---

## Implementation Roadmap

### Phase 1: Foundation - COMPLETE
- [x] Context storage and management (`lib/db/homr.ts`)
- [x] Basic observation after task completion (`lib/homr/observer.ts`)
- [x] Discovery extraction

### Phase 2: Steering - COMPLETE
- [x] Task modification based on observations (`lib/homr/steerer.ts`)
- [x] Context injection into pending tasks
- [x] Cross-task discovery sharing

### Phase 3: Escalation - COMPLETE
- [x] Ambiguity detection (pattern-based + semantic)
- [x] Structured question generation
- [x] Work pausing and resumption (`lib/homr/escalator.ts`)

### Phase 4: Integration - COMPLETE
- [x] UI components for HOMЯ status (`app/components/homr/`)
- [x] API endpoints for escalation management
- [x] Full logging and activity tracking

### Phase 4.5: Self-Improvement Loop - COMPLETE
- [x] Escalation pattern analysis (`lib/agents/improvement-analyzer.ts`)
- [x] Cluster identification by root cause
- [x] Improvement outcome generation from clusters
- [x] Escalation incorporation tracking (prevents re-analysis)
- [x] Supervisor page with "Analyze & Improve" workflow

### Phase 4.6: Auto-Resolve & Proactive Decomposition - COMPLETE
- [x] Auto-resolve mode for escalations (`lib/homr/auto-resolver.ts`)
  - Manual, Semi-Auto, and Full-Auto modes
  - Configurable confidence threshold (default 80%)
  - Heuristic-based resolution for complexity escalations
  - Claude-based resolution for complex cases
- [x] Auto-spawn worker after resolution
  - Automatically starts a worker when auto-resolve makes a decision
  - Enables truly hands-off operation
- [x] Proactive bulk task decomposition (`lib/agents/bulk-detector.ts`)
  - Detects bulk data patterns at task creation time
  - Auto-decomposes large tasks before workers see them
  - `createTaskWithBulkCheck()` wrapper in `lib/db/tasks.ts`
- [x] Verification task generation
  - Every decomposed task gets an auto-generated verification subtask
  - Verification depends on all other subtasks
  - Ensures decomposed work units are properly validated
- [x] UI notifications for auto-resolved decisions
  - Toast notifications when auto-resolve applies a decision
  - Real-time feedback on autonomous decisions

### Phase 5: Intelligence - FUTURE
- [ ] Pattern learning across outcomes
- [ ] Proactive suggestions
- [ ] Autonomous steering refinement

---

*The HOMЯ Protocol transforms our system from a collection of independent workers into a coordinated workforce with shared intelligence and human-aligned judgment.*
