# Refactor: Ready for Sharing

> Migration notes from 2026-02-18 — separating app code from user data so Flow can be shared without leaking personal information.

---

## What Changed

Renamed `~/virtual_rf/` → `~/flow/` and created `~/flow-data/` for private user data.

### Directory Structure
- **`~/flow/`** — App code (git repo, shareable)
- **`~/flow-data/`** — Private user data (never in git)

### What Moved to ~/flow-data/
| What | From (old) | To (new) |
|------|-----------|----------|
| Database | `~/virtual_rf/data/twin.db` | `~/flow-data/data/twin.db` |
| Workspaces (31 dirs) | `~/virtual_rf/workspaces/` | `~/flow-data/workspaces/` |
| User skills (5 files) | `~/virtual_rf/skills/` (mixed) | `~/flow-data/skills/` |
| Personal files (7 files) | `~/virtual_rf/` (root) | `~/flow-data/personal/` |

### Key Architecture Change
- `lib/config/paths.ts` centralizes all path resolution
- Checks `FLOW_DATA_HOME` env var → `~/flow-data/` default → `process.cwd()` fallback
- All hardcoded `process.cwd()` data paths were updated to use this module

### What Was Archived (not deleted)
- `Ralph/` → `archive/ralph-wiggum-method/`
- `VISION.md` → `archive/VISION.md`
- `DESIGN.md` → `archive/DESIGN.md`

### CLI
- Binary name: `flow` (was `rf` before rename)
- Must rebuild after directory moves: `cd ~/flow/cli && npm install && npm run build && npm link`

### Skills (Three Locations)
1. **App skills** (`~/flow/skills/`) — ship with app (converse-agent, update-docs, cli-patterns)
2. **User skills** (`~/flow-data/skills/`) — personal global library
3. **Outcome skills** (`~/flow-data/workspaces/{id}/skills/`) — per-outcome

### Files That Handle Paths
If paths break, check these files (all updated during migration):
- `lib/config/paths.ts` — central path resolution
- `lib/db/index.ts` — database path
- `lib/workspace/detector.ts` — workspaces root
- `lib/agents/skill-manager.ts` — skills directories
- `lib/converse/skill-loader.ts` — converse-agent.md path
- `lib/ralph/worker.ts` — workspace paths
- `lib/db/tasks.ts` — capability check workspace path
- `lib/utils/env-keys.ts` — .env.local path
- `lib/guard/patterns.ts` — guard regex for flow/flow-data paths
