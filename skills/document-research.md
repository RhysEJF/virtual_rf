---
name: Document Repo Research
description: Save an existing repo/protocol research brief to docs/research/ in the correct format
triggers:
  - document repo research
  - save repo research
  - save research
  - save brief
  - dump research
  - save analysis
  - document brief
---

# Document Repo Research

## Purpose

Save a research brief or analysis that has already been prepared (in this session or elsewhere) into `docs/research/` using the standard format. Use this when you already have the analysis and just need to persist it correctly.

If you need to **perform** the research first, use the `analyze-repo` skill instead.

## When to Use

- After completing an analysis in conversation and needing to save it
- When porting research from another session into the repo
- When the user says "save this", "dump this", "document this" about a research brief

## Process

### Step 1: Identify the Content

Gather all research/analysis content from the conversation. Don't lose any detail — the user explicitly wants all context preserved.

### Step 2: Determine the Filename

Use lowercase kebab-case: `docs/research/<short-name>.md`

Examples: `ag-ui.md`, `harness-engineering.md`, `agent-teams.md`

If unsure of the name, derive it from the repo/protocol name being evaluated.

### Step 3: Format and Save

Structure the content to match the standard template (see below). The key sections are:

1. **Title**: `# <Name>: Integration Analysis for Flow`
2. **Summary line**: `> One-line description`
3. **Source Material**: Links to the repo/docs evaluated
4. **What Is <X>?**: Brief explanation
5. **Where Flow and <X> Overlap**: Comparison with Flow's current patterns
6. **What We Should Borrow (Ranked by Impact)**: Each with What, Why, What to change, Effort
7. **What We Should NOT Adopt**: Things that don't fit
8. **Summary table**: Idea, Impact, Effort, Recommendation columns

Save to `docs/research/<short-name>.md`.

### Step 4: Verify

- File exists in `docs/research/`
- Repo URL is included
- All analysis context from the conversation is preserved
- Format matches existing files in the directory

## Existing Research Files

These files already exist in `docs/research/` — match their style:

| File | Evaluates |
|------|-----------|
| `ag-ui.md` | AG-UI protocol — event streaming, state sync, frontend tools |
| `harness-engineering.md` | OpenAI harness engineering — quality gates, teaching errors |
| `agent-teams.md` | Claude Code Agent Teams — multi-agent coordination |
| `mcp-integration.md` | MCP servers — capability expansion for workers |
| `agent-messaging.md` | Inter-worker messaging via MCP |
| `session-search.md` | Cross-outcome session search |
| `multi-model-routing.md` | Multi-model routing for cost optimization |
| `VECTOR-SEARCH-SQLITE.md` | SQLite vector search extensions |

## Quick Reference

**Where to save**: `~/flow/docs/research/<short-name>.md`

**Naming**: lowercase kebab-case, e.g. `my-tool.md`

**Required sections**: Source Material (with URL), Overlap analysis, Borrowable ideas with effort estimates, Summary table

**Key rule**: Don't lose context. The briefs are reviewed later for roadmap planning — detail matters.
