# Flow - Setup Guide

> Complete guide to setting up Flow on a new machine.

**Last Updated:** 2026-02-04

---

## Prerequisites

### Required Software

| Software | Version | Purpose | Installation |
|----------|---------|---------|--------------|
| **Node.js** | 18+ | JavaScript runtime | `brew install node` or [nodejs.org](https://nodejs.org) |
| **npm** | 9+ | Package manager | Comes with Node.js |
| **Git** | 2.30+ | Version control | `brew install git` |
| **Claude Code CLI** | Latest | AI worker execution | See [Claude Code Setup](#claude-code-cli) |

### Optional (Recommended)

| Software | Version | Purpose | Installation |
|----------|---------|---------|--------------|
| **Ollama** | 0.15+ | Local embeddings for memory search | `brew install ollama` |

---

## Quick Start

```bash
# 1. Clone the repository
git clone <your-repo-url> flow
cd flow

# 2. Create the user data directory
# Flow stores all user data (database, workspaces, skills) in ~/flow-data/
# This MUST exist before first run, otherwise data goes into the repo directory
mkdir -p ~/flow-data/{data,workspaces,skills}

# 3. Install Node.js dependencies
npm install

# 4. Build the CLI
cd cli && npm install && npm run build && npm link && cd ..

# 5. Start the dev server (database auto-initializes on first run)
npm run dev

# 6. (Optional) Set up Ollama for vector search
brew install ollama
brew services start ollama
ollama pull nomic-embed-text

# 7. (Optional) Generate memory embeddings
npx tsx scripts/generate-embeddings.ts
```

---

## Detailed Installation

### 1. Node.js and npm

**macOS (Homebrew):**
```bash
brew install node
```

**Verify installation:**
```bash
node --version   # Should be 18+
npm --version    # Should be 9+
```

### 2. Clone Repository

```bash
git clone <your-repo-url> flow
cd flow
```

### 3. Create User Data Directory

Flow separates app code from user data. All runtime data (database, workspaces, skills) lives in `~/flow-data/`. **This directory must exist before first run** — otherwise the app falls back to storing data inside the repo directory.

```bash
mkdir -p ~/flow-data/{data,workspaces,skills}
```

| Subdirectory | Purpose |
|-------------|---------|
| `data/` | SQLite database (`twin.db`) — auto-created on first run |
| `workspaces/` | Runtime working directories for each outcome |
| `skills/` | Your personal global skill library |

### 4. Install Dependencies

```bash
# Main application
npm install

# CLI tool (optional but recommended)
cd cli
npm install
npm run build
npm link  # Makes 'flow' command available globally
cd ..
```

### 5. Claude Code CLI

The worker system requires the Claude Code CLI to be installed and authenticated.

**Installation:**
```bash
# Install via npm (if available)
npm install -g @anthropic-ai/claude-code

# Or download from Anthropic
# See: https://claude.ai/claude-code
```

**Verify installation:**
```bash
claude --version
```

**Authentication:**
- Claude Code uses your existing Claude subscription
- No API key needed - it authenticates via browser login
- Run `claude` once to complete authentication

### 6. Database Setup

The SQLite database auto-initializes on first access. No manual setup required.

**Database location:** `~/flow-data/data/twin.db`

**To reset the database:**
```bash
rm ~/flow-data/data/twin.db
# Database will recreate on next server start
```

### 7. Ollama Setup (Optional but Recommended)

Ollama enables vector similarity search for the Cross-Outcome Memory system.

**Install Ollama:**
```bash
brew install ollama
```

**Start Ollama service:**
```bash
brew services start ollama
```

**Pull the embedding model:**
```bash
ollama pull nomic-embed-text
```

**Verify Ollama is running:**
```bash
curl http://localhost:11434/api/tags
# Should return list of models including nomic-embed-text
```

**Generate embeddings for existing memories:**
```bash
npx tsx scripts/generate-embeddings.ts
```

---

## Running the Application

### Development Mode

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Production Build

```bash
npm run build
npm run start
```

---

## CLI Commands

After building and linking the CLI (`npm link` in the `cli/` directory):

```bash
# System status
flow status

# List outcomes
flow list

# Show outcome details
flow show <outcome-id>

# Start a worker
flow start <outcome-id>

# Live monitoring with auto-resolve
flow homr <outcome-id> --yolo
```

---

## Environment Variables

No environment variables are strictly required. Optional configuration:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Server port |
| `OLLAMA_HOST` | http://localhost:11434 | Ollama API endpoint |

---

## Directory Structure

```
flow/
├── app/                    # Next.js application
├── cli/                    # CLI tool (flow command)
├── data/                   # SQLite database
├── docs/                   # Documentation
├── lib/                    # Core libraries
│   ├── agents/            # AI agents (orchestrator, planner, etc.)
│   ├── db/                # Database operations
│   ├── embedding/         # Ollama embeddings & vector search
│   ├── homr/              # HOMЯ Protocol (observation, steering)
│   ├── memory/            # Cross-Outcome Memory service
│   ├── ralph/             # Worker execution system
│   └── sync/              # Repository sync
├── scripts/               # Utility scripts
│   ├── generate-embeddings.ts
│   └── migrate-discoveries-to-memories.ts
├── skills/                # Global skill library
└── workspaces/            # Outcome workspaces (runtime)
```

---

## Troubleshooting

### "Claude CLI not found"

Ensure Claude Code is installed and in your PATH:
```bash
which claude
claude --version
```

### "Cannot connect to Ollama"

Start the Ollama service:
```bash
brew services start ollama
# Or run manually:
ollama serve
```

### "Database locked"

Only one instance of the app should access the database. Kill any existing processes:
```bash
lsof -i :3000
kill -9 <PID>
```

### TypeScript errors after changes

Clean and rebuild:
```bash
rm -rf .next
npm run typecheck
```

### Memory search returns no results

1. Ensure memories exist: `sqlite3 ~/flow-data/data/twin.db "SELECT COUNT(*) FROM memories;"`
2. Ensure Ollama is running for vector search
3. Run embedding generation: `npx tsx scripts/generate-embeddings.ts`

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npx tsx scripts/generate-embeddings.ts` | Generate vector embeddings |
| `npx tsx scripts/migrate-discoveries-to-memories.ts` | Migrate HOMЯ discoveries to memory |

---

## Health Checks

### API Health
```bash
curl http://localhost:3000/api/supervisor/status
```

### Memory System Health
```bash
curl -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

### Ollama Health
```bash
curl http://localhost:11434/api/tags
```

---

## Dependencies Summary

### Runtime Dependencies

- Node.js 18+
- SQLite (bundled via better-sqlite3)
- Claude Code CLI (for workers)

### Optional Dependencies

- Ollama + nomic-embed-text (for vector search)
- Homebrew (for easy installation on macOS)

### npm Packages (installed via `npm install`)

See `package.json` for full list. Key dependencies:
- Next.js 14
- better-sqlite3
- Zod
- TypeScript

---

## Next Steps After Setup

1. **Create your first outcome:**
   - Visit `http://localhost:3000`
   - Use the command bar to describe what you want to build

2. **Start a worker:**
   - Click "Start Worker" on an outcome
   - Or use CLI: `flow start <outcome-id>`

3. **Monitor progress:**
   - Use the HOMЯ tab to watch worker progress
   - Or use CLI: `flow homr <outcome-id> --supervise`

---

*For more documentation, see [docs/vision/README.md](./vision/README.md)*
