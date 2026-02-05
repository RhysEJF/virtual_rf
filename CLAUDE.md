# Digital Twin

> Personal AI workforce management system

## Overview

This codebase is the Digital Twin system - an AI-powered personal assistant that routes requests, spawns AI workers, and self-improves over time.

## Documentation

| Document | Purpose |
|----------|---------|
| **[docs/vision/README.md](./docs/vision/README.md)** | **Start here** - Index of modular vision docs |
| [docs/vision/*.md](./docs/vision/) | Per-module documentation (Dispatcher, Worker, Skills, etc.) |
| [docs/homr/VISION.md](./docs/homr/VISION.md) | HOMЯ Protocol - Intelligent orchestration layer above Ralph |
| [docs/homr/DESIGN.md](./docs/homr/DESIGN.md) | HOMЯ Protocol - Technical architecture |
| [docs/IDEAS.md](./docs/IDEAS.md) | Future improvement ideas |
| [VISION.md](./VISION.md) | Original vision (historical reference) |
| [DESIGN.md](./DESIGN.md) | Original design spec (historical reference) |

**When working on a specific module**, read its vision doc first (e.g., `docs/vision/WORKER.md` before changing `lib/ralph/worker.ts`).

**After making changes**, run `/update-docs` or ask Claude to update the relevant vision docs. See `skills/update-docs.md` for the process.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5.x (strict mode)
- **Styling**: Tailwind CSS (earthy matte theme)
- **Database**: SQLite via better-sqlite3
- **AI**: Claude Code CLI (uses existing subscription, no API costs)
- **Validation**: Zod

## Project Structure

```
virtual_rf/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Dashboard
│   ├── outcome/[id]/      # Outcome detail & management
│   ├── worker/[id]/       # Worker drill-down & logs
│   ├── skills/            # Skills library (global + outcome)
│   ├── components/        # React components
│   │   ├── ui/            # Base UI components (Card, Badge, Button, etc.)
│   │   ├── SkillsSection.tsx
│   │   ├── IterateSection.tsx
│   │   ├── OutputsSection.tsx
│   │   ├── ProgressView.tsx
│   │   └── ...
│   └── api/               # API routes
│       ├── outcomes/      # Outcome CRUD & actions
│       ├── workers/       # Worker management
│       ├── skills/        # Skills APIs (global + outcome)
│       └── dispatch/      # Request dispatcher
├── lib/
│   ├── agents/            # AI agent implementations
│   │   ├── dispatcher.ts
│   │   ├── briefer.ts
│   │   ├── orchestrator.ts
│   │   ├── capability-planner.ts
│   │   ├── skill-builder.ts
│   │   ├── tool-builder.ts
│   │   └── reviewer.ts
│   ├── ralph/             # Ralph worker system
│   ├── db/                # Database layer (SQLite)
│   ├── claude/            # Claude CLI client
│   ├── workspace/         # Workspace utilities
│   └── utils/             # Utilities
├── skills/                # Global skill library (markdown files)
├── workspaces/            # Outcome workspaces (created at runtime)
│   └── out_{id}/          # Each outcome gets a workspace
│       ├── skills/        # Outcome-specific skills
│       ├── tools/         # Outcome-specific tools
│       └── task_{id}/     # Task working directories
├── data/                  # SQLite database
├── VISION.md              # System vision document
└── CLAUDE.md              # This file
```

## Commands

```bash
# Development
npm run dev          # Start dev server (localhost:3000)

# Quality
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run build        # Production build

# Database
# DB auto-initializes on first access
```

## Coding Standards

### TypeScript
- Strict mode enabled
- No `any` types - use `unknown` or proper typing
- All functions have explicit return types
- Use interfaces for object shapes
- Use Zod for runtime validation

### Code Style
- Use `const` by default, `let` when needed, never `var`
- Prefer arrow functions for callbacks
- Use async/await over .then() chains
- Maximum function length: 50 lines
- Prefer early returns over nested conditionals

### Components
- Functional components with TypeScript
- Props interface defined above component
- Use semantic HTML elements
- Keep components focused and small

### File Naming
- Components: PascalCase (`CommandBar.tsx`)
- Utilities: camelCase (`formatCost.ts`)
- Types: PascalCase (`Project.ts`)
- API routes: lowercase (`route.ts`)

## Git Workflow

### Commit Messages
Format: `type(scope): description`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding tests
- `docs`: Documentation
- `chore`: Maintenance

Examples:
- `feat(dispatcher): add classification logic`
- `fix(worker): handle timeout correctly`
- `refactor(db): simplify project queries`

### Before Committing
1. `npm run typecheck` - must pass
2. `npm run lint` - must pass
3. Test the feature manually

## Critical Rules

**DO NOT:**
- Skip type checking before commit
- Use `any` type without justification
- Commit API keys or secrets
- Force push to main branch
- Ignore error handling

**ALWAYS:**
- Run type check before committing
- Handle errors gracefully
- Use proper TypeScript types
- Keep functions focused
- Write self-documenting code

## Key Concepts

### Outcomes
The core unit of work. An outcome represents something the user wants to achieve:
- Has an **intent** (what) - structured PRD with items and success criteria
- Has an **approach** (how) - design doc describing implementation
- Contains **tasks** generated from the intent
- Can have **workers** executing tasks
- Tracks **capability_ready** status (0=needed, 1=building, 2=ready)

### Two-Phase Orchestration
Work happens in two phases:
1. **Capability Phase**: Build skills and tools the workers will need
2. **Execution Phase**: Workers use the skills/tools to complete actual tasks

### Ralph Worker
Autonomous development loop that:
1. Claims a pending task from the outcome
2. Creates workspace with CLAUDE.md instructions
3. Spawns `claude --dangerously-skip-permissions` process
4. Monitors progress.txt for completion signal
5. Records full output for auditing
6. Repeats until no pending tasks or paused

PID is tracked in database for reliable pause/stop.

### Skills (Two Types)
1. **Global Skills** (`/skills/`): Shared across all outcomes, DB-tracked
2. **Outcome Skills** (`/workspaces/{id}/skills/`): Built during capability phase, specific to that outcome

Skills are markdown files with instructions that get injected into worker context.

### Review Cycles
After workers complete, the Reviewer agent:
1. Checks if success criteria are met
2. Creates new tasks for any issues found
3. Tracks convergence (consecutive clean reviews)

### Iterate
Users can request changes after completion via the Iterate section:
- Describe bugs or desired changes
- System converts feedback to tasks via Claude
- Optionally auto-starts a worker

## Database Tables

- `outcomes` - Outcomes with intent, design_doc, git config, save targets
- `tasks` - Tasks belonging to outcomes (pending/claimed/running/completed/failed)
- `workers` - Ralph worker instances with PID tracking
- `progress_entries` - Episodic memory of worker iterations (full_output capture)
- `review_cycles` - Review history with issues found and convergence tracking
- `skills` - Registered global skills from skills/ directory
- `interventions` - Human instructions sent to workers
- `supervisor_alerts` - System alerts for stuck workers, failures, etc.
- `repositories` - External git repos for syncing (private/team)
- `outcome_items` - Tracked files with sync status (skills, tools, outputs)
- `homr_*` - HOMЯ Protocol tables (context, observations, escalations, activity)
- `guard_blocks` - Blocked dangerous commands with context
- `system_config` - Key-value store for global settings (e.g., default_isolation_mode)

## Requirements

- **Claude Code CLI** must be installed and in PATH
- No API key needed - uses your existing Claude subscription

```bash
# Verify Claude CLI is available
claude --version
```

## Troubleshooting

**TypeScript errors after changes:**
```bash
rm -rf .next
npm run typecheck
```

**Database issues:**
```bash
rm data/twin.db
# DB will auto-recreate on next access
```

**Port already in use:**
```bash
lsof -i :3000
kill -9 <PID>
```

## Current Progress (Updated 2026-02-05)

### Core System (Complete)
- [x] Project setup (Next.js 14, TypeScript, Tailwind)
- [x] Database schema and CRUD operations (SQLite)
- [x] UI shell: Dashboard, CommandBar, SystemStatus, ThemeToggle
- [x] Light/dark theme with earthy green-beige colors
- [x] Claude CLI wrapper (`lib/claude/client.ts`)

### Outcome Management (Complete)
- [x] Outcome-based architecture (replaced "projects" with "outcomes")
- [x] Outcome detail page (`/outcome/[id]`) with full management UI
- [x] Intent optimization - ramble box → structured PRD via Claude
- [x] Approach optimization - ramble box → design doc via Claude
- [x] Task generation from intent
- [x] Git integration configuration (workspace, branches, auto-commit, PR creation)

### Worker System (Complete)
- [x] Ralph Worker - autonomous Claude CLI processes
- [x] Worker drill-down page (`/worker/[id]`) with log viewer
- [x] PID tracking for proper pause/stop (kills actual processes)
- [x] Progress tracking with episodic memory (ProgressView component)
- [x] Intervention system - send instructions to running workers
- [x] Full output capture for iteration auditing

### Two-Phase Orchestration (Complete)
- [x] Capability phase → Execution phase workflow
- [x] Capability planner (`lib/agents/capability-planner.ts`)
- [x] Skill builder - creates markdown skill files in workspaces
- [x] Tool builder - creates TypeScript CLI tools in workspaces
- [x] Automatic phase transition when capabilities ready

### Dynamic Capability Planning (Complete)
- [x] Capability detection from approach text (6 pattern strategies)
- [x] `required_capabilities` field on tasks for dependency declaration
- [x] Capability dependency checking at task claim time
- [x] Dynamic capability task creation when execution blocked
- [x] CapabilitySuggestionBanner UI after approach optimization
- [x] Manual replanning endpoint (`/api/outcomes/[id]/capabilities/replan`)
- [x] Deduplication to prevent duplicate capability tasks

### Skills System (Complete)
- [x] Global skills library (`/skills` directory, DB-tracked)
- [x] Outcome-specific skills (`workspaces/{outcomeId}/skills/`)
- [x] Skills Library page (`/skills`) with Global/Outcome tabs
- [x] SkillsSection component on outcome detail page
- [x] Skill content viewer with click-to-expand

### Review & Iteration (Complete)
- [x] Review cycle system with convergence tracking
- [x] Reviewer agent creates tasks from issues found
- [x] Iterate feature - post-completion feedback form
- [x] Feedback → tasks via Claude parsing
- [x] Auto-restart workers after iteration feedback

### Output Detection (Complete)
- [x] OutputsSection component - auto-detects deliverables
- [x] Finds HTML, images, PDFs, etc. in workspaces
- [x] Quick preview/open for completed work

### HOMЯ Protocol (Complete)
- [x] Context Store - Cross-task memory and learnings (`lib/db/homr.ts`)
- [x] Observer - AI analysis of task outputs (`lib/homr/observer.ts`)
- [x] Steerer - Task modification and context injection (`lib/homr/steerer.ts`)
- [x] Escalator - Ambiguity detection and human questions (`lib/homr/escalator.ts`)
- [x] Auto-Resolver - Automatic escalation resolution (`lib/homr/auto-resolver.ts`)
  - Manual, Semi-Auto, and Full-Auto modes with configurable confidence threshold
  - Worker auto-spawn after resolution for truly hands-off operation
- [x] Proactive bulk task decomposition (`lib/agents/bulk-detector.ts`)
  - Detects bulk data patterns at task creation time (50+ items threshold)
  - Auto-decomposes large tasks before workers see them
- [x] Verification task generation after decomposition
- [x] API endpoints for HOMЯ status, context, escalations (`app/api/outcomes/[id]/homr/`)
- [x] Auto-resolve config API (`app/api/outcomes/[id]/auto-resolve/`)
- [x] UI components: HomrStatusCard, EscalationAlert, ActivityLogDrawer (`app/components/homr/`)
- [x] HomrDashboard with auto-resolve settings and toast notifications
- [x] Integration with Ralph worker (observation after task completion)

### Repository Sync (Complete)
- [x] Save targets per content type (local/private/team)
- [x] Repository configuration in Settings (`app/settings/page.tsx`)
- [x] CommitSettingsSection for outcome defaults (`app/components/CommitSettingsSection.tsx`)
- [x] Sync status badges on skills/tools
- [x] Manual promotion UI (change save target per item)
- [x] Core sync logic with git operations (`lib/sync/repository-sync.ts`)
- [x] Repositories API (`app/api/repositories/`)
- [x] Items API (`app/api/outcomes/[id]/items/`)
- [x] ToolsSection component (`app/components/ToolsSection.tsx`)

### UI Layout Refactor (Complete)
- [x] Split panel layout for outcome detail page (40% context / 60% control tower)
- [x] CollapsibleSection component with localStorage persistence
- [x] OutcomeChat - unified conversation interface (merged command + iterate)
- [x] HOMЯ alerts always visible at top of right panel
- [x] Escalation dismiss API endpoint (`app/api/outcomes/[id]/homr/escalations/[escId]/dismiss/`)
- [x] Renamed "Save Targets" to "Commit Settings"
- [x] Resources page (`/resources`) - consolidated Skills, Tools, Documents, Files
- [x] Multi-outcome HOMЯ dashboard on main dashboard
- [x] Supervisor page (`/supervisor`) - escalation insights and trends
- [x] Editable task descriptions in ExpandableTaskCard

### Task Dependencies (Complete)
- [x] `depends_on` column on tasks table (JSON array of task IDs)
- [x] Dependency validation and circular dependency detection (`lib/db/dependencies.ts`)
- [x] UI shows blocked/blocking relationships in ExpandableTaskCard
- [x] Workers automatically skip blocked tasks when claiming
- [x] HOMЯ steerer can set dependencies when analyzing task relationships

### Self-Improvement Analytics (Complete)
- [x] Escalation insights API (`app/api/insights/escalations/`)
- [x] Escalation trends API (`app/api/insights/escalations/trends/`)
- [x] Improvement analyzer agent (`lib/agents/improvement-analyzer.ts`)
- [x] Improvement proposals API (`app/api/improvements/analyze/`)
- [x] EscalationInsights component with trends visualization
- [x] ImprovementPreviewModal for reviewing proposed outcomes
- [x] Create individual or consolidated improvement outcomes
- [x] Escalation incorporation tracking (prevents re-analyzing addressed escalations)
- [x] Supervisor page shows "X unaddressed / Y addressed" badges
- [x] Background analysis jobs (`lib/analysis/runner.ts`, `lib/db/analysis-jobs.ts`)
- [x] Analysis activity logging (analysis_started, analysis_completed, analysis_failed, improvement_created)
- [x] Actionable toast notifications with "View Results" buttons
- [x] ImprovementPreviewModal supports background polling and close-while-running

### Worker Resilience (Complete)
- [x] Circuit breaker pattern - auto-pause after consecutive failures (`lib/ralph/worker.ts`)
- [x] Task complexity estimation before claiming (`lib/agents/task-complexity-estimator.ts`)
- [x] Auto-decomposition for high-complexity tasks (`lib/agents/task-decomposer.ts`)
- [x] Failure pattern categorization (timeout, permission, syntax, runtime)
- [x] Turn limit risk assessment to prevent mid-task failures

### Destructive Command Guard (Complete)
- [x] Command validation before execution (`lib/guard/index.ts`)
- [x] Dangerous pattern detection (rm -rf, force push, etc.)
- [x] Workspace boundary enforcement
- [x] Guard blocks logged to database (`lib/db/guard-blocks.ts`)
- [x] Integration with Ralph worker execution

### Workspace Isolation & App Serving (Complete)
- [x] IsolationMode type (`'workspace' | 'codebase'`) in schema
- [x] System config table for global settings (`lib/db/system-config.ts`)
- [x] Per-outcome isolation mode with inheritance from system default
- [x] Worker workspace boundary enforcement in CLAUDE.md generation
- [x] IsolationModeSection UI component for per-outcome toggle
- [x] Settings page isolation mode default toggle
- [x] Config API (`/api/config`) for system settings
- [x] Workspace app detection (`lib/workspace/detector.ts`)
- [x] Port allocator for workspace servers (`lib/workspace/port-allocator.ts`, ports 3100-3199)
- [x] Multi-app server management (`lib/workspace/server-manager.ts`)
- [x] OutputsSection updated with Run/Stop buttons per detected app
- [x] CLI: `flow new --isolated` and `--allow-codebase` flags
- [x] CLI: `flow config isolation-mode` subcommand
- [x] CLI: `flow serve` command for workspace app management
- [x] Converse agent createOutcome tool accepts `isolation_mode` parameter

### CLI (Complete)
- [x] Basic command structure (`cli/`)
- [x] 36 commands implemented (full API coverage)
- [x] Outcome management: list, show, new, update, archive
- [x] Task management: tasks, task (add/update)
- [x] Worker management: start, stop, workers, worker, intervene, pause, resume, logs
- [x] HOMЯ integration: homr (--supervise, --yolo), escalations, answer, dismiss
- [x] Resources: skills, skill, tools, tool, outputs, files
- [x] Settings: config, sync, retro
- [x] Retro subcommands: `retro show`, `retro history`, `retro create` (with --consolidated, --start, --open)
- [x] Chat/iterate: chat
- [x] Workspace isolation: `new --isolated/--allow-codebase`, `config isolation-mode`
- [x] Workspace servers: `serve`, `serve start`, `serve stop`, `serve list`
- [x] Output flags: --json, --quiet on all commands
- [ ] Interactive mode (REPL)

### Converse Mode (Complete)
- [x] Conversational REPL (`flow converse`, `flow talk`)
- [x] Markdown rendering in responses
- [x] Session context tracking
- [x] 30+ tools for system interaction
- [x] Retro tools: triggerRetroAnalysis, getRetroJobStatus, getRetroJobDetails, listRecentRetroJobs, createFromRetroProposal

### Working Flow
1. User submits request via CommandBar
2. Dispatcher classifies it → creates Outcome with intent
3. System generates tasks from intent
4. **Capability Phase**: Build skills/tools needed for the work
5. **Execution Phase**: Ralph Workers claim and complete tasks
6. **Review Phase**: Reviewer checks work, creates fix tasks if needed
7. **Iterate**: User can request changes even after completion

### Not Yet Built
- [ ] Research agent (for "research" classification)
- [ ] Agent messaging system (workers that talk to each other)
- [ ] Telegram bridge
- [ ] SSE for live progress updates (currently polls every 5s)
- [ ] Cross-outcome learning (HOMЯ discoveries shared between outcomes)
- [ ] Always-on deployment (Mac Mini + Cloudflare Tunnel)

### Key Files to Understand
- `lib/claude/client.ts` - CLI wrapper (stdin must be 'ignore')
- `lib/ralph/worker.ts` - Autonomous worker spawning with PID tracking
- `lib/agents/orchestrator.ts` - Two-phase orchestration controller
- `lib/agents/capability-planner.ts` - Analyzes outcomes, plans skills/tools
- `lib/agents/skill-builder.ts` - Builds markdown skills
- `lib/agents/reviewer.ts` - Reviews completed work, finds issues
- `lib/agents/improvement-analyzer.ts` - Analyzes escalation patterns, proposes improvements
- `lib/agents/task-decomposer.ts` - Task decomposition with verification task generation
- `lib/agents/bulk-detector.ts` - Proactive bulk data pattern detection
- `lib/analysis/runner.ts` - Background job execution for improvement analysis
- `lib/db/analysis-jobs.ts` - Analysis job CRUD operations
- `lib/homr/index.ts` - HOMЯ Protocol main exports (observe, steer, escalate)
- `lib/homr/observer.ts` - Task output analysis with Claude
- `lib/homr/escalator.ts` - Ambiguity detection and human escalation
- `lib/homr/auto-resolver.ts` - Automatic escalation resolution with worker auto-spawn
- `lib/db/repositories.ts` - Repository and item sync database operations
- `lib/db/dependencies.ts` - Task dependency validation and cycle detection
- `lib/sync/repository-sync.ts` - Core sync logic (copy, git add/commit/push)
- `app/outcome/[id]/page.tsx` - Main outcome management UI
- `app/api/outcomes/[id]/iterate/route.ts` - Post-completion feedback

## Agent Notes

When working on this codebase:

1. **Start** by reading VISION.md for full context
2. **Check** "Current Progress" section above for what's done/remaining
3. **Understand** before modifying
4. **Test** your changes locally
5. **Commit** with proper message format
