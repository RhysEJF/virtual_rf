# Compound Engineering Plugin: Integration Analysis for Flow

> Claude Code plugin encoding a complete engineering methodology — 28 agents, 47 skills, 80% planning / 20% execution philosophy.

## Source Material

- [GitHub: EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)
- v2.40.0 — 28 agents, 47 skills, 1 MCP server (Context7)

## What Is It?

A Claude Code plugin that encodes a structured engineering methodology as slash commands. Core thesis: **"Each unit of engineering work should make subsequent units easier — not harder."** It enforces an 80/20 split: 80% planning and review, 20% execution.

The plugin orchestrates Claude Code's sub-agent spawning (Task tool) to run multiple specialized AI agents in parallel for research, planning, review, and knowledge capture.

## Architecture

```
plugins/compound-engineering/
├── agents/
│   ├── research/     # 5 agents (best-practices, framework-docs, git-history, learnings, repo-research)
│   ├── review/       # 15 agents (security, performance, architecture, simplicity, etc.)
│   ├── design/       # 3 agents (UI verification, design sync)
│   └── workflow/     # 4 agents (bug repro, lint, spec-flow, PR resolver)
├── skills/           # 47 skills (core workflow, automation, architecture, knowledge capture)
├── .mcp.json         # Context7 MCP server for framework docs
└── CLAUDE.md
```

## The Pipeline: Brainstorm → Plan → Deepen → Work → Review → Compound

### 1. Brainstorm (`/ce:brainstorm`) — WHAT to build

- **Phase 0 — Clarity check:** Evaluates whether brainstorming is even needed. Clear requirements → skip to planning.
- **Phase 1 — Collaborative dialogue:** Asks questions **one at a time** using AskUserQuestion. Prefers multiple-choice. Starts broad → narrows. Continues until clear OR user says "proceed."
- **Phase 2 — Approach exploration:** Proposes 2-3 concrete approaches with pros/cons. Leads with recommendation. Applies YAGNI.
- **Phase 3 — Design capture:** Writes brainstorm doc to `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`.
- **Phase 4 — Handoff:** Offers next steps including "ask more questions" loop.

Key constraint: *"Stay focused on WHAT, not HOW — implementation details belong in the plan."*

### 2. Plan (`/ce:plan`) — HOW to build it

The most detailed skill. Multi-phase:

**Brainstorm continuity:** Checks `docs/brainstorms/` for recent (14-day) matching docs. If found, extracts ALL decisions, rationale, constraints, open questions. Skips idea refinement. Plans back-reference brainstorm decisions.

**Idea refinement (if no brainstorm):** Gathers signals: user familiarity, intent (speed vs thoroughness), topic risk, uncertainty level.

**Multi-phase research:**
1. **Local research (always, parallel):** Spawns `repo-research-analyst` + `learnings-researcher` in parallel. Examines codebase patterns, CLAUDE.md, existing implementations, documented solutions.
2. **Research decision gate:** Based on signals + local findings, decides whether external research is needed. High-risk topics always get research. Strong local context skips it. Decision announced, user can redirect.
3. **External research (conditional, parallel):** Spawns `best-practices-researcher` + `framework-docs-researcher`. Uses web search, Context7 MCP.
4. **Consolidation:** Documents file paths, learnings, URLs, related issues, conventions.

**SpecFlow analysis:** Validates feature spec for user flow completeness — maps user journeys, discovers permutations, identifies gaps, formulates prioritized questions.

**Three detail levels:**
- **MINIMAL** — quick issue
- **MORE** — standard (default)
- **A LOT** — comprehensive with phases, alternatives, risk analysis, system-wide impact (interaction graph, error propagation, state lifecycle risks, API surface parity, integration test scenarios)

**Output:** Mandatory write to `docs/plans/YYYY-MM-DD-NNN-<type>-<descriptive-name>-plan.md`

Final instruction: *"NEVER CODE! Just research and write the plan."*

### 3. Deepen (`/deepen-plan`) — Enrich with parallel research

Takes an existing plan and enhances it:
1. Parse plan into section manifest
2. Discover ALL available skills across all directories
3. Match skills to plan sections, spawn one sub-agent per match
4. Search `docs/solutions/` for relevant learnings, spawn sub-agents
5. Launch per-section research agents
6. Run ALL review agents — *"Do NOT filter by relevance — run them ALL. 20, 30, 40 parallel agents is fine."*
7. Synthesize, deduplicate, prioritize by impact, flag conflicts
8. Enhance plan sections with "Research Insights" subsections

### 4. Work (`/ce:work`) — Execute the plan

Four phases:
1. Read plan, clarify, set up git branch/worktree, break into TodoWrite tasks
2. Execute loop with system-wide test checks per task
3. Quality check (tests, linting, reviewer agents, operational validation)
4. Ship (conventional commits, screenshots, PR)

### 5. Review (`/ce:review`) — Multi-agent parallel review

15+ specialized review agents in parallel: security, performance, architecture, simplicity, schema drift, data integrity, pattern recognition, plus language-specific reviewers.

"Ultra-Thinking Deep Dive" analyzes from 5 stakeholder perspectives and 10 edge-case scenarios. Findings → file-based todos with P1/P2/P3 severity.

### 6. Compound (`/ce:compound`) — Knowledge capture

After solving a problem, captures solution in `docs/solutions/[category]/[filename].md` with searchable YAML frontmatter. Five parallel sub-agents: Context Analyzer, Solution Extractor, Related Docs Finder, Prevention Strategist, Category Classifier.

Creates the **compounding loop**: solutions documented here are found by `learnings-researcher` during future planning.

## Autonomous Workflows

### `/lfg` (Let's Go) — Sequential
```
plan → GATE → deepen → GATE → work → GATE → review → resolve todos → test → video → DONE
```

Each step has explicit **GATES**: *"STOP. Verify that /ce:plan produced a plan file. If no plan was created, run /ce:plan again. Do NOT proceed."*

### `/slfg` (Swarm Let's Go) — Parallel
Same pipeline but steps 5-6 (review + browser test) run as parallel swarm agents.

## Patterns Worth Borrowing

### 1. Conditional Research with Decision Gate
Gathers signals (familiarity, risk, uncertainty) → decides research depth → announces decision → user can redirect. Prevents both under-researching risky topics and over-researching simple ones.

### 2. Brainstorm-Plan Continuity
Brainstorm docs auto-detected by planning phase. Plan carries forward ALL brainstorm decisions with back-references. Cross-check verifies nothing dropped. Prevents "telephone game" context loss.

### 3. Sequential Gates in Autonomous Workflows
Explicit GATE checks between pipeline steps. Prevents agents from skipping steps or proceeding without artifacts.

### 4. Massive Parallel Agent Spawning
"20, 30, 40 parallel agents is fine." Over-parallelize and synthesize, rather than sequential processing.

### 5. Knowledge Compounding Loop
Solutions in `docs/solutions/` with structured YAML frontmatter → `learnings-researcher` searches during future planning → self-reinforcing loop where past solutions inform future plans.

### 6. Three-Tier Detail Levels
MINIMAL / MORE / A LOT. Prevents over-engineering simple tasks. Each tier additive.

### 7. "NEVER CODE!" Guardrails
Hard constraint on planning skills preventing premature implementation. Phase-specific behavioral constraints.

### 8. SpecFlow Analysis as Quality Gate
Spec validation between planning and execution — maps user journeys, discovers permutations, identifies gaps before code is written.

### 9. Mandatory Deprecation Checking
External API research includes mandatory deprecation check. *"5 minutes of validation saves hours of debugging."*

## Where Flow and Compound Engineering Overlap

| Concept | Compound Engineering | Flow |
|---|---|---|
| Planning phase | Brainstorm → Plan → Deepen (multi-step, gated) | Intent optimization → Approach optimization (single-shot each) |
| Research | 5 dedicated research agents, conditional depth | No dedicated research phase |
| Task generation | Plan doc → TodoWrite in /ce:work | Intent → task generation (single Claude call) |
| Review | 15+ parallel specialized agents | Single-pass reviewer agent |
| Knowledge capture | `docs/solutions/` with YAML frontmatter | HOMR discoveries → memories table |
| Execution | Claude Code sub-agents (Task tool) | Ralph workers (Claude CLI processes) |
| Orchestration | Slash commands + sequential gates | Two-phase orchestration + HOMR protocol |
| Skill system | 47 skills as markdown files | Skills directory + DB-tracked |

### Key Differences

- **Compound Engineering operates within Claude Code.** It's a plugin that enhances a single Claude Code session. Flow is a standalone system that *spawns* Claude CLI processes.
- **Compound Engineering is synchronous.** You're in the terminal watching it work. Flow is asynchronous — workers run in the background, you check in later.
- **Scale model:** Compound Engineering handles one feature at a time. Flow manages multiple outcomes with multiple workers.
- **Planning depth:** Compound Engineering's planning pipeline is dramatically deeper (brainstorm → plan → deepen → specflow analysis → gates). Flow's is shallow (ramble → optimize → generate tasks).

## What We Should Borrow (Ranked by Impact)

### 1. Multi-Phase Planning with Conditional Depth

**What:** Replace Flow's single-shot task generation with a phased pipeline: clarity check → optional brainstorm → local research → conditional external research → plan with detail level → specflow validation → task generation.

**Why:** This is the Discovery Engine idea, but Compound Engineering proves the specific mechanics that work. The conditional research gate (gather signals → decide depth → announce → user redirects) solves the user's exact concern about not always wanting a full interview.

**What to change:** New planning pipeline in Flow with configurable depth. The clarity check at the start means simple outcomes skip straight through while complex ones get the full treatment.

### 2. Sequential Gates Between Phases

**What:** Add explicit artifact verification between pipeline steps. Don't proceed from planning to execution unless a plan document exists and meets quality criteria.

**Why:** Flow currently transitions from intent → tasks in one step. Adding gates between brainstorm → plan → task generation ensures each phase completes properly before the next begins.

**What to change:** Gate checks in the orchestrator between planning and execution phases.

### 3. Knowledge Compounding Loop

**What:** Supplement Flow's DB-based memory with file-based solution documents that are searchable by future planning agents.

**Why:** Flow's HOMR discoveries are stored in SQLite and retrieved by semantic/BM25 search. Compound Engineering's `docs/solutions/` approach is simpler, more portable, and the YAML frontmatter enables structured filtering (by category, tags, module). Both approaches have value — DB for real-time worker injection, files for planning-phase research.

**What to change:** Add solution capture step after successful outcomes. Planning agent searches solution docs during research phase.

### 4. Parallel Research Agent Spawning

**What:** During planning, spawn multiple specialized research agents in parallel (codebase analysis, learnings search, external research) rather than doing everything in one Claude call.

**Why:** Single-call planning can't be both fast and thorough. Parallel agents give depth without proportional time cost.

**What to change:** Planning agent spawns sub-agents for research. Flow already has the infrastructure (Claude CLI spawning); the change is using it during planning, not just execution.

### 5. Three-Tier Detail Levels

**What:** Let outcomes specify planning depth: MINIMAL (quick, just generate tasks), MORE (standard planning with local research), A LOT (full discovery with external research, specflow analysis, system-wide impact).

**Why:** Solves the user's concern about not wanting interview overhead on simple outcomes. The system adapts to the task, or the user specifies upfront.

**What to change:** Planning depth parameter on outcomes. Each tier maps to a different subset of the planning pipeline.

## What We Should NOT Adopt

### File-Based Todos
Flow already has a tasks table with richer metadata (dependencies, gates, complexity scores, decomposition tracking). File-based todos would be a downgrade.

### Plugin Architecture
Compound Engineering is a Claude Code plugin. Flow is a standalone system. The plugin model doesn't apply, but the *skills and agent patterns* absolutely do.

### Synchronous-Only Execution
Compound Engineering assumes you're watching the terminal. Flow's async model (workers run in background, Telegram notifications) is a better fit for long-running work.

## Summary

| Idea | Impact | Effort | Recommendation |
|---|---|---|---|
| Multi-phase planning with conditional depth | **High** | Medium | Core of Discovery Engine — adopt the specific mechanics (clarity check, signal gathering, research gate) |
| Sequential gates between phases | **High** | Small | Add artifact verification between planning steps |
| Knowledge compounding loop | **Medium** | Small | Add file-based solution capture alongside DB memories |
| Parallel research agent spawning | **Medium** | Medium | Use during planning phase, not just execution |
| Three-tier detail levels | **Medium** | Small | MINIMAL/MORE/A LOT on outcomes — solves "not always wanting interview" concern |
| File-based todos | Low | N/A | Do not adopt — Flow's task system is richer |
| Plugin architecture | N/A | N/A | Not applicable — different system model |
| Synchronous execution | N/A | N/A | Do not adopt — Flow's async model is better |
