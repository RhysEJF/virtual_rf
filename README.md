# Flow

> AI-powered personal workforce manager — route requests, spawn autonomous workers, and self-improve over time.

Flow is a localhost-first system that manages outcomes through AI workers. You describe what you want to achieve, and Flow breaks it into tasks, builds the skills needed, executes the work, reviews the results, and iterates until done.

## Quick Start

```bash
# Clone and install
git clone <repo-url> ~/flow
cd ~/flow
npm install

# Create the user data directory (database, workspaces, skills live here)
mkdir -p ~/flow-data/{data,workspaces,skills}

# Start the dev server
npm run dev
# Open http://localhost:3000

# Optional: install the CLI
cd cli && npm install && npm run build && npm link
flow status
```

See [docs/SETUP.md](./docs/SETUP.md) for full setup instructions including Claude Code CLI configuration.

## Security Notice

Flow is a **localhost-only personal tool** with no authentication layer. **Do not expose port 3000 to a network.** It is designed to run on your local machine and accessed only by you.

## Architecture

Flow uses a two-phase orchestration model:

1. **Capability Phase** — Build skills and tools the workers will need
2. **Execution Phase** — Autonomous workers claim and complete tasks
3. **Review Phase** — AI reviewer checks work, creates fix tasks if needed
4. **Iterate** — Request changes even after completion

For detailed architecture documentation, see [docs/vision/README.md](./docs/vision/README.md).

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **Database**: SQLite via better-sqlite3
- **AI**: Claude Code CLI
- **Validation**: Zod

## Requirements

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and in PATH

## License

MIT
