# Skills

> Reusable instruction documents that workers load into their context.

---

## Purpose

Skills are the knowledge layer of Digital Twin. Instead of every worker figuring things out from scratch, skills provide:

1. **Methodology** - Step-by-step approaches to common tasks
2. **Tool references** - How to use available tools
3. **Quality criteria** - What good output looks like
4. **Triggers** - When to apply this skill

Think of skills as "employee training manuals" that workers read before starting work.

---

## Status

| Capability | Status |
|------------|--------|
| Global skills library | Complete |
| Outcome-specific skills | Complete |
| Trigger-based matching | Complete |
| YAML frontmatter parsing | Complete |
| Skill dependency resolution | Complete |
| API key requirements | Complete |
| Repository sync (save targets) | Complete |
| Sync status UI | Complete |
| Manual promotion | Complete |
| **Unified capability creation** | Complete |
| - API endpoints (/api/capabilities/*) | Complete |
| - CLI commands (flow capability, skill new, tool new) | Complete |
| - Conversational API tools | Complete |
| **Claude-powered capability detection** | Complete |
| - Semantic skill matching (replaces substring matching) | Complete |
| - New capability proposal at task level | Complete |
| - `flow task optimize` CLI command | Complete |
| Task refiner skill (pre-execution enrichment) | Complete |

**Overall:** Complete and production-ready

---

## Key Concepts

### Three Skill Types

| Type | Location | Scope |
|------|----------|-------|
| **App** | `~/flow/skills/` | Ship with the app (internal dev guides + external-facing skills) |
| **User** | `~/flow-data/skills/` | Your personal global skill library |
| **Outcome** | `~/flow-data/workspaces/out_{id}/skills/` | Built for specific outcome |

App skills include internal development guides (e.g., `cli-patterns.md`, `update-docs.md`) and external-facing skills (e.g., `flow-cli.md` — teaches an external Claude Code instance how to use the Flow CLI).
User skills are general-purpose (e.g., "market-intelligence", "campaign-planning") or system-level (e.g., `task-refiner.md` — methodology for pre-execution task enrichment, auto-injected during `flow refine`).
Outcome skills are built during capability phase for that outcome's specific needs.

### Repository Sync

Skills (and tools) can be synced to external repositories for reuse:

| Save Target | Description |
|-------------|-------------|
| **Local** | Stays in workspace only |
| **Private** | Synced to your personal repository |
| **Team** | Synced to shared team repository |

Each outcome has default save targets for skills, tools, files, and outputs. Individual items can be promoted to different targets via the UI.

### Skill Structure

Skills are markdown files with YAML frontmatter:

```yaml
---
name: Web Research
description: Research topics using web search
triggers:
  - research
  - search
  - find information
requires:
  - SERPER_API_KEY
---

# Web Research

## Purpose
...

## Methodology
...
```

### Skill Search & Matching

Skills are discovered through three mechanisms:

1. **Name/keyword matching** — `searchSkills()` checks if the task's title + description contains the skill's name, category, or description keywords. This is a reverse search: the query (long) is checked for the presence of skill identifiers (short), not vice versa.

2. **Trigger matching** — Skills with explicit `triggers` in their frontmatter are matched when any trigger keyword appears in the task query.

3. **Claude-powered semantic detection** — `detectCapabilitiesWithClaude()` sends the task text and the full list of existing skills to Claude for semantic analysis. This avoids false positives from partial word matches (e.g., "patterns" matching "Cli Patterns") and can propose entirely new capabilities when the text describes something that doesn't exist yet. Used during task field optimization.

### Skill Scanner

The scanner (`scanSkillsDirectory()`) finds skills in three patterns:
- Flat `.md` files at the root of `skills/` (e.g., `skills/market-intelligence.md`)
- Flat `.md` files inside category subdirectories (e.g., `skills/research/website-analyzer.md`)
- Nested `SKILL.md` files in structured directories (e.g., `skills/development/nextjs-setup/SKILL.md`)

### API Key Requirements

Skills can declare what API keys they need via the `requires` field. The UI shows which skills are ready vs. missing keys.

---

## Behaviors

1. **Automatic loading** - Skills are injected into worker context based on task requirements
2. **Trigger matching** - Relevant skills found by keyword matching
3. **Semantic detection** - Claude analyzes task text to find relevant skills and propose new ones
4. **Capability building** - Missing skills are created during capability phase
5. **Key validation** - Skills with missing API keys are flagged in UI
6. **Repository sync** - Skills can be synced to private/team repos for sharing
7. **Auto-save** - If enabled, skills sync automatically when built
8. **Unified creation** - Skills/tools can be created from any interface (UI, CLI, conversational API)

---

## Success Criteria

- Workers have relevant skills loaded for their tasks
- Skills are written in a way that Claude can follow
- Missing skills are detected and built before execution
- API key requirements are visible to users

---

## Open Questions

1. **Skill versioning** - Skills evolve over time. Should we track versions and let workers pin to specific versions?

2. **Skill effectiveness** - How do we know if a skill actually helps? Could track success rates of tasks that use each skill.

3. **Context bloat** - Loading multiple skills can blow up context. Need smarter selection or skill summarization.

4. **Skill dependencies** - Skills can reference tools. Should skills also be able to reference other skills?

---

## Related

- **Design:** [SKILLS.md](../design/SKILLS.md) - Implementation details and file structure
- **Vision:** [ORCHESTRATION.md](./ORCHESTRATION.md) - When skills are built
- **Vision:** [WORKER.md](./WORKER.md) - How skills are loaded into workers
