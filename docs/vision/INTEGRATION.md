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

## Status

| Capability | Status |
|------------|--------|
| Claude CLI wrapper | Complete |
| Claude availability detection | Complete |
| Git commit/branch support | Complete |
| Git worktree support | Complete |
| GitHub PR creation (via gh) | Complete |
| API key management | Complete |

**Overall:** Complete and production-ready

---

## Key Concepts

### Claude CLI

All AI capabilities come from Claude Code CLI. We don't use the API directly - we use the user's existing Claude subscription.

**Key behaviors:**
- Safe execution (stdin disabled to prevent hangs)
- Timeout handling (default 2 minutes)
- Worker mode with `--dangerously-skip-permissions` (for file/bash access)
- Text-only mode with `disableNativeTools: true` (for pure reasoning, no agentic loops)

### Git Integration Philosophy

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

### Worktree Support

For parallel workers on the same repo, each worker gets its own worktree. This prevents file conflicts when multiple workers modify code simultaneously.

### API Key Management

Skills can declare required API keys. The system:
- Stores keys in `.env.local` (gitignored)
- Checks which keys are configured
- Shows which skills are ready vs. missing keys

---

## Behaviors

1. **No API costs** - Uses Claude CLI with existing subscription
2. **Native git** - Works with user's existing git authentication
3. **Isolated work** - Worktrees prevent parallel worker conflicts
4. **Secure storage** - API keys never committed to git

---

## Success Criteria

- Claude CLI works reliably without hanging
- Workers can commit code without manual intervention
- Parallel workers don't conflict on files
- API keys are stored securely

---

## Open Questions

1. **MCP Integration** - Claude CLI supports MCP servers. Should we configure them? See IDEAS.md.

2. **Claude availability** - What if Claude CLI is not installed? Currently shows error in UI but doesn't guide user.

3. **Git conflicts** - What happens when parallel workers modify same files? Currently relies on worktrees for isolation.

4. **GitHub rate limits** - Heavy PR creation could hit rate limits. No handling for this currently.

5. **Credential management** - API keys in `.env.local` works but isn't most secure. Could use system keychain.

---

## Related

- **Design:** [INTEGRATION.md](../design/INTEGRATION.md) - Implementation details, code patterns, and API specs
- **Vision:** [WORKER.md](./WORKER.md) - How workers spawn Claude processes
