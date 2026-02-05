# CLI Vision Document

> The complete text inteflowace to Digital Twin - enabling scripting, automation, and serving as the foundation for conversational APIs.

**Related Documents:**
- [CONVERSATIONAL-API.md](./CONVERSATIONAL-API.md) - Telegram bridge built on CLI
- [../DESIGN.md](../DESIGN.md) - Overall system design
- [WORKER.md](./WORKER.md) - Ralph worker execution

---

## Executive Summary

The CLI is the **text API layer** of Digital Twin. Every operation the system supports should be accessible via a simple command. This enables:
- Power users to script workflows
- Automation of repetitive tasks
- Foundation for conversational inteflowaces (Telegram, Slack, etc.)
- Testing and debugging without the web UI

The architecture is: `Core System → CLI → Conversational Inteflowaces`

---

## The Problem: GUI-Only Limits Usage

### Current Friction

The web UI requires:
- Being at a computer with browser open
- Navigating through multiple pages
- Manual clicking for each operation
- No ability to script or automate

### What CLI Enables

| Without CLI | With CLI |
|-------------|----------|
| Open browser, navigate to outcome | `flow show outcome-123` |
| Click through to start worker | `flow start outcome-123` |
| Manually check status periodically | `watch flow status` |
| No automation possible | `flow new "build landing page" && flow start $(flow list --format=id | tail -1)` |

### The Key Insight

> **The CLI is not just a power-user tool - it's the API that conversational inteflowaces consume.**

A Telegram bot becomes trivial when you can:
```
User: "Start working on the landing page"
Bot: Runs `flow start $(flow list --name="landing page" --format=id)`
Bot: "Started worker for 'Landing Page'. Use /status to check progress."
```

---

## Current Status

| Capability | Status |
|------------|--------|
| System status (`flow status`) | Complete |
| List outcomes (`flow list`) | Complete |
| Show outcome details (`flow show`) | Complete |
| Create outcomes (`flow new`) | Complete |
| Start workers (`flow start`) | Complete |
| Stop workers (`flow stop`) | Complete |
| Interactive prompts | Complete |
| Error handling | Complete |
| Task management (`tasks`, `task`) | Complete |
| HOMЯ integration (`homr`, `escalations`, `answer`, `dismiss`) | Complete |
| Skill/tool management (`skills`, `skill`, `tools`, `tool`) | Complete |
| Worker management (`workers`, `worker`, `intervene`, `pause`, `resume`, `logs`) | Complete |
| Resource viewing (`files`, `outputs`) | Complete |
| Outcome updates (`update`, `archive`) | Complete |
| Chat/iterate (`chat`) | Complete |
| Retrospective (`retro`) | Complete |
| Configuration (`config`, `sync`) | Complete |
| Output format flags (`--json`, `--quiet`) | Complete |
| Supervise mode (`--supervise`, `--yolo` on homr) | Complete |
| Technical audit (`flow audit`) | Complete |
| Success criteria review (`flow review`) | Complete |
| Conversational REPL (`flow converse`, `flow talk`) | Complete |
| Capability management (`flow capability`, `skill new`, `tool new`) | Complete |
| Dev server (`flow server`) | Complete |
| Markdown rendering in REPL | Complete |
| Interactive chat mode | **Not started** |

**Current:** 35 commands implemented (full coverage)
**Target:** Interactive mode and additional polish

---

## Command Design Philosophy

### 1. Unix-Style Composability

Commands should:
- Do one thing well
- Output structured data when piped
- Accept input from stdin when appropriate
- Support `--format` flags (json, table, id-only)

```bash
# Get IDs only for scripting
flow list --format=id

# Chain commands
flow list --status=active --format=id | xargs -I {} flow show {}

# JSON for parsing
flow show outcome-123 --format=json | jq '.outcome.name'
```

### 2. Progressive Disclosure

Simple by default, poweflowul when needed:

```bash
# Simple
flow status

# Detailed
flow status --verbose

# Machine-readable
flow status --format=json
```

### 3. Consistent Patterns

All resource commands follow the same pattern:
```
flow <resource> <action> [id] [options]
```

Examples:
- `flow outcome list`
- `flow outcome show <id>`
- `flow task update <id> --status=completed`
- `flow skill list --global`

### 4. Aliases for Common Operations

Shortcuts for frequent actions:
```bash
flow new "..."        # alias for: flow dispatch --mode=long "..."
flow start <id>       # alias for: flow worker start --outcome=<id>
flow stop <id>        # alias for: flow worker stop <id>
```

---

## Command Structure

### Top-Level Commands (Quick Access)

| Command | Purpose | Status |
|---------|---------|--------|
| `flow status` | System overview | Done |
| `flow list` | List outcomes | Done |
| `flow show <id>` | Outcome details | Done |
| `flow new "<text>"` | Create via dispatch | Done |
| `flow start <id>` | Start worker | Done |
| `flow stop <id>` | Stop worker | Done |
| `flow chat <id> "<msg>"` | Send message/iterate | Done |
| `flow homr <id>` | HOMЯ status | Done |
| `flow chat` (interactive) | Interactive mode | Planned |

### Resource Commands (Full CRUD)

#### Outcomes
```bash
flow outcome list [--status=<s>] [--parent=<id>]        # Partially done via flow list
flow outcome show <id> [--tasks] [--workers] [--intent] # Partially done via flow show
flow outcome create --name="..." [--brief="..."]        # Done via flow new
flow outcome update <id> [--status=<s>] [--name="..."]  # Not started
flow outcome delete <id>                                # Not started
flow outcome iterate <id> --feedback="..."              # Not started
```

#### Tasks
```bash
flow task list <outcome-id> [--status=<s>] [--phase=<p>]
flow task show <id>
flow task add <outcome-id> --title="..." [--description="..."] [--priority=<n>]
flow task update <id> [--status=<s>] [--title="..."]
flow task delete <id>
```

#### Workers
```bash
flow worker list [--outcome=<id>] [--status=<s>]
flow worker show <id> [--logs] [--progress]
flow worker start <outcome-id> [--parallel] [--worktree]   # Done via flow start
flow worker stop <id>                                       # Done via flow stop
flow worker intervene <id> --message="..."
flow worker logs <id> [--tail=<n>] [--follow]
```

#### Skills
```bash
flow skill list [--global] [--outcome=<id>]
flow skill show <id-or-name>
flow skill new <name> [--category <cat>] [--description <desc>]  # Create skill template
flow skill create --name="..." --content="..."                   # Legacy
flow skill sync <id> --repo=<repo-id>
```

#### Tools
```bash
flow tool list [--outcome=<id>]
flow tool show <name>
flow tool new <name> --outcome <id> [--description <desc>]  # Create tool template
```

#### Capabilities (Unified)
```bash
flow capability detect <outcome-id>                         # Detect capabilities from approach
flow capability detect <outcome-id> --text "..."            # Detect from custom text
flow capability create <type> <name> --outcome <id>         # Create capability task
flow capability create skill my-skill --outcome out_xxx     # Example: create skill task
flow capability list [--outcome <id>]                       # List all capabilities
flow cap list                                               # Alias
```

#### HOMЯ (Orchestration)
```bash
flow homr <outcome-id>                    # HOMЯ status (Done)
flow homr <outcome-id> --supervise        # Live watch mode, polls every 5s (Done)
flow homr <outcome-id> --yolo             # Auto-resolve + supervise (Done)
flow escalations [--outcome=<id>]         # List pending escalations (Done)
flow answer <escalation-id> <choice>      # Answer escalation (Done)
flow dismiss <escalation-id>              # Dismiss escalation (Done)
```

**Supervise Mode Features:**
- Live polling every 5 seconds with clear screen refresh
- Task progress bar with percentage
- Active workers display
- "Just Completed" celebration when tasks finish
- Pending escalations count

**YOLO Mode:** Auto-resolves escalations using AI confidence scoring, shows decisions made

#### Validation & Review
```bash
flow audit [--path=<dir>]              # Run technical checks (typecheck, lint, tests)
flow audit --verbose                   # Show full output from each check
flow review <outcome-id>               # Check work against success criteria
flow review <outcome-id> --verbose     # Show detailed evidence for each criterion
flow review <outcome-id> --criteria-only  # Only evaluate criteria, no task creation
```

**Audit:** Detects project type (Node, Python, Go, Rust) and runs appropriate checks:
- TypeScript: `npm run typecheck`
- ESLint: `npm run lint`
- Tests: `npm run test`

**Review:** Triggers the Reviewer agent to check completed work against the success criteria defined in the outcome's intent. Creates fix tasks for any issues found.

#### Conversational Interface
```bash
flow converse                          # Start interactive REPL session
flow converse --session=<id>           # Resume existing session
```

**REPL Commands:**
- `/exit`, `/quit`, `/q` - Exit conversation
- `/clear [new]` - Clear screen (new = start fresh session)
- `/context` - Show current session context
- `/switch <outcome>` - Switch to different outcome
- `/help` - Show available commands

#### Git Operations
```bash
flow git status <outcome-id>
flow git commit <outcome-id> --message="..."
flow git pr <outcome-id> [--title="..."] [--draft]
```

#### System
```bash
flow supervisor status
flow supervisor alerts [--active] [--severity=<s>]
flow supervisor acknowledge <alert-id>
flow config show
flow config set <key> <value>
```

---

## Interactive Mode

For conversational use without Telegram:

```bash
$ flow chat

Digital Twin CLI v0.1.0
Type your request, or use commands like /status, /list, /help

> I want to build a landing page for my new product

Creating outcome: "Landing Page for New Product"
  ID: out_abc123
  Status: active

Would you like me to start a worker? (y/n): y

Worker started. Monitoring progress...
  [Task 1/5] Setting up project structure... done
  [Task 2/5] Creating header component... (running)

> /status

Active Outcomes: 1
  - Landing Page for New Product [2/5 tasks] (1 worker)

> add a contact form section

Added task: "Add contact form section"
  ID: tsk_def456
  Priority: 5

Worker will pick this up after current task.

> /quit
```

This mode:
- Maintains conversation context
- Allows natural language input
- Supports slash commands for direct actions
- Shows real-time progress

---

## Output Formats

### Table (Default)
```
$ flow list

ID              NAME                    STATUS     TASKS
out_abc123      Landing Page           active     2/5 (3 pending)
out_def456      API Integration        dormant    0/0
```

### JSON (For scripting)
```bash
$ flow list --format=json
{
  "outcomes": [
    {"id": "out_abc123", "name": "Landing Page", "status": "active", ...}
  ]
}
```

### IDs Only (For piping)
```bash
$ flow list --format=id
out_abc123
out_def456
```

### Quiet (For scripts)
```bash
$ flow new "build X" --quiet
out_abc123
```

---

## Configuration

### Config File
Location: `~/.flowconfig` or `$RF_CONFIG`

```yaml
api_url: http://localhost:3000/api
default_format: table
color: auto  # auto, always, never
editor: $EDITOR  # for multi-line input
```

### Environment Variables
```bash
RF_API_URL=http://localhost:3000/api
RF_FORMAT=json
RF_NO_COLOR=1
```

---

## Implementation Priority

### Phase 1: Core Commands (Complete)
- [x] `status` - System overview
- [x] `list` - List outcomes
- [x] `show` - Outcome details
- [x] `new` - Create via dispatch (with matched outcome integration)
- [x] `start` - Start worker
- [x] `stop` - Stop worker

### Phase 2: Output & Task Management (Complete)
- [x] Add `--json` and `--quiet` flags to all commands
- [x] `tasks <outcome-id>` - List tasks for outcome
- [x] `task <id>` - Show task details
- [x] `task add <outcome-id> "<title>"` - Add task manually
- [x] `task update <id> --status=<s>` - Update task

### Phase 3: Worker & HOMЯ (Complete)
- [x] `workers [--outcome=<id>]` - List workers
- [x] `worker <id>` - Worker details
- [x] `intervene <worker-id> "<msg>"` - Send instruction
- [x] `flow-pause <worker-id>` - Pause worker
- [x] `flow-resume <worker-id>` - Resume worker
- [x] `flow-logs <worker-id>` - View worker logs
- [x] `homr <outcome-id>` - HOMЯ status with discoveries/decisions
- [x] `homr <outcome-id> --supervise` - Live watch mode (5s polling)
- [x] `homr <outcome-id> --yolo` - Auto-resolve + supervise
- [x] `escalations [--outcome=<id>]` - List pending escalations
- [x] `answer <escalation-id> <choice>` - Answer escalation
- [x] `dismiss <escalation-id>` - Dismiss escalation

### Phase 4: Skills & Resources (Complete)
- [x] `skills [--outcome=<id>]` - List skills
- [x] `skill <name>` - Show skill content
- [x] `skill new <name>` - Create skill template
- [x] `tools [--outcome=<id>]` - List tools
- [x] `tool <name>` - Show tool details
- [x] `tool new <name> --outcome <id>` - Create tool template
- [x] `outputs <outcome-id>` - List detected outputs
- [x] `files <outcome-id>` - List workspace files
- [x] `capability detect <outcome-id>` - Detect capabilities from approach
- [x] `capability create <type> <name> --outcome <id>` - Create capability task
- [x] `capability list [--outcome <id>]` - List all capabilities

### Phase 5: Management (Complete)
- [x] `update <id> --name/--intent/--approach` - Update outcome
- [x] `archive <id>` - Archive outcome
- [x] `chat <outcome-id> "<msg>"` - Send message/iterate
- [x] `retro <outcome-id>` - Retrospective analysis
- [x] `config` - Show configuration
- [x] `sync <outcome-id>` - Sync to repository

### Phase 6: Interactive Mode (Not Started)
- [ ] `flow chat <outcome-id>` - Interactive REPL
- [ ] Natural language input handling
- [ ] Real-time progress streaming
- [ ] Session context persistence

---

## Technical Notes

### Current Implementation
- Framework: Commander.js
- Runtime: Node.js with tsx
- API Client: Fetch with typed wrappers (`cli/src/api.ts`)
- UI: Chalk for colors, Inquirer for prompts

### File Structure
```
cli/
├── src/
│   ├── index.ts          # Main entry, command registration
│   ├── api.ts            # Typed API client (~800 lines)
│   ├── commands/
│   │   ├── index.ts      # Export all commands
│   │   ├── status.ts     # System status
│   │   ├── list.ts       # List outcomes
│   │   ├── show.ts       # Show outcome details
│   │   ├── new.ts        # Create outcome (with matched outcome support)
│   │   ├── start.ts      # Start worker
│   │   ├── stop.ts       # Stop worker
│   │   ├── update.ts     # Update outcome fields
│   │   ├── archive.ts    # Archive outcome
│   │   ├── tasks.ts      # List tasks for outcome
│   │   ├── task.ts       # Show/update single task
│   │   ├── workers.ts    # List workers
│   │   ├── worker.ts     # Show worker details
│   │   ├── intervene.ts  # Send instruction to worker
│   │   ├── flow-pause.ts # Pause worker
│   │   ├── flow-resume.ts # Resume worker
│   │   ├── flow-logs.ts  # View worker logs
│   │   ├── homr.ts       # HOMЯ status (--supervise, --yolo)
│   │   ├── escalations.ts # List escalations
│   │   ├── answer.ts     # Answer escalation
│   │   ├── dismiss.ts    # Dismiss escalation
│   │   ├── chat.ts       # Send message/iterate
│   │   ├── skills.ts     # List skills
│   │   ├── skill.ts      # Show skill content
│   │   ├── tools.ts      # List tools
│   │   ├── tool.ts       # Show tool details
│   │   ├── outputs.ts    # List detected outputs
│   │   ├── files.ts      # List workspace files
│   │   ├── config.ts     # Configuration
│   │   ├── sync.ts       # Sync to repository
│   │   └── retro.ts      # Retrospective analysis
│   └── utils/
│       ├── index.ts      # Re-exports
│       └── flags.ts      # Shared output flags (--json, --quiet)
├── package.json
└── tsconfig.json
```

### Build & Install
```bash
cd cli
npm install
npm run build
npm link  # Makes 'flow' available globally
```

---

## Success Criteria

### CLI Completeness
- [x] All API endpoints have CLI equivalents
- [x] Every web UI action can be done via CLI
- [ ] `flow chat` provides conversational interface (interactive mode)

### Usability
- [x] New user can create outcome and start worker in < 2 minutes
- [x] Power users can script complex workflows
- [x] Output formats support automation needs (`--json`, `--quiet`)

### Foundation for Conversational API
- [x] Telegram bot can be implemented as thin wrapper
- [x] All commands return structured, parseable output
- [ ] Interactive mode proves conversational UX

### Special Features
- [x] `flow new` integrates with matched outcomes (add to existing or create new)
- [x] `flow homr --supervise` for live monitoring with task progress
- [x] `flow homr --yolo` for auto-resolve with AI confidence scoring
- [x] Visual feedback when tasks complete in supervise mode

---

*The CLI is not just a developer tool - it's the API that makes conversational interfaces possible. 30 commands implemented - only interactive mode remains.*
