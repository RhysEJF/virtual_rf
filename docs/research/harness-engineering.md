# Harness Engineering: Gap Analysis for Flow

> Research from OpenAI's "Harness Engineering: Leveraging Codex in an Agent-First World" (Feb 2026) and related analysis. Identifies patterns Flow is missing that could be high-leverage additions.

## Source Material

- [Harness Engineering | OpenAI](https://openai.com/index/harness-engineering/)
- [Harness Engineering | Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [The Harness Problem | Can.ac](https://blog.can.ac/2026/02/12/the-harness-problem/)
- [Harness Engineering Is Not Context Engineering | mtrajan](https://mtrajan.substack.com/p/harness-engineering-is-not-context)

## What Is Harness Engineering?

The core thesis: when AI agents write the code, engineering rigor doesn't disappear — it **relocates**. The hardest challenges become "designing environments, feedback loops, and control systems" rather than writing code directly.

A **harness** is the tooling and practices that keep AI agents in check. It combines deterministic enforcement (linters, structural tests, CI) with LLM-based review (observation, drift detection). The key insight is you need **both** — LLM review alone isn't enough.

### Harness vs Context Engineering

| Context Engineering | Harness Engineering |
|---|---|
| What the agent **knows** | What the system **prevents, measures, and corrects** |
| Curating docs, managing memory, controlling injected information | Structural environment around the agent |
| A perfect onboarding document | Boundaries, a codebase that makes sense, a CI pipeline that catches mistakes |

**Diagnostic rule of thumb:**
- Wrong output once → likely a **context** problem
- Slow degradation over weeks → a **harness** problem

## What Flow Already Does Well

Flow covers several harness engineering ideas:

- **Context engineering** — skills injection, HOMR steering, cross-outcome memory
- **Dangerous command prevention** — Guard system scans stdout/stderr for rm -rf, force push, etc.
- **Observation and drift detection** — HOMR observer analyzes task output, scores alignment
- **Self-improvement loop** — escalation pattern analysis → improvement outcomes
- **Workspace isolation** — boundary enforcement via isolation_mode in CLAUDE.md

## Gaps: What Flow Is Missing

### 1. Deterministic Quality Gates (Biggest Gap)

**The problem:** Flow's workers complete tasks and then HOMR *observes* the output with an LLM. There are no deterministic checks — no linters, no structural tests, no CI pipeline validating worker output before a task is marked complete.

**The harness engineering thesis:** LLM-based review alone isn't enough. You need mechanical enforcement that never misses obvious violations.

**What this could look like in Flow:**
- A configurable validation pipeline per outcome — run `npm run typecheck`, `npm run lint`, run tests, check architectural boundaries — *before* marking a task complete
- Failed checks get fed back to the worker as context for retry, not just logged
- Could be defined in outcome config: `validation_steps: ["npm run typecheck", "npm run lint", "npm test"]`
- The Guard system currently only blocks dangerous commands — this would extend it to enforce quality

**Priority:** High. This is the single highest-leverage addition. The combination of deterministic gates + teaching errors (see #2) could dramatically reduce the review cycle round-trips.

### 2. Teaching Errors (Error Messages as Context)

**The problem:** When a task fails, Flow's circuit breaker counts it and pauses after 3 consecutive failures. But it doesn't help the agent *learn from* the failure. Errors happen but aren't systematically structured as learning context for retries.

**The pattern:** When a linter or test fails, that failure message becomes learning context injected into the next attempt. "Every failure message doubled as context for the next attempt." The system corrects while blocking.

**What this could look like in Flow:**
- When a task fails, extract and categorize the error (timeout, permission, syntax, runtime, test failure, lint failure)
- Inject structured context into CLAUDE.md for the retry: "Previous attempt failed because: X. The specific error was: Y. Avoid: Z."
- Different from raw output capture (which Flow already does) — this is *structured, actionable* error context
- Could integrate with the deterministic quality gates: lint failure message becomes the teaching context

**Priority:** High. Directly compounds with #1.

### 3. Garbage Collection Agents

**The problem:** Flow has HOMR observation after task completion, but nothing that proactively scans the *accumulated state* of a workspace for rot, stale docs, or architectural drift over time.

**The pattern:** OpenAI runs periodic background agents that scan for documentation inconsistencies, architectural violations, and entropy — then auto-open small cleanup PRs. These are "garbage collection for code quality."

**What this could look like in Flow:**
- A scheduled agent that runs after every N completed tasks (or on a timer)
- Checks: Are outcome docs still accurate? Are there dead files in the workspace? Has the codebase drifted from the design doc? Are there TODO comments left behind?
- Creates small corrective tasks automatically
- Could be a HOMR extension: `homr.garbageCollect(outcomeId)` that runs periodically alongside observe/steer/escalate

**Priority:** Medium. More valuable for long-running outcomes with many completed tasks.

### 4. Architectural Constraint Enforcement

**The problem:** Flow generates a `design_doc` and HOMR checks alignment scores, but the architecture is a *suggestion*, not a mechanically enforced constraint. Dependency directions aren't validated. Module boundaries aren't checked structurally.

**The pattern:** Architecture as a mechanically enforced constraint, not a suggestion. Dependency directions validated. Module boundaries checked structurally (ArchUnit-style). Violations caught pre-merge, not post-hoc.

**What this could look like in Flow:**
- An outcome could define structural rules: "no circular imports", "API routes must use Zod validation", "components must not import from lib/db directly"
- Rules stored in outcome config or a `constraints.md` file in the workspace
- Checked deterministically after each task (as part of the validation pipeline from #1)
- Violations generate specific, actionable error messages (feeding into #2)

**Priority:** Medium. Most valuable for codebase-mode outcomes where workers modify the main repo.

### 5. Lean CLAUDE.md (Table of Contents, Not Encyclopedia)

**The problem:** Flow's `generateTaskInstructions()` builds a per-task CLAUDE.md that stuffs in outcome intent, design doc (truncated at 3000 chars), skills, HOMR context, etc. This is an encyclopedia approach.

**The OpenAI pattern:** Keep AGENTS.md at ~100 lines — a map that points to deeper docs. Codebase topology itself should be the context. A background agent flags stale docs and opens cleanup PRs.

**What this could look like in Flow:**
- Instead of cramming everything into CLAUDE.md, structure the workspace so the agent can *navigate* to what it needs
- Shorter CLAUDE.md with pointers: "Read `docs/architecture.md` for system design. Read `docs/patterns.md` for coding conventions. Read `docs/decisions.md` for past decisions."
- Trust the agent to read them when relevant rather than front-loading everything
- A background agent that flags when workspace docs become stale

**Priority:** Low-medium. Current approach works but may hit context limits on complex outcomes. Worth experimenting with.

### 6. "Agent Struggle = Harness Signal" Feedback Loop

**The problem:** Flow's self-improvement analyzer looks at escalation patterns, but doesn't systematically ask "what tool, guardrail, or doc was missing that caused this failure?" and feed that back into the harness itself.

**The pattern:** When an agent struggles, the question isn't "is the model bad?" — it's "what's missing from the environment?" Treat every failure as a signal about the harness.

**What this could look like in Flow:**
- After task failures, a structured analysis: Was it a missing skill? A missing doc? An unclear constraint? A tooling gap? An insufficient quality gate?
- Results feed directly into capability planning — auto-creating the missing harness component
- Extends the current self-improvement loop from "analyze escalation patterns" to "analyze all failure patterns and improve the execution environment"
- Could categorize: context failure (missing info) vs harness failure (missing enforcement) vs model failure (genuine capability gap)

**Priority:** Medium. This is the philosophical shift that ties everything together.

## Implementation Priority

If implementing these, the recommended order:

1. **Deterministic Quality Gates** (#1) + **Teaching Errors** (#2) — these compound together and address the biggest gap
2. **Agent Struggle = Harness Signal** (#6) — the feedback loop that makes the system self-improving at the harness level
3. **Garbage Collection Agents** (#3) — proactive quality maintenance
4. **Architectural Constraints** (#4) — deeper enforcement
5. **Lean CLAUDE.md** (#5) — optimization of context delivery

## Key Quotes

> "Our most difficult challenges now center on designing environments, feedback loops, and control systems." — OpenAI

> "The model is the moat. The harness is the bridge." — Can.ac

> "Rigor doesn't disappear — it relocates." — Martin Fowler summary

> "Wrong output once → context problem. Slow degradation over weeks → harness problem." — mtrajan
