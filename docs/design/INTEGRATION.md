# Integration - Design

> Implementation details for external system connections.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/claude/client.ts` | Claude CLI wrapper | ~4KB |
| `lib/git/` | Git utilities | ~2KB |
| `lib/worktree/manager.ts` | Worktree management | ~3KB |
| `lib/utils/env-keys.ts` | API key checking | ~2KB |
| `app/api/env-keys/route.ts` | Key management API | ~2KB |
| `app/api/outcomes/[id]/git/` | Git operation APIs | ~4KB |
| `app/api/github/auth/route.ts` | OAuth handler (stub) | ~1KB |

---

## Claude CLI Integration

### Wrapper Implementation

```typescript
// lib/claude/client.ts
import { spawn } from 'child_process';

export interface CompleteRequest {
  prompt: string;
  timeout?: number;  // Default: 120000 (2 min)
}

export interface CompleteResult {
  success: boolean;
  text: string;
  error?: string;
}

export async function claudeComplete(request: CompleteRequest): Promise<CompleteResult> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', request.prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],  // CRITICAL: stdin must be 'ignore'
      timeout: request.timeout || 120000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, text: stdout.trim() });
      } else {
        resolve({ success: false, text: stdout, error: stderr || 'Unknown error' });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, text: '', error: err.message });
    });
  });
}
```

**Critical:** `stdin: 'ignore'` prevents hanging on input prompts.

### Availability Check

```typescript
import { execSync } from 'child_process';

export function isClaudeAvailable(): boolean {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

### Worker Spawning (Different Pattern)

```typescript
// Workers use --dangerously-skip-permissions for autonomy
const claudeProcess = spawn('claude', [
  '-p', taskPrompt,
  '--dangerously-skip-permissions',
  '--max-turns', '20'
], {
  cwd: taskWorkspace,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});
```

---

## Git Integration

### Available Operations

| Operation | Command | Auth Source |
|-----------|---------|-------------|
| Clone | `git clone` | SSH keys / credential helper |
| Create branch | `git checkout -b {name}` | Local only |
| Commit | `git commit -m "..."` | Local only |
| Push | `git push -u origin {branch}` | SSH keys / credential helper |
| Status | `git status` | Local only |
| Worktree | `git worktree add` | Local only |

### Workflow Modes

```typescript
type GitMode = 'none' | 'local' | 'branch' | 'worktree';
```

| Mode | Description |
|------|-------------|
| `none` | No git integration |
| `local` | Commits only, no push |
| `branch` | Work on feature branch |
| `worktree` | Isolated directory per worker |

### Auto-Commit Implementation

```typescript
// app/api/outcomes/[id]/git/commit/route.ts
import { execSync } from 'child_process';

export async function POST(request: Request) {
  const { message } = await request.json();
  const outcome = getOutcomeById(outcomeId);

  if (!outcome.auto_commit) {
    return Response.json({ error: 'Auto-commit not enabled' }, { status: 400 });
  }

  execSync(`git add -A && git commit -m "${message}"`, {
    cwd: outcome.working_directory
  });

  return Response.json({ success: true });
}
```

### Worktree Management

```typescript
// lib/worktree/manager.ts
import { execSync } from 'child_process';

export function createWorktree(repoPath: string, branchName: string): string {
  const worktreePath = `.worktrees/${branchName}`;
  execSync(`git worktree add ${worktreePath} -b ${branchName}`, {
    cwd: repoPath
  });
  return worktreePath;
}

export function removeWorktree(worktreePath: string): void {
  execSync(`git worktree remove ${worktreePath} --force`);
}

export function listWorktrees(repoPath: string): string[] {
  const output = execSync('git worktree list --porcelain', { cwd: repoPath });
  // Parse output...
  return [];
}
```

---

## GitHub Integration

### PR Creation

```typescript
// app/api/outcomes/[id]/git/pr/route.ts
import { execSync } from 'child_process';

export async function POST(request: Request) {
  const { title, body } = await request.json();
  const outcome = getOutcomeById(outcomeId);

  // Requires user to have authenticated with `gh auth login`
  const result = execSync(
    `gh pr create --title "${title}" --body "${body}"`,
    { cwd: outcome.working_directory }
  );

  return Response.json({ success: true, prUrl: result.toString().trim() });
}
```

### OAuth Flow (Stub)

Basic OAuth scaffolding exists but is not fully implemented:

```typescript
// app/api/github/auth/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  // TODO: Exchange code for token
  // TODO: Store token securely
  // TODO: Redirect back to app

  return Response.redirect('/settings?github=connected');
}
```

---

## Environment Management

### Storage

API keys are stored in `.env.local` (gitignored):

```
SERPER_API_KEY=xxx
FIRECRAWL_API_KEY=xxx
BROWSERBASE_API_KEY=xxx
```

### Key Checking

```typescript
// lib/utils/env-keys.ts
export function checkRequiredKeys(keys: string[]): {
  allPresent: boolean;
  missing: string[];
  configured: string[];
} {
  const missing: string[] = [];
  const configured: string[] = [];

  for (const key of keys) {
    if (process.env[key]) {
      configured.push(key);
    } else {
      missing.push(key);
    }
  }

  return {
    allPresent: missing.length === 0,
    missing,
    configured
  };
}
```

### API Endpoints

```typescript
// GET /api/env-keys
// Returns list of known keys and their status (not values)
{
  "keys": [
    { "name": "SERPER_API_KEY", "configured": true },
    { "name": "FIRECRAWL_API_KEY", "configured": false }
  ]
}

// POST /api/env-keys
// Add or update a key (writes to .env.local)
{
  "key": "SERPER_API_KEY",
  "value": "xxx"
}
```

---

## Dependencies

**System Requirements:**
- `claude` - Claude Code CLI (must be in PATH)
- `git` - Version control
- `gh` - GitHub CLI (optional, for PR creation)

**Used by:**
- All agents (via Claude wrapper)
- Worker system (spawns Claude)
- Git-enabled outcomes
