# Discovery Engine — Design Brief

> Smart planning layer for Flow 2.0. Replaces single-shot task generation with a tiered planning pipeline. Fork and adapt Compound Engineering's proven skills, integrated with Flow's infrastructure.

## Design Decision: Option C — Headless Power + Thin UI

**Rationale (from interview):**

Flow's value isn't execution — Claude Code already handles "just do it" tasks. Flow's value is in the intentional planning and orchestration of big, long-running work. The pain is that the planning experience inside Flow is worse than Claude Code's natural conversation. Users end up in Claude Code anyway to think through the vision, then manually bring it back to Flow.

**The fix isn't to rebuild Claude Code's conversation inside Flow — it's to make the bridge between "I just planned something" and "Flow is executing it" seamless.**

- **Web UI** stays as a read-only dashboard for scanning outcomes, tasks, documents, and approvals. Input retained as an entry point (not deprecated), feeding into the same pipeline.
- **All planning** happens through Claude Code / Telegram / CLI with a smart skill stack.
- **Planning quality** comes from forked Compound Engineering skills, not from building a new chat UI.

## Three Tiers of Planning Depth

Adapted from Compound Engineering's MINIMAL/MORE/A LOT pattern. The system adapts to the task — or the user specifies upfront.

### Tier 1 — QUICK (simple outcomes, you know what you want)
- Input: "Add dark mode toggle to settings page"
- The clarity-check skill detects this is straightforward, skips interview/research
- Generates tasks directly with verification commands
- Total time: ~2 minutes

### Tier 2 — STANDARD (needs some shaping, default)
- Input: "Build a client onboarding flow"
- Clarity check → 3-5 targeted questions (one at a time, multiple choice when possible)
- Parallel local research: codebase analysis + Flow memory/learnings search
- Generates a plan doc, decomposes into worker-ready tasks
- Total time: ~10-15 minutes

### Tier 3 — DEEP (complex, ambiguous, needs real research)
- Input: "I want Flow to support multi-tenant client workspaces"
- Full discovery: interview, local research, external research (web search, repo analysis), specflow analysis
- Can spawn a **linked research outcome** that runs overnight before the main outcome starts
- Generates a rich plan doc with system-wide impact analysis
- Multiple rounds of user approval before execution begins
- Total time: 30 minutes to hours (research can run async)

## The Planning Skill Stack

A pipeline of specialized skills, forked from Compound Engineering and adapted for Flow:

| Flow Skill | CE Source | Adaptation |
|---|---|---|
| `clarity-check` | Brainstorm Phase 0 (Requirements Clarity Assessment) | Extract clarity assessment logic, add tier detection (QUICK/STANDARD/DEEP), add Flow outcome type awareness |
| `interview` | Brainstorm Phase 1-2 (Collaborative Dialogue + Approach Exploration) | Mostly as-is. Add Flow context (reference past outcomes, memory system). One question at a time, prefer multiple choice. YAGNI principle. |
| `local-research` | `repo-research-analyst` + `learnings-researcher` agents | Replace `docs/solutions/` search with Flow memory system queries (HOMR discoveries, cross-outcome learnings). Add workspace/codebase analysis. |
| `external-research` | `best-practices-researcher` + `framework-docs-researcher` agents | Largely as-is. Remove Context7 dependency (or keep optional). Add mandatory deprecation checking. Configurable — can be disabled for model-knowledge-only research. |
| `plan-writer` | `ce-plan` skill (core planning methodology) | Replace `docs/plans/` with Flow workspace paths. Add verify_command generation, complexity scoring, dependency mapping. Three detail levels (MINIMAL/MORE/A LOT). Simplicity criterion from autoresearch. |
| `specflow-check` | `spec-flow-analyzer` agent | Works as-is — pure methodology. Maps user journeys, discovers permutations, identifies gaps. |
| `task-generator` | **New** (CE uses TodoWrite) | Write ourselves. Takes plan doc → generates Flow tasks with full schema: verify_commands, complexity_score, depends_on, gates, required_capabilities. |

### Bonus skills worth forking:
- `document-review` — six-step structured refinement for plan quality
- `ce-compound` — knowledge capture after successful outcomes, feeds compounding loop
- `deepen-plan` — parallel research deepening pattern ("20, 30, 40 agents is fine")

## The Pipeline with Gates

Adapted from Compound Engineering's sequential gate pattern:

```
Input (ramble, voice message, structured brief, pasted design doc, web UI)
  → Clarity Check (decide tier, announce to user)
  → [GATE: tier decided, user can redirect]
  │
  ├─ QUICK: skip to Task Generation
  │
  ├─ STANDARD:
  │   → Interview (3-5 targeted questions, skip if brainstorm/plan doc exists)
  │   → [GATE: scope confirmed]
  │   → Local Research (parallel: codebase + Flow memory + past solutions)
  │   → Plan Document (MINIMAL or MORE detail level)
  │   → [GATE: plan exists, user approves]
  │   → Task Generation
  │
  └─ DEEP:
      → Interview (thorough, multi-round)
      → [GATE: scope confirmed]
      → Local Research (parallel agents)
      → Research Decision Gate (need external? announce, user redirects)
      → External Research (conditional, parallel agents, time-boxed)
      → [GATE: research complete]
      → Plan Document (A LOT detail level, system-wide impact analysis)
      → SpecFlow Validation
      → [GATE: plan + spec validated, user approves]
      → Task Generation
      → [GATE: tasks reviewed, user approves]

  → Workers Start
```

Each gate is a checkpoint. Via Telegram: inline keyboard buttons. Via CLI: prompts. Via web UI: approval buttons. The "NEVER CODE" guardrail from CE applies — the planning pipeline never writes implementation code.

## Entry Points

All entry points feed into the same pipeline:

### CLI
```bash
flow new "Build client onboarding flow"                    # Auto-detects tier
flow new --quick "Add dark mode toggle"                     # Force tier 1
flow new --deep "Multi-tenant client workspaces"            # Force tier 3
flow new --from-plan docs/my-plan.md                        # Skip planning, import existing doc
flow new --from-conversation summary.md                     # Import Claude Code session output
```

### Telegram
- Voice/text message → planning agent picks up, runs clarity check, interviews if needed
- Inline keyboards for gate approvals
- "Just do it" → force tier 1, "this needs research" → force tier 3

### Web UI
- Outcome creation page gets a planning depth selector (Quick / Standard / Deep)
- Existing ramble box feeds into the clarity check as input
- Plan documents viewable/editable in the UI
- Gate approvals via UI buttons

## Knowledge Compounding Loop

Combines Compound Engineering's `docs/solutions/` pattern with Flow's existing memory system:

1. When an outcome completes successfully, capture key solutions as markdown in `~/flow-data/solutions/[category]/`
2. YAML frontmatter with tags, category, module, outcome_id for structured search
3. During future planning (Tier 2+), `local-research` skill searches both:
   - Flow's memory DB (HOMR discoveries, cross-outcome learnings)
   - Solution docs (file-based, grep-searchable, portable)
4. Supplements — not replaces — the existing memory system
5. Research findings logged (including dead ends) to prevent future re-research

## Linked Research Outcomes

For Tier 3, when research is substantial enough to run overnight:

1. Planning agent detects research will take hours (multiple repos, deep domain exploration)
2. Creates a **linked research outcome** with tasks like "analyze competitor X," "evaluate framework Y," "synthesize findings"
3. Research outcome runs with workers (existing Flow infrastructure)
4. When complete, findings feed into parent outcome's planning phase
5. Parent outcome's plan is generated from research findings + user input
6. Research tasks are time-boxed (autoresearch's fixed-budget principle applied to research)

## Autoresearch Refinements

Patterns from Karpathy's autoresearch, applied to the planning phase:

- **Constrained action space** — Each generated task gets tightly constrained scope: specific files to modify, specific verification command, specific success metric where possible. Planning is where constraints are created, not discovered mid-execution.
- **Simplicity criterion** — Plan-writer skill prefers simpler architectures. "Removing something and getting equal or better results is a great outcome."
- **Fixed-budget normalization** — Research tasks are time-boxed for fair comparison. Prevents runaway research.
- **Results tracking** — Log what was researched, what was useful, what was a dead end. Feeds knowledge compounding loop.

## What Doesn't Change

- **Web UI** stays as dashboard/command center (monitoring, visual scanning, approvals, input)
- **Ralph workers** stay as the execution engine
- **HOMR** stays as the quality/oversight layer during execution
- **Skills system** stays — planning skills are new skills in the existing system
- **Task model** stays — same schema, just better populated from the start

## Implementation Strategy

**Fork and adapt** Compound Engineering's best skills/agents (MIT licensed, markdown files, no telemetry). Estimated ~1 day to adapt core set:

1. Fork relevant skills from CE repo
2. Replace file paths with Flow workspace conventions
3. Replace TodoWrite references with Flow task creation (`flow task add` or direct DB calls)
4. Add Flow memory system integration (HOMR discoveries, cross-outcome learnings)
5. Add Flow-specific task schema fields (verify_commands, complexity_score, depends_on, gates)
6. Remove CE plugin-specific ceremony
7. Add tier detection logic to clarity-check skill
8. Write task-generator skill from scratch (CE doesn't have an equivalent)

## Open Questions

1. **Brainstorm continuity** — CE checks for recent brainstorm docs (14-day window) and skips re-interviewing. Should Flow do the same? Where do brainstorm docs live?
2. **Parallel agent spawning** — CE spawns 20-40 sub-agents for research. Flow workers are heavier (full Claude CLI processes). Should planning-phase research use lighter-weight agent spawning?
3. **Plan doc format** — What's the canonical plan document format? CE uses markdown with YAML frontmatter. Flow already has approach docs. Are these the same thing, or separate?
4. **Settings for research** — User wants control over whether external research uses internet vs model-knowledge-only. Where does this config live? Per-outcome? Global?
