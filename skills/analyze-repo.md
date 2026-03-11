---
name: Analyze Repo
description: Deep dive an external repo/protocol/tool and produce a research brief evaluating how it relates to Flow
triggers:
  - analyze repo
  - evaluate repo
  - research repo
  - deep dive
  - evaluate codebase
  - analyze codebase
---

# Analyze Repo

## Purpose

Research an external repository, protocol, or tool and produce a structured evaluation brief that compares it against Flow's architecture. The output is saved to `docs/research/` for later review during roadmap planning.

## When to Use

- When evaluating a new repo, protocol, or tool for potential integration with Flow
- When the user shares a link and wants to understand how it relates to Flow
- When planning Flow 2.0 and surveying the landscape

## Process

### Step 1: Understand the External System

Fetch and read the documentation for the external repo/protocol/tool. Go deep — read:
- README, introduction, overview pages
- Core concepts, architecture, key abstractions
- API surface, SDK, event systems
- Any "how it works" or "getting started" guides

Extract:
- What problem it solves
- Core architecture and abstractions
- Key features and capabilities
- SDK/integration surface
- Ecosystem and community

### Step 2: Understand the Relevant Parts of Flow

Read the Flow codebase areas that overlap with what this external system does. Key starting points:
- `CLAUDE.md` — Full system overview and current progress
- `docs/vision/README.md` — Module index
- Specific module code as relevant to the overlap

Map out where Flow currently solves (or fails to solve) the same problems.

### Step 3: Write the Brief

Create a file at `docs/research/<short-name>.md` using the template below.

**Naming convention:** Use lowercase kebab-case. Examples: `ag-ui.md`, `agent-teams.md`, `harness-engineering.md`

### Step 4: Verify

- Confirm the file is saved in `docs/research/`
- Confirm the repo URL is prominently included
- Confirm the "What We Should Borrow" section has effort estimates
- Confirm there's a summary table at the end

## Template

```markdown
# <Name>: Integration Analysis for Flow

> One-line summary of what this is and why it matters to Flow.

## Source Material

- [<Repo/Docs Name>](<URL>) — brief description
- [<Additional sources>](<URL>) — if applicable

## What Is <X>?

<2-4 paragraphs explaining what this is, what problem it solves, and how it works at a high level.>

## Core Architecture

<Key abstractions, components, data flow. Include tables or diagrams where helpful.>

## Where Flow and <X> Overlap

### 1. <Overlap Area>
- **<X>**: How the external system handles this
- **Flow today**: How Flow currently handles this
- **Gap/Opportunity**: What's different

### 2. <Overlap Area>
...

<Cover all significant areas of overlap. Be specific about Flow's current implementation — reference file paths, patterns, limitations.>

## What We Should Borrow (Ranked by Impact)

### 1. <Idea Name> — <HIGH/MEDIUM/LOW> IMPACT

**What**: One-line description of the idea.

**Why it improves Flow**:
- Bullet points on concrete benefits

**What to change**:
- Specific files, APIs, components that would need modification
- New files/endpoints that would need to be created

**Effort**: <Low/Medium/High>. Brief justification.

### 2. <Idea Name> — <IMPACT LEVEL>
...

### N. <Idea Name> — <IMPACT LEVEL>
...

## What We Should NOT Adopt

- **<Feature>** — Why it doesn't fit Flow's architecture or use case
- ...

## Summary

| Idea | Impact | Effort | Recommendation |
|------|--------|--------|----------------|
| ... | ... | ... | ... |

**Bottom line**: <One paragraph synthesis — what's the single biggest takeaway for Flow?>
```

## Saving the Output

After writing the brief, save it immediately using the `document-repo-research` skill conventions. The file goes to `docs/research/<short-name>.md`. Do NOT just present the analysis in conversation — always persist it to disk. The whole point is building a library of evaluations for roadmap planning.

## Quality Checklist

- [ ] Repo/docs URL is included prominently in Source Material
- [ ] "What Is" section explains it clearly enough for someone unfamiliar
- [ ] Overlap section references specific Flow files and patterns (not vague)
- [ ] Each "What We Should Borrow" item has: What, Why, What to change, Effort
- [ ] Items are ranked by impact (highest first)
- [ ] "What We Should NOT Adopt" section exists (even if short)
- [ ] Summary table covers all items
- [ ] File saved to `docs/research/<short-name>.md`

## Existing Research Files (for style reference)

Check `docs/research/` for existing evaluations to match tone and depth:
- `ag-ui.md` — AG-UI protocol (event streaming, state sync)
- `harness-engineering.md` — OpenAI harness engineering (quality gates)
- `agent-teams.md` — Claude Code Agent Teams (multi-agent patterns)
- `mcp-integration.md` — MCP server integration (capability expansion)
- `agent-messaging.md` — Inter-worker communication
- `session-search.md` — Cross-outcome session search
- `multi-model-routing.md` — Multi-model routing
- `VECTOR-SEARCH-SQLITE.md` — SQLite vector search
