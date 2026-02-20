# Flow CLI — Workforce Management Skill

> Use this skill when a task is too big, too multi-step, or too long-running to handle in a single conversation. Flow is an AI workforce management system that breaks work into outcomes, generates tasks, and deploys autonomous AI workers to execute them.

---

## When To Use Flow

**Use Flow when:**
- The work has multiple steps that should run autonomously (build a tool, create content, research + produce)
- You want parallel workers executing different parts of a project
- The work needs review cycles, iteration, and quality checks
- You're building something that needs a design doc, task breakdown, and structured execution

**Handle directly when:**
- It's a quick question, one-off edit, simple script, or short conversation
- The whole task can be completed in this session without needing workers

---

## Prerequisites

Flow's server must be running on the same machine. If commands fail with connection errors:

```bash
# Check if server is running
curl -s http://localhost:3000/api/outcomes | head -c 100

# Start the server if needed (runs in background)
cd ~/flow && npm run dev &
```

---

## Core Workflow

The typical end-to-end flow for a new project:

```
1. Create outcome  →  2. Refine intent/approach  →  3. Start worker  →  4. Monitor  →  5. Review/Iterate
```

### Step 1: Create an Outcome

```bash
# Describe what you want to achieve — Flow classifies and creates it
flow new "Build an invoice tracking tool for freelancers with PDF export"

# For isolated workspace (won't touch main codebase)
flow new --isolated "Build a market research report on AI tutoring"
```

This returns an outcome ID (e.g., `out_abc123`). Use it in all subsequent commands.

### Step 2: Check and Refine

```bash
# See what was created
flow show out_abc123 --intent

# Optimize the intent (Flow uses AI to structure it into a proper PRD)
flow update out_abc123 --optimize-intent

# Optimize the approach (generates a design doc)
flow update out_abc123 --optimize-approach

# See generated tasks
flow tasks out_abc123
```

### Step 3: Start a Worker

```bash
# Start an autonomous worker — it claims tasks and executes them
flow start out_abc123

# Watch it work in real-time
flow logs <worker-id> -f

# For HOMR supervision (AI monitors quality, auto-resolves issues)
flow homr out_abc123 --supervise

# Full auto mode — AI resolves its own escalations
flow homr out_abc123 --yolo
```

### Step 4: Monitor Progress

```bash
# Quick status check
flow show out_abc123

# List workers and their status
flow workers --outcome out_abc123

# Deep dive into what a worker did on a specific iteration
flow inspect <worker-id> --latest

# Check for escalations (questions the AI needs answered)
flow escalations --outcome out_abc123
```

### Step 5: Review and Iterate

```bash
# Run a review against success criteria
flow review out_abc123

# Send feedback to create new tasks
flow chat out_abc123 "The PDF export needs a header with the company logo"

# Send feedback AND auto-start a worker to address it
flow chat out_abc123 "Add dark mode support" --start
```

---

## Command Quick Reference

### Outcomes
| Command | What it does |
|---------|-------------|
| `flow list` | List all outcomes |
| `flow show <id>` | Show outcome details |
| `flow new "<description>"` | Create new outcome |
| `flow update <id> --optimize-intent` | AI-optimize the intent/PRD |
| `flow update <id> --optimize-approach` | AI-generate design doc |
| `flow archive <id>` | Archive completed outcome |

### Tasks
| Command | What it does |
|---------|-------------|
| `flow tasks <outcome-id>` | List tasks |
| `flow task <task-id>` | Show task details |
| `flow task add <outcome-id> "title"` | Add a task manually |
| `flow task update <id> --status completed` | Mark task done |

### Workers
| Command | What it does |
|---------|-------------|
| `flow start <outcome-id>` | Start a worker |
| `flow stop <worker-id>` | Stop a worker |
| `flow pause <outcome-id>` | Pause all workers |
| `flow resume <outcome-id>` | Resume work |
| `flow logs <worker-id> -f` | Follow worker logs live |
| `flow inspect <worker-id> --latest` | See last iteration details |
| `flow intervene <worker-id> "message"` | Send instruction to worker |

### HOMR (Supervision)
| Command | What it does |
|---------|-------------|
| `flow homr <outcome-id> --supervise` | Live supervision mode |
| `flow homr <outcome-id> --yolo` | Full auto mode |
| `flow escalations` | List pending questions |
| `flow answer <esc-id> <choice>` | Answer an escalation |
| `flow dismiss <esc-id>` | Dismiss an escalation |

### Resources
| Command | What it does |
|---------|-------------|
| `flow skills` | List available skills |
| `flow tools --outcome <id>` | List outcome tools |
| `flow outputs <outcome-id>` | List deliverables/files |
| `flow files <outcome-id>` | List all workspace files |

### Self-Improvement
| Command | What it does |
|---------|-------------|
| `flow review <outcome-id>` | Run quality review |
| `flow retro <outcome-id>` | Trigger retrospective analysis |
| `flow retro show <job-id>` | See improvement proposals |
| `flow retro create <job-id>` | Create outcome from proposals |

---

## Common Patterns

### Quick autonomous run (hands-off)
```bash
flow new --isolated "Research competitor pricing for AI writing tools"
# note the outcome ID from output
flow update out_xxx --optimize-intent
flow update out_xxx --optimize-approach
flow start out_xxx
flow homr out_xxx --yolo
```

### Monitor and intervene
```bash
flow logs wrk_xxx -f -v          # Watch with quality scores
flow intervene wrk_xxx "Focus on the API integration first, skip the UI for now"
```

### Check what was built
```bash
flow outputs out_xxx             # See deliverables
flow files out_xxx               # See all files in workspace
flow serve start out_xxx         # Start the app if it's a web project
```

### Iterate after completion
```bash
flow chat out_xxx "The report is missing a section on market size" --start
```

---

## Output Flags

All commands support:
- `--json` — structured JSON output (useful for parsing)
- `--quiet` — minimal output (IDs only)
