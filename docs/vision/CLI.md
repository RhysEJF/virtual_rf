# CLI

> Terminal interface for managing Digital Twin from the command line.

---

## Purpose

The RF CLI (`rf` command) provides terminal-based access to Digital Twin. It enables:

1. **Quick status checks** - See system health, active outcomes, alerts
2. **Outcome management** - Create, view, and monitor outcomes
3. **Worker control** - Start, stop, and monitor workers
4. **Scripting** - Automate Digital Twin operations from scripts

The CLI talks to the same API as the web UI, providing an alternative interface for users who prefer terminal workflows.

---

## Status

| Capability | Status |
|------------|--------|
| System status (`rf status`) | Complete |
| List outcomes (`rf list`) | Complete |
| Show outcome details (`rf show`) | Complete |
| Create outcomes (`rf new`) | Complete |
| Start workers (`rf start`) | Complete |
| Stop workers (`rf stop`) | Complete |
| Interactive prompts | Complete |
| Error handling | Complete |

**Overall:** Complete and production-ready (6 commands)

---

## Key Concepts

### Commands

| Command | Purpose |
|---------|---------|
| `rf status` | System overview - supervisor, alerts, outcome stats |
| `rf list` | List outcomes with optional status filter |
| `rf show <id>` | Detailed view of a specific outcome |
| `rf new [name]` | Create new outcome (interactive or flags) |
| `rf start <id>` | Start a worker for an outcome |
| `rf stop <id>` | Stop (pause) a running worker |

### Architecture

The CLI is a standalone Node.js package that:
- Uses Commander.js for command parsing
- Uses Chalk for terminal styling
- Uses Inquirer for interactive prompts
- Calls the Digital Twin HTTP API (`localhost:3000/api`)

### Installation

```bash
cd cli
npm install && npm run build && npm link
```

After linking, `rf` is available globally in your terminal.

---

## Behaviors

1. **API-driven** - All operations go through the HTTP API (same as web UI)
2. **Graceful errors** - Clear messages when server is down or resources not found
3. **Interactive fallback** - Commands prompt for missing information
4. **Consistent styling** - Color-coded output (green=success, red=error, etc.)

---

## Success Criteria

- Can manage outcomes without opening a browser
- Commands provide clear, scannable output
- Errors explain what went wrong and how to fix it
- Works well in scripts and automation

---

## Open Questions

1. **Configuration** - Currently hardcoded to localhost:3000. Should support env vars or config file?

2. **Output formats** - Should support `--json` flag for machine-readable output?

3. **Shell completion** - Add bash/zsh completion scripts?

4. **Watch mode** - Add `rf watch <id>` to tail worker progress?

---

## Related

- **Design:** [CLI.md](../design/CLI.md) - Implementation details, file structure, API client
- **Vision:** [API.md](./API.md) - The HTTP API the CLI talks to
- **Skill:** [cli-patterns.md](/skills/cli-patterns.md) - Patterns for adding new commands
