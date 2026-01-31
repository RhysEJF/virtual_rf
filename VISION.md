# Digital Twin: Vision Document

> A personal AI workforce management system that compounds knowledge and capability over time.

---

> **NOTE FOR AI AGENTS AND DEVELOPERS**
>
> This document is the **original vision** written at project inception. It captures the philosophy and goals but may not reflect the current implementation.
>
> **For up-to-date documentation, see the modular vision docs:**
> - [docs/vision/README.md](./docs/vision/README.md) - Index of all modules
> - [docs/vision/DISPATCHER.md](./docs/vision/DISPATCHER.md) - Request routing
> - [docs/vision/ORCHESTRATION.md](./docs/vision/ORCHESTRATION.md) - Two-phase execution
> - [docs/vision/WORKER.md](./docs/vision/WORKER.md) - Ralph task execution
> - [docs/vision/SKILLS.md](./docs/vision/SKILLS.md) - Skill system
> - [docs/vision/REVIEW.md](./docs/vision/REVIEW.md) - Quality assurance
> - [docs/vision/SUPERVISOR.md](./docs/vision/SUPERVISOR.md) - Safety monitoring
> - [docs/vision/DATABASE.md](./docs/vision/DATABASE.md) - Data layer
> - [docs/vision/UI.md](./docs/vision/UI.md) - Frontend
> - [docs/vision/INTEGRATION.md](./docs/vision/INTEGRATION.md) - External systems
> - [docs/vision/ANALYTICS.md](./docs/vision/ANALYTICS.md) - Logging and improvement
>
> **When making changes:** Update the relevant modular doc in `docs/vision/`, not this file.

---

**Related Documents:**
- [DESIGN.md](./DESIGN.md) - Original detailed design (historical)
- [CLAUDE.md](./CLAUDE.md) - Project coding standards and current progress
- [docs/IDEAS.md](./docs/IDEAS.md) - Future improvement ideas

---

## Executive Summary

This system transforms messy human thoughts into executed outcomes through an AI workforce. It routes requests intelligently, builds and manages skills autonomously, spawns parallel AI workers for deep work, and continuously improves by identifying bottlenecks and automation opportunities.

The goal: **speak naturally, get work done, maintain oversight, compound capability.**

---

## Core Philosophy

### 1. Natural Input, Structured Execution
- Accept messy, incomplete human thoughts
- Ask clarifying questions when needed
- Transform into actionable briefs
- Execute with appropriate resources

### 2. AI Workforce, Not AI Tool
- Think hiring, not prompting
- Skills are like employee capabilities
- Workers (Ralph loops) are like team members
- Orchestrator is like a project manager
- Supervisor ensures quality and progress

### 3. Self-Improving System
- Track where human intervention is needed
- Identify patterns in bottlenecks
- Suggest skills to build
- Reduce friction over time

### 4. Oversight Without Micromanagement
- See all active projects at a glance
- Drill into any worker at any time
- Intervene when needed
- Get notified of blockers
- Trust the system to handle routine

---

## Target User

**Rhys** - A consultant/builder who:
- Works on multiple projects simultaneously
- Does market research, strategy, and product building
- Wants to delegate execution to AI
- Needs visibility into progress
- Values cost awareness
- Prefers voice/natural language input

---

## Work Types Supported

### 1. Quick Tasks
- Simple questions, one-shot responses
- No orchestration needed
- Immediate return

### 2. Research Tasks
- Market research, competitive analysis
- Trend detection, opportunity scanning
- Web search, data gathering, synthesis
- Can feed into briefs or stand alone

### 3. Deep Work (Brief → Execute)
- Strategy development
- Product building
- Marketing materials
- Requires briefing, planning, execution
- Spawns parallel workers when beneficial

---

## System Architecture

### Input Layer
```
┌─────────────────────────────────────────────────────────────┐
│                       INPUT LAYER                           │
│                                                             │
│   Local Frontend (Primary)          Telegram (Future)      │
│   • Voice via Wispr Flow            • Remote access        │
│   • Text input                      • Notifications        │
│   • Full project visibility         • Quick tasks          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Processing Layer
```
┌─────────────────────────────────────────────────────────────┐
│                     DISPATCHER                              │
│                 "Understand & Route"                        │
│                                                             │
│   • Parse messy human input                                 │
│   • Ask clarifying questions                                │
│   • Check existing skills                                   │
│   • Classify: Quick / Research / Deep                       │
│   • Estimate: time, cost, human-in-loop needs               │
│   • Route to appropriate handler                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐
    │   QUICK   │    │  BRIEFER  │    │ RESEARCH  │
    │   EXEC    │    │           │    │  AGENT    │
    │           │    │ → Spec    │    │           │
    │ One-shot  │    │ → Skills  │    │ Web/Data  │
    │ response  │    │ → Estimate│    │ Analysis  │
    └───────────┘    └─────┬─────┘    └───────────┘
                           │
                           ▼
                    ┌───────────┐
                    │   SKILL   │
                    │  MANAGER  │
                    │           │
                    │ • Library │
                    │ • Gaps    │
                    │ • Build   │
                    └─────┬─────┘
                          │
                          ▼
                   ┌────────────┐
                   │ORCHESTRATOR│
                   │            │
                   │ • Plan     │
                   │ • Spawn    │
                   │ • Monitor  │
                   │ • Report   │
                   └──────┬─────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐      ┌─────────┐      ┌─────────┐
   │ Ralph 1 │      │ Ralph 2 │      │ Ralph N │
   │         │      │         │      │         │
   │ Worker  │      │ Worker  │      │ Worker  │
   └─────────┘      └─────────┘      └─────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                   ┌────────────┐
                   │ SUPERVISOR │
                   │            │
                   │ • Watch    │
                   │ • Detect   │
                   │ • Escalate │
                   └────────────┘
```

### State Layer
```
┌─────────────────────────────────────────────────────────────┐
│                      STATE LAYER                            │
│                    (SQLite Local)                           │
│                                                             │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│   │ Projects │ │  Briefs  │ │  Skills  │ │Bottleneck│     │
│   │          │ │          │ │  Library │ │   Log    │     │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
│                                                             │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│   │   Cost   │ │  Worker  │ │Improvement│                  │
│   │   Log    │ │  States  │ │Suggestions│                  │
│   └──────────┘ └──────────┘ └──────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Self-Improvement Layer
```
┌─────────────────────────────────────────────────────────────┐
│               SELF-IMPROVEMENT ENGINE                       │
│                                                             │
│   Tracks:                                                   │
│   • Human-in-the-loop interventions                         │
│   • Repeated patterns                                       │
│   • Skill gaps causing delays                               │
│   • Cost inefficiencies                                     │
│                                                             │
│   Generates:                                                │
│   • "Suggested Skills to Build" queue                       │
│   • "Automation Opportunities" report                       │
│   • System health metrics                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Dispatcher

**Purpose:** Understand messy human input and route appropriately.

**Inputs:**
- Raw text/voice transcription
- Current system state (active projects, available skills)

**Outputs:**
- Clarifying questions (if needed)
- Routed request to: Quick Exec, Briefer, or Research Agent
- Classification: type, estimated effort, human-in-loop needs

**Behavior:**
```
IF input is ambiguous:
  Ask clarifying questions
  Wait for response

IF input is simple question/task:
  Route to Quick Exec

IF input requires research:
  Route to Research Agent
  Check if research feeds into larger brief

IF input requires building/creating:
  Route to Briefer
  Flag skill requirements
```

### 2. Quick Executor

**Purpose:** Handle simple, one-shot requests immediately.

**Examples:**
- "What time is it in Tokyo?"
- "Summarize this article"
- "Rename this variable to X"

**Implementation:** Direct Claude API call, no orchestration.

### 3. Research Agent

**Purpose:** Gather information, analyze data, produce insights.

**Capabilities:**
- Web search and synthesis
- Competitor analysis
- Trend detection
- Market sizing
- Opportunity scanning

**Outputs:**
- Markdown reports
- Data files (CSV, JSON)
- Summaries and recommendations

**Can be:**
- Standalone (user wants research output)
- Feeding into Briefer (research informs a larger project)

### 4. Briefer

**Purpose:** Transform request into actionable specification.

**Inputs:**
- Dispatcher-routed request
- Research findings (if applicable)
- User context

**Outputs:**
- Project brief (markdown)
- PRD structure (JSON) for workers
- Skill requirements (existing + gaps)
- Cost/time estimate
- Human-in-loop expectations

**Process:**
1. Expand request into full scope
2. Break into features/phases
3. Check skill library for coverage
4. Flag skill gaps → Skill Manager
5. Estimate resources
6. Request user approval

### 5. Skill Manager

**Purpose:** Maintain and grow the skill library.

**Responsibilities:**
- Store and organize skills
- Detect skill gaps from briefs
- Research best practices for new skills
- Build new skill files (SKILL.md + tools)
- Adapt existing skills for project needs
- Track skill usage and effectiveness

**Skill Structure:**
```
skills/
├── research/
│   ├── competitor-analysis/
│   │   ├── SKILL.md
│   │   └── tools/
│   │       └── scraper.py
│   └── trend-detection/
│       └── SKILL.md
├── strategy/
│   ├── positioning-matrix/
│   │   ├── SKILL.md
│   │   └── tools/
│   │       └── matrix-generator.py
│   └── gtm-planning/
│       └── SKILL.md
└── development/
    ├── nextjs-setup/
    │   └── SKILL.md
    └── api-design/
        └── SKILL.md
```

### 6. Orchestrator

**Purpose:** Manage project execution with parallel workers.

**Responsibilities:**
- Receive approved brief + skills
- Break spec into parallel workstreams
- Spawn Ralph workers for each stream
- Manage dependencies between streams
- Consolidate outputs
- Report progress to frontend
- Handle worker failures

**Worker Management:**
- Start/stop workers
- Pass context and PRD slices
- Collect status updates
- Coordinate shared resources (git, files)

### 7. Ralph Worker

**Purpose:** Execute PRD features autonomously.

**Based on:** Ralph Wiggum methodology with fixes from previous implementation.

**Key Fixes from Previous Attempt:**
- Use `--dangerously-skip-permissions` flag (not `--print`)
- Pass `-p` for prompt input
- Use `--allowedTools` for explicit permissions
- Proper iteration limit handling
- File-based context (git + progress.txt + PRD)

**Core Loop:**
```bash
for iteration in 1..MAX_ITERATIONS:
  1. Read PRD, progress.txt, CLAUDE.md
  2. Select ONE feature with passes: false
  3. Implement feature
  4. Verify: typecheck, test, lint
  5. Update PRD (passes: true if verified)
  6. Append to progress.txt
  7. Git commit
  8. Check completion signal
```

**Context Persistence:**
- PRD (prd.json) - source of truth for features
- Progress log (progress.txt) - episodic memory
- Git history - accumulated work
- CLAUDE.md - project rules and standards

### 8. Supervisor

**Purpose:** Watch workers, detect issues, escalate blockers.

**Implementation:** AI agent that periodically reads worker outputs.

**Checks (every 30s-2min):**
- Git log: Any commits recently?
- PRD status: Features completing?
- progress.txt: Blockers noted?
- Process status: Still running?

**Actions:**
- Stuck detected → Notify frontend
- Conflict detected → Coordinate workers
- Blocker detected → Escalate to user
- Completion detected → Consolidate and report

**Key Insight:** This is NOT system-level monitoring. It's another Claude instance reading the same files workers produce. Fully portable, no special permissions needed.

### 9. Self-Improvement Engine

**Purpose:** Learn from usage, suggest automations.

**Tracks:**
- Every human-in-the-loop intervention
- Reason for intervention
- Time spent on intervention
- Patterns across projects

**Generates:**
- Suggested skills to build (repeated manual work)
- Automation opportunities
- System bottleneck analysis

**Storage:**
- Bottleneck log table
- Intervention patterns
- Suggested improvements queue

---

## Frontend Specification

> **Detailed Mockups:** See [DESIGN.md](./DESIGN.md) for comprehensive UI mockups, interaction patterns, and design rationale including the PRD/Design Doc/Tasks separation model.

### Design Principles

**Aesthetic:**
- Minimalistic, not busy
- Matte, not shiny
- Earthy, not flashy
- Dark mode optimized for long sessions
- Flat color scheme
- High contrast for readability
- Calm, focused environment

**Color Palette (Earthy Matte):**
```
Background:    #1a1a1a (deep charcoal)
Surface:       #252525 (warm dark gray)
Border:        #333333 (soft separator)
Text Primary:  #e5e5e5 (warm white)
Text Secondary:#888888 (muted gray)
Accent:        #7c9a6c (sage green)
Warning:       #c9a959 (muted gold)
Error:         #a65d5d (dusty rose)
Success:       #5d8a6b (forest green)
```

### Screens

#### 1. Dashboard (Home)
- Command bar (voice/text input) - prominent
- Active projects list with status
- System health summary
- Recent activity
- Suggested improvements

#### 2. Project Detail
- Brief summary
- Active workers with progress
- Outputs generated
- Intervention input
- Pause/resume controls

#### 3. Worker Drill-Down
- PRD checklist with status
- Live log (tail -f style)
- Intervention input
- Quick actions (pause, skip, restart, kill)

#### 4. Skills Library
- Browse/filter skills
- Skill detail view
- Suggested skills to build
- Add/edit skills

#### 5. Settings
- API keys management
- Cost limits
- Notification preferences
- System configuration

### Interactions

**Command Bar:**
- Always visible, always ready
- Voice input via Wispr Flow integration
- Text fallback
- Context-aware (knows current view)

**Intervention:**
- Available at every level (project, worker)
- Text input appears on button click
- Submit → Dispatcher routes intervention
- Can: redirect, add context, pause, cancel

**Real-time Updates:**
- SSE from backend
- Progress bars update live
- Logs stream in real-time
- Notifications appear for blockers

---

## Technical Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Frontend | Next.js 14 (App Router) | Fast, local-first, good DX |
| Styling | Tailwind CSS | Rapid UI iteration |
| Database | SQLite (better-sqlite3) | No server, portable, simple |
| AI | Claude API (Anthropic SDK) | All agents use Claude |
| Process Mgmt | Node child_process | Spawn/manage Ralph workers |
| Real-time | Server-Sent Events | Simpler than WebSockets |
| Voice | Web Speech API + Wispr | Browser-native + existing tool |

### Project Structure
```
virtual_rf/
├── app/                    # Next.js app directory
│   ├── page.tsx           # Dashboard
│   ├── project/[id]/      # Project detail
│   ├── worker/[id]/       # Worker drill-down
│   ├── skills/            # Skills library
│   └── api/               # API routes
│       ├── dispatch/      # Dispatcher endpoint
│       ├── projects/      # Project CRUD
│       ├── workers/       # Worker management
│       └── sse/           # Real-time updates
├── lib/
│   ├── agents/            # AI agent implementations
│   │   ├── dispatcher.ts
│   │   ├── briefer.ts
│   │   ├── research.ts
│   │   ├── orchestrator.ts
│   │   ├── supervisor.ts
│   │   └── skill-manager.ts
│   ├── ralph/             # Ralph worker implementation
│   │   ├── worker.ts
│   │   ├── runner.ts
│   │   └── templates/
│   ├── db/                # Database layer
│   │   ├── schema.ts
│   │   ├── projects.ts
│   │   ├── skills.ts
│   │   └── logs.ts
│   └── utils/
├── skills/                # Skill library
│   ├── research/
│   ├── strategy/
│   └── development/
├── data/                  # SQLite database
│   └── twin.db
├── VISION.md             # This document
├── CLAUDE.md             # Project standards
└── package.json
```

---

## Learnings from Previous Ralph Implementation

### What Went Wrong

1. **CLI Flag Confusion**
   - Used `--print` (for context output) instead of `-p` (for prompt)
   - Missing `--dangerously-skip-permissions` for autonomy
   - Permissions in settings.json don't propagate to subprocess

2. **Permission Funnel Effect**
   - Each subprocess level reduces permissions
   - User Terminal → Bash → Claude CLI → Ralph = very restricted
   - Need explicit CLI flags to grant permissions

3. **Feature Complexity Mismatch**
   - Tried complex features (database, auth) that have 0% Ralph success
   - Should route complex work differently or break into smaller pieces

4. **System-Level Monitoring Overkill**
   - Built elaborate fs_usage/inotify monitoring
   - Simpler: another Claude reading the same files
   - AI-watching-AI is more portable and composable

### What We'll Do Differently

1. **Fixed Ralph Implementation**
   ```bash
   claude --dangerously-skip-permissions \
     -p "$PROMPT" \
     --allowedTools "Bash(*) Read(*) Write(*) Edit(*) Glob(*) Grep(*)"
   ```

2. **Supervisor as AI Agent**
   - No system calls
   - Reads git log, PRD, progress.txt
   - Another Claude instance with read-only perspective

3. **Skill-Aware Routing**
   - Dispatcher checks if we have skills for the work
   - Complex work gets broken down more
   - Skill gaps flagged before execution

4. **Hybrid Awareness**
   - Know when Ralph will struggle (database, auth, multi-file)
   - Route appropriately or flag for human awareness

---

## Implementation Phases

### Phase 1: Foundation
- Local frontend with command bar
- Dispatcher (classify and route)
- Quick Executor (one-shot responses)
- SQLite state layer
- Basic project tracking

### Phase 2: Deep Work Pipeline
- Briefer agent
- Single Ralph worker (fixed implementation)
- Orchestrator (single worker first)
- Progress reporting to frontend
- Basic intervention capability

### Phase 3: Intelligence
- Skill Manager
- Supervisor agent
- Multi-worker support
- Self-improvement engine (logging)

### Phase 4: Scale & Polish
- Parallel workers
- Telegram bridge
- Cost forecasting
- Automated skill building
- System refinements

---

## Success Metrics

### MVP Success (Phase 1-2)
- Can speak/type a request
- System clarifies if needed
- Quick tasks execute immediately
- Deep work creates brief, spawns worker
- Can see progress, intervene if needed

### Full System Success (Phase 3-4)
- Multiple projects running in parallel
- System builds its own skills
- Bottlenecks identified and surfaced
- Telegram access works
- Cost tracking accurate

### Long-term Success
- Rhys can manage an army of AI workers
- Human-in-the-loop decreases over time
- System compounds capability
- New project types handled without new code

---

## Information Architecture (Draft)

As the system scales to thousands of projects with external collaborators, work organization becomes critical. After exploring various patterns (strict hierarchies, PARA method, Gloat's multi-ontology graphs), we've identified two complementary approaches.

### Hybrid A: Explicit Outcomes + Flat Pool

**Primary workflow for web interface.**

**Core Concept:** User explicitly creates Outcomes (named goals), and everything else stays flat but tagged.

**Structure:**
```
Outcomes/
├── Launch ProductX MVP
│   ├── collaborators: [client@email.com]
│   ├── timeline: Q1 2025
│   ├── repos: [github.com/user/productx]
│   └── tagged items: [tasks, notes, files...]
├── Scale ConsultingY Revenue
│   ├── collaborators: []
│   ├── timeline: ongoing
│   └── tagged items: [research, strategy docs...]
└── Personal Knowledge Base
    └── tagged items: [notes, bookmarks...]

Pool/ (flat, everything tagged)
├── task: "Build landing page" → [Launch ProductX MVP]
├── task: "Research competitors" → [Launch ProductX MVP, Scale ConsultingY]
├── note: "Meeting notes Jan 15" → [Scale ConsultingY]
├── file: "market-analysis.pdf" → [Launch ProductX MVP]
└── note: "Random idea" → [] (untagged, personal)
```

**Key Properties:**
- **Outcomes are explicit:** User creates them with a name, optional timeline, optional collaborators
- **Everything else is flat:** Tasks, notes, files live in one pool
- **Multi-tagging:** Items can belong to multiple outcomes
- **GitHub integration:** Repos link to outcomes, not nested inside them
- **Collaboration:** Invite people to specific outcomes; they see only that outcome's tagged items
- **AI assists:** Suggests outcome tags, detects when item relates to multiple outcomes

**Why This Works:**
- Low overhead (create outcome when you know it's an outcome)
- Cross-cutting work is natural (research feeds multiple projects)
- Collaboration is explicit and auditable
- Scales well (outcomes are few, items are many)
- Search finds everything, tags provide context

### Hybrid B: Conversational Streams + Emergent Outcomes

**Evolution for Telegram interface.**

**Core Concept:** Conversation naturally creates "streams" that the AI names and organizes. Streams map to Outcomes.

**How It Works:**
```
User: "I need to research the enterprise SaaS market for a new product idea"
AI: Creates stream: "Enterprise SaaS Research"
    Tags: [potential outcome: New Product Launch?]

User: "What did we find about pricing models?"
AI: Continues in "Enterprise SaaS Research" stream

User: "This is going to be Project Neptune"
AI: Converts stream to Outcome: "Project Neptune"
    Moves all stream items under this outcome
```

**Key Properties:**
- **Streams emerge:** AI detects topic continuity, names streams automatically
- **User promotes:** "Make this an outcome" converts stream to explicit outcome
- **Context preserved:** Can reference "what we discussed about X" across sessions
- **Telegram-native:** Works with chat-based interaction pattern
- **Syncs with Hybrid A:** Outcomes from Telegram appear in web interface

**Stream Detection Heuristics:**
- Same topic across multiple messages
- References to previous context ("that idea", "the research")
- Client/project names mentioned
- Time proximity + topic similarity

**Why This Works:**
- Zero friction (just talk, AI organizes)
- Natural for mobile/async interaction
- Preserves conversational context
- Gradual formalization (stream → outcome when ready)

### Relationship Between A and B

```
┌─────────────────────────────────────────────────────────────┐
│                     WEB INTERFACE                           │
│                      (Hybrid A)                             │
│                                                             │
│   Explicit Outcomes → Flat Pool with Tags                   │
│   - Create outcomes intentionally                           │
│   - See full project dashboard                              │
│   - Manage collaborators                                    │
│   - Deep work execution                                     │
│                                                             │
└───────────────────────────┬─────────────────────────────────┘
                            │ sync
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   TELEGRAM INTERFACE                        │
│                      (Hybrid B)                             │
│                                                             │
│   Conversational Streams → Emergent Outcomes                │
│   - Talk naturally, AI organizes                            │
│   - Streams auto-detected                                   │
│   - Promote streams to outcomes                             │
│   - Quick tasks, status checks                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Sync Rules:**
- Outcomes created in web appear as named streams in Telegram
- Streams promoted to outcomes in Telegram appear in web
- Items tagged in either interface sync both ways
- Collaborator permissions from web apply to Telegram context

### Migration Path

This architecture supports future evolution:

1. **Start simple:** Hybrid A with flat pool, outcomes when needed
2. **Add Telegram:** Hybrid B streams naturally emerge
3. **Scale later:** If pods/teams needed, outcomes can group under Pods
4. **Never locked in:** Flat pool + tags means reorganization is just retagging

The key insight: **Outcomes are the stable unit of work organization.** How you get to outcomes (explicit creation vs conversational emergence) depends on the interface.

---

## Open Questions

1. **Worker Isolation:** Do parallel workers need separate git worktrees, or can they coordinate on one repo?

2. **Skill Format:** Use Claude's Agent Skills standard (SKILL.md) or custom format?

3. **Cost Limits:** Hard stop at budget, or warn and continue?

4. **Intervention Priority:** How does human input interrupt running workers?

5. **Research Tooling:** What APIs/tools for market research (Crunchbase, LinkedIn, etc.)?

---

## Appendix: File References

### Previous Implementation Files (Learnings Extracted)
- `Ralph/wiggumloop.md` - Full implementation files (had CLI bugs)
- `Ralph/ralph-failure-modes.md` - Detailed failure analysis
- `Ralph/ralph-setup-skill.md` - Setup process (monitoring overkill)
- `Ralph/research_findings.md` - Methodology overview
- `Ralph/settings.json` - Permission patterns

### Key Insight Files to Preserve
- Failure mode documentation (what works, what doesn't)
- Success rate data by feature type
- Permission inheritance analysis

---

*This document is the north star for the Digital Twin project. All implementation decisions should trace back to the vision and principles outlined here.*
