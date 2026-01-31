# Integration

> External system connections: Claude CLI, Git, environment management.

---

## Purpose

Digital Twin doesn't exist in isolation. It integrates with:

1. **Claude CLI** - The AI engine that powers all agents
2. **Git** - Version control for code outputs
3. **GitHub** - PR workflows and collaboration
4. **Environment** - API keys and configuration

---

## Current State

**Status:** Complete and production-ready

Integrations include:
- Claude CLI wrapper with safe execution
- Git commit/branch/worktree support
- GitHub PR creation via `gh` CLI
- API key management via `.env.local`

---

## Claude CLI

### Overview

All AI capabilities come from Claude Code CLI. We don't use the API directly - we use the user's existing Claude subscription.

### Wrapper

```typescript
// lib/claude/client.ts
export async function complete(request: CompleteRequest): Promise<CompleteResult> {
  const proc = spawn('claude', ['-p', request.prompt], {
    stdio: ['ignore', 'pipe', 'pipe'],  // CRITICAL: stdin must be 'ignore'
    timeout: request.timeout || 120000
  });

  // Collect output, handle errors...
}
```

**Key details:**
- `stdin: 'ignore'` prevents hanging on input prompts
- Default timeout: 2 minutes
- Returns `{ success, text, error }`

### Availability Check

```typescript
export function isClaudeAvailable(): boolean {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

Displayed in UI via `SystemStatus.tsx`.

### Worker Spawning

Workers use a different pattern - spawning Claude with `--dangerously-skip-permissions`:

```typescript
spawn('claude', [
  '-p', ralphPrompt,
  '--dangerously-skip-permissions',
  '--max-turns', '20'
], {
  cwd: taskWorkspace,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

---

## Git Integration

### Philosophy

We don't use OAuth or GitHub API tokens for basic git. Git is already on the user's machine, already authenticated.

**What we do:**
- `git status` - Check state
- `git add/commit` - Record changes
- `git branch/checkout` - Manage branches
- `git push` - Share changes
- `gh pr create` - Create PRs (uses GitHub CLI auth)

### Workflow Modes

| Mode | Description |
|------|-------------|
| `none` | No git integration |
| `local` | Commits only, no push |
| `branch` | Work on feature branch |
| `worktree` | Isolated directory per worker |

### Auto-Commit

When enabled, workers commit after each task:

```typescript
// app/api/outcomes/[id]/git/commit/route.ts
execSync(`git add -A && git commit -m "${message}"`, {
  cwd: workingDirectory
});
```

### Worktree Support

For parallel workers on same repo:

```typescript
// lib/worktree/manager.ts
export function createWorktree(repoPath: string, branchName: string): string {
  const worktreePath = `.worktrees/${branchName}`;
  execSync(`git worktree add ${worktreePath} -b ${branchName}`);
  return worktreePath;
}
```

---

## GitHub Integration

### PR Creation

Uses `gh` CLI (requires user to have authenticated):

```typescript
// app/api/outcomes/[id]/git/pr/route.ts
execSync(`gh pr create --title "${title}" --body "${body}"`, {
  cwd: workingDirectory
});
```

### OAuth Flow

Basic OAuth scaffolding exists but is not fully implemented:
- `app/api/github/auth/route.ts` - OAuth callback handler

---

## Environment Management

### API Keys

Stored in `.env.local` (gitignored, never committed):

```
SERPER_API_KEY=xxx
FIRECRAWL_API_KEY=xxx
ANTHROPIC_API_KEY=xxx  # Not used - we use CLI
```

### Key Management

```typescript
// lib/utils/env-keys.ts
export function checkRequiredKeys(keys: string[]): {
  allPresent: boolean;
  missing: string[];
} {
  const missing = keys.filter(k => !process.env[k]);
  return { allPresent: missing.length === 0, missing };
}
```

### API Endpoint

```typescript
// app/api/env-keys/route.ts
GET  /api/env-keys        // List configured keys (names only, not values)
POST /api/env-keys        // Add/update a key
```

---

## Components

### Files

| File | Purpose |
|------|---------|
| `lib/claude/client.ts` | Claude CLI wrapper |
| `lib/git/` | Git utilities (minimal) |
| `lib/worktree/manager.ts` | Worktree management |
| `lib/utils/env-keys.ts` | API key checking |
| `app/api/env-keys/route.ts` | Key management API |
| `app/api/outcomes/[id]/git/` | Git operation APIs |
| `app/api/github/auth/route.ts` | OAuth handler |

---

## Dependencies

**Uses:**
- `child_process` - For spawning processes
- System `git` - Version control
- System `gh` - GitHub CLI
- System `claude` - Claude Code CLI

**Used by:**
- All agents (via Claude wrapper)
- Worker system (spawns Claude)
- Git-enabled outcomes

---

## Open Questions

1. **MCP Integration** - Claude CLI supports MCP servers. Should we configure them? See IDEAS.md.

2. **Claude availability** - What if Claude CLI is not installed? Currently shows error in UI but doesn't guide user.

3. **Git conflicts** - What happens when parallel workers modify same files? Currently relies on worktrees for isolation.

4. **GitHub rate limits** - Heavy PR creation could hit rate limits. No handling for this currently.

5. **Credential management** - API keys in `.env.local` works but isn't most secure. Could use system keychain.
