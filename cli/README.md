# RF CLI

Command-line inteflowace for the Digital Twin API. Manage outcomes and workers from your terminal.

## Installation

```bash
# From the cli directory
cd cli
npm install
npm run build
npm link  # Makes 'flow' command available globally
```

## Prerequisites

- Node.js 18+
- Digital Twin server running (`npm run dev` from the main project)

## Commands

### `flow status`

Shows system overview including supervisor status, alerts, and outcome statistics.

```bash
flow status
```

**Example output:**
```
Digital Twin Status
──────────────────────────────────────────────────

Supervisor
  Status: ● Running
  Check Interval: 5s

Alerts
  ✓ No active alerts

Outcomes
  Total: 3 (2 active)
  Tasks: 15 total, 8 completed, 4 pending
  Workers: 1 active

Active Outcomes
  • RF CLI Tool [5/8 tasks] (1 worker)
  • Documentation Update [3/3 tasks] ⟳
```

### `flow list`

Lists outcomes with optional status filter, displayed as a formatted table.

```bash
# List all non-archived outcomes
flow list

# Filter by status
flow list --status active
flow list --status dormant
flow list --status achieved

# Include archived outcomes
flow list --all
```

**Options:**
| Flag | Description |
|------|-------------|
| `-s, --status <status>` | Filter by status: `active`, `dormant`, `achieved`, `archived` |
| `--all` | Show all outcomes including archived |

**Example output:**
```
ID              NAME                            STATUS    TASKS
────────────────────────────────────────────────────────────────────────────────
out_gQ7CClmB4h5 RF CLI Tool                     active    5/8 (3 pending) ⚙ 1
out_abc123xyz   Documentation Update            active    3/3
out_def456uvw   API Refactoring                 dormant   0/4

3 outcomes
2 active, 1 worker running
```

### `flow show <id>`

Displays detailed information about a specific outcome.

```bash
# Basic usage
flow show out_gQ7CClmB4h5

# Show all tasks
flow show out_gQ7CClmB4h5 --tasks

# Show all workers
flow show out_gQ7CClmB4h5 --workers

# Show full intent text
flow show out_gQ7CClmB4h5 --intent

# Combine options
flow show out_gQ7CClmB4h5 --tasks --workers --intent
```

**Options:**
| Flag | Description |
|------|-------------|
| `--tasks` | Show full task list |
| `--workers` | Show all workers (not just active) |
| `--intent` | Show full intent text |

**Example output:**
```
RF CLI Tool
────────────────────────────────────────────────────────────────

Info
  ID:         out_gQ7CClmB4h5
  Status:     ● Active
  Capability: Ready
  Created:    2d ago
  Updated:    1h ago

Intent
  Build a command-line inteflowace that talks to the Digital Twin...
  (use --intent to see full text)

Tasks
  Total: 8 — 5 completed, 1 running, 2 pending

    • Set up CLI project structure completed
    • Implement flow status command completed
    • Implement flow list command completed
    ... and 5 more (use --tasks to see all)

Workers
  Total: 2 — 1 active

    • Ralph Worker 1738294800 ● Running (iter 3) → task_VSP9-XeS3ES4
      Writing CLI README with usage examples

Convergence
  ○ Not converging — 0/3 clean reviews
  Review cycles: 2
```

### `flow new [name]`

Creates a new outcome. Supports both interactive and non-interactive modes.

```bash
# Interactive mode (prompts for details)
flow new

# Quick creation with name only
flow new "Build user dashboard"

# Full non-interactive creation
flow new "Build user dashboard" \
  --brief "Create a dashboard showing user metrics and activity" \
  --timeline "1 week"

# Create as sub-outcome
flow new "API endpoints" --parent out_abc123

# With git integration
flow new "Feature branch work" \
  --directory /path/to/project \
  --git-mode branch \
  --base-branch main \
  --work-branch feature/new-thing \
  --auto-commit \
  --create-pr

# Force interactive mode even with name
flow new "Quick idea" --interactive
```

**Options:**
| Flag | Description |
|------|-------------|
| `-b, --brief <text>` | Detailed brief for the outcome |
| `-t, --timeline <timeline>` | Expected timeline (e.g., "2 days", "1 week") |
| `--ongoing` | Mark as an ongoing outcome (no end state) |
| `-p, --parent <id>` | Parent outcome ID for sub-outcomes |
| `-d, --directory <path>` | Working directory for the outcome |
| `--git-mode <mode>` | Git mode: `none`, `local`, `branch`, `worktree` |
| `--base-branch <branch>` | Base branch for git operations |
| `--work-branch <branch>` | Work branch name |
| `--auto-commit` | Enable automatic commits |
| `--create-pr` | Create PR on completion |
| `-i, --interactive` | Force interactive mode |

**Example output:**
```
✓ Outcome created successfully!

  ID:    out_xyz789abc
  Name:  Build user dashboard
  Brief: Create a dashboard showing user metrics and activity...
  Timeline: 1 week

View details: flow show out_xyz789abc
```

### `flow start <outcome-id>`

Starts a worker for an outcome.

```bash
# Start a worker
flow start out_gQ7CClmB4h5

# Start additional worker (parallel execution)
flow start out_gQ7CClmB4h5 --parallel

# Use git worktree for isolation
flow start out_gQ7CClmB4h5 --worktree

# Combine options
flow start out_gQ7CClmB4h5 --parallel --worktree
```

**Options:**
| Flag | Description |
|------|-------------|
| `-p, --parallel` | Allow starting even if another worker is running |
| `-w, --worktree` | Use git worktree for worker isolation |

**Example output:**
```
Starting worker for outcome out_gQ7CClmB4h5...

✓ Worker started successfully

  Worker ID: wrk_abc123xyz
  Message:   Worker started and claimed task
  Mode:      Parallel
  Isolation: Git Worktree

Use 'flow show out_gQ7CClmB4h5' to monitor progress
```

**Error handling:**
```
Warning: A worker is already running for this outcome

  Running worker: wrk_existing123
  Total running: 1

Use --parallel flag to start another worker
```

### `flow stop <worker-id>`

Stops (pauses) a running worker.

```bash
flow stop wrk_abc123xyz
```

**Example output:**
```
Stopping worker wrk_abc123xyz...

✓ Worker stopped successfully

  Worker ID: wrk_abc123xyz
  Name:      Ralph Worker 1738294800
  Status:    paused
  Iteration: 5
  Task:      task_VSP9-XeS3ES4

Use 'flow start out_gQ7CClmB4h5' to start a new worker
```

**Status handling:**
- Already paused: Shows warning with current status
- Already completed: Shows warning with completion status
- Already failed: Shows warning with failure status

### `flow task`

Manage individual tasks within outcomes.

```bash
# Show task details
flow task show task_abc123
flow task task_abc123  # Shorthand

# Add a new task
flow task add out_xyz789 "Implement login form"
flow task add out_xyz789 "Add validation" --description "Validate email and password fields"
flow task add out_xyz789 "Write tests" --priority 50 --depends-on task_abc123,task_def456

# Update a task
flow task update task_abc123 --status completed
flow task update task_abc123 --title "New title"
flow task update task_abc123 --priority 25
flow task update task_abc123 --depends-on task_xyz789  # Set dependencies
flow task update task_abc123 --depends-on ""           # Clear dependencies
flow task update task_abc123 --description "New description" --optimize  # Optimize via Claude
```

**Task Add Options:**
| Flag | Description |
|------|-------------|
| `--description <text>` | Task description |
| `--priority <n>` | Priority 1-100 (lower runs first, default 100) |
| `--depends-on <ids>` | Comma-separated task IDs this task depends on |

**Task Update Options:**
| Flag | Description |
|------|-------------|
| `--status <status>` | Set status: `pending`, `completed`, `failed` |
| `--title <text>` | Update title |
| `--description <text>` | Update description |
| `--priority <n>` | Set priority (1-100, lower runs first) |
| `--depends-on <ids>` | Set dependencies (comma-separated, or "" to clear) |
| `--optimize` | Optimize description via Claude |
| `--optimize-description` | Re-optimize existing description |

**Example output (show):**
```
Task: task_abc123
────────────────────────────────────────────────────────────

Title:       Create sessions database table
Status:      pending
Priority:    10
Phase:       execution
Outcome:     out_xyz789
Created:     5m ago

Dependencies:
  Blocked by: task_xyz (pending)
  Blocks:     task_def, task_ghi
```

## Common Workflows

### Create and start working on an outcome

```bash
# Create the outcome
flow new "Implement user authentication"

# View the details (tasks generated automatically)
flow show out_xyz789

# Start a worker
flow start out_xyz789

# Monitor progress
flow status
flow show out_xyz789
```

### Check system health

```bash
# Quick overview
flow status

# See all active outcomes
flow list --status active

# Check specific outcome in detail
flow show out_xyz789 --tasks --workers
```

### Manage workers

```bash
# Start a worker
flow start out_xyz789

# Start parallel worker
flow start out_xyz789 --parallel

# Stop a worker
flow stop wrk_abc123

# Check worker status
flow show out_xyz789 --workers
```

### Organize with sub-outcomes

```bash
# Create parent outcome
flow new "Q1 Goals"

# Create sub-outcomes
flow new "Launch feature X" --parent out_q1goals
flow new "Improve peflowormance" --parent out_q1goals

# View hierarchy
flow show out_q1goals
```

## Configuration

The CLI connects to `http://localhost:3000/api` by default. The API base URL is configured in the source code (`src/api.ts`).

## Error Messages

The CLI provides clear error messages for common issues:

| Error | Cause | Solution |
|-------|-------|----------|
| "Could not connect to Digital Twin API" | Server not running | Run `npm run dev` from main project |
| "Outcome not found" | Invalid outcome ID | Check ID with `flow list` |
| "Worker not found" | Invalid worker ID | Check ID with `flow show <outcome-id>` |
| "A worker is already running" | Worker conflict | Use `--parallel` flag |

## Development

```bash
# Build the CLI
npm run build

# Watch mode for development
npm run dev

# Type checking
npm run typecheck
```
