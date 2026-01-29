# Digital Twin

> Personal AI workforce management system

## Overview

This codebase is the Digital Twin system - an AI-powered personal assistant that routes requests, spawns AI workers, and self-improves over time.

See `VISION.md` for the complete vision document.

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
│   ├── project/[id]/      # Project detail view
│   ├── worker/[id]/       # Worker drill-down
│   ├── skills/            # Skills library
│   └── api/               # API routes
├── lib/
│   ├── agents/            # AI agent implementations
│   ├── ralph/             # Ralph worker system
│   ├── db/                # Database layer
│   ├── claude/            # Claude API client
│   └── utils/             # Utilities
├── skills/                # Skill library (SKILL.md files)
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

### Dispatcher
Routes messy human input to appropriate handlers:
- Quick tasks → Quick Executor (immediate response)
- Research → Research Agent
- Deep work → Briefer → Orchestrator → Ralph Workers

### Ralph Worker
Autonomous development loop that:
1. Reads PRD and progress.txt
2. Implements one feature at a time
3. Runs verification (typecheck, test, lint)
4. Commits and updates progress
5. Repeats until completion

### Skills
Markdown files + optional tools that teach the AI specific capabilities.
Located in `skills/` directory.

### Supervisor
AI agent that watches workers, detects stuck states, escalates blockers.

## Database Tables

- `projects` - Active projects with briefs and PRDs
- `workers` - Ralph worker instances
- `skills` - Registered skills from skills/ directory
- `cost_log` - API cost tracking
- `bottleneck_log` - Human intervention tracking
- `improvement_suggestions` - System-generated improvements

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

## Agent Notes

When working on this codebase:

1. **Start** by reading VISION.md for context
2. **Check** the current task list
3. **Understand** before modifying
4. **Test** your changes locally
5. **Commit** with proper message format
