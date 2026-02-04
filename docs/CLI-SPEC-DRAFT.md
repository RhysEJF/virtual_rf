# CLI Primitives Spec - Working Draft

> Designed collaboratively. Last updated: 2026-02-03

---

## Design Principles

1. **Stateless CLI** - Every command requires explicit IDs. No session state.
2. **Telegram manages context** - The bot tracks "current outcome" and injects IDs.
3. **Scriptable first** - Human-friendly default, `--json` for machine parsing.
4. **Primitives, not framework** - Expose operations, let users compose.

---

## Command Groups

### OUTCOMES (~6 commands)

```bash
flow list                          # List all outcomes
flow show <id>                     # Outcome details (tasks, workers, status)
flow new "<ramble>"                # Create outcome from natural language
flow archive <id>                  # Archive an outcome
flow update <id> [--name] [--intent] [--approach]  # Update outcome fields
flow optimize <id> --intent        # Optimize ramble → structured PRD
flow optimize <id> --approach      # Optimize ramble → design doc
```

**Optimize workflow:**
```bash
# Ramble in, optimized out
flow new "I want to build something that lets me track my reading"
# Creates outcome with raw intent

flow optimize out_abc123 --intent
# Claude converts ramble → structured PRD with items and success criteria

flow optimize out_abc123 --approach
# Claude converts approach ramble → design doc
```

---

### TASKS (~4 commands)

```bash
flow tasks <outcome-id>            # List tasks for outcome
flow task <task-id>                # Show task details
flow task add <outcome-id> "<title>" [--description]  # Add task manually
flow task update <task-id> [--status] [--title] [--description]  # Update task
```

**Note:** Tasks are scoped to outcomes. No global task list (would be overwhelming).

---

### WORKERS (~5 commands)

```bash
flow start <outcome-id>            # Start a worker on outcome
flow stop <worker-id>              # Stop a specific worker
flow workers [--outcome=<id>]      # List workers (optionally filtered)
flow worker <id>                   # Worker details and recent activity
flow intervene <worker-id> "<msg>" # Send instruction to running worker
```

---

### HOMЯ (~4 commands)

```bash
flow homr <outcome-id>             # HOMЯ status for outcome (context, discoveries)
flow escalations [--outcome=<id>]  # List pending escalations
flow answer <escalation-id> "<choice>"  # Answer an escalation
flow dismiss <escalation-id>       # Dismiss without answering
```

---

### CHAT (~1 command)

```bash
flow chat <outcome-id> "<message>" # Send message to outcome (replaces iterate)
```

**What "chat" does:**
- If outcome is complete → becomes iteration feedback → creates tasks
- If outcome is active → becomes context/instruction for workers
- Always goes through dispatcher logic

**Future:** Interactive mode `flow chat <outcome-id>` without message opens REPL.

---

### RETRO (~2 commands)

```bash
flow retro <outcome-id>            # Trigger retrospective analysis
flow retro status                  # Show pending retros, insights
```

**What retro does:**
- Analyzes escalation patterns
- Proposes improvements
- Can create improvement outcomes

---

### RESOURCES (~8 commands)

```bash
# Skills
flow skills [--outcome=<id>]       # List skills (global or outcome-scoped)
flow skill <name-or-id>            # Show skill content

# Tools
flow tools [--outcome=<id>]        # List tools
flow tool <name-or-id>             # Show tool details

# Outputs
flow outputs <outcome-id>          # List detected outputs (HTML, images, etc.)

# Files
flow files <outcome-id>            # List all files in workspace
```

---

### SETTINGS (~3 commands)

```bash
flow config                        # Show current configuration
flow config set <key> <value>      # Set config value
flow sync <outcome-id> [--repo=<id>]  # Sync items to repository
flow status                        # System status (workers, alerts, queue)
```

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (for Telegram bot parsing) |
| `--quiet` | Minimal output (just IDs) |
| `--help` | Command help |

---

## Command Count

| Group | Commands |
|-------|----------|
| Outcomes | 6 |
| Tasks | 4 |
| Workers | 5 |
| HOMЯ | 4 |
| Chat | 1 |
| Retro | 2 |
| Resources | 8 |
| Settings | 4 |
| **Total** | **34** |

---

## Optimize Flow (Detail)

The "optimize" functionality mirrors the UI's ramble-to-structure pattern:

### Intent Optimization

```bash
# User rambles
flow new "I want something that tracks books I'm reading, maybe with notes, and shows me stats about my reading habits over time"

# System creates outcome with raw intent
# out_abc123 created

# User triggers optimization
flow optimize out_abc123 --intent

# Claude converts to structured PRD:
# - Items: Book tracking, Notes system, Reading stats dashboard
# - Success criteria: Can add books, Can add notes to books, Shows pages/week chart
```

### Approach Optimization

```bash
# User rambles about how
flow update out_abc123 --approach "probably use sqlite for the database, maybe a simple next.js app, nothing fancy"

# User triggers optimization
flow optimize out_abc123 --approach

# Claude converts to design doc:
# - Tech stack decisions
# - File structure
# - Key implementation notes
```

### Combined Flow

```bash
# One-liner for power users
flow new "track my reading" && flow optimize $(flow list --quiet | tail -1) --intent
```

---

## What's Already Done (from CLI.md)

| Command | Status |
|---------|--------|
| `flow status` | Complete |
| `flow list` | Complete |
| `flow show` | Complete |
| `flow new` | Complete |
| `flow start` | Complete |
| `flow stop` | Complete |

---

## Implementation Priority

### Phase 1: Core Optimize
- [ ] `flow optimize <id> --intent`
- [ ] `flow optimize <id> --approach`
- [ ] `flow update <id>` with field flags

### Phase 2: Task Management
- [ ] `flow tasks <outcome-id>`
- [ ] `flow task <id>`
- [ ] `flow task add`
- [ ] `flow task update`

### Phase 3: HOMЯ + Escalations
- [ ] `flow escalations`
- [ ] `flow answer`
- [ ] `flow dismiss`
- [ ] `flow homr <outcome-id>`

### Phase 4: Chat + Resources
- [ ] `flow chat <outcome-id> "<msg>"`
- [ ] `flow skills`, `flow skill`
- [ ] `flow tools`, `flow tool`
- [ ] `flow outputs`, `flow files`

### Phase 5: Retro + Settings
- [ ] `flow retro`
- [ ] `flow config`
- [ ] `flow sync`

---

## Open Questions

1. **Interactive chat mode** - `flow chat out_abc123` without message opens REPL?
2. **Bulk operations** - `flow start --all-pending`?
3. **Aliases** - `flow s` for status, `flow l` for list?

---

*This is a working draft. Review in UI, then create outcome to implement.*
