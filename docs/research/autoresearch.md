# Autoresearch: Integration Analysis for Flow

> Karpathy's autonomous AI research loop — agents iteratively optimize code against a hard metric using git as experiment memory.

## Source Material

- [GitHub: karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- `program.md` — the "research org as code" instruction file
- `program_agenthub.md` — multi-agent extension via central hub

## What Is Autoresearch?

Autoresearch is a radically minimal framework for autonomous AI research. An AI coding agent (Claude Code, Codex, etc.) runs an infinite hill-climbing loop over a single file (`train.py`), making experimental changes, training a GPT model for exactly 5 minutes, and keeping or reverting based on a single scalar metric (`val_bpb` — validation bits-per-byte).

The entire "orchestration" is a markdown file (`program.md`) that tells the agent what to do. Git history serves as experiment memory — the branch is a linear chain of only improvements; failed experiments are `git reset --hard` away. A `results.tsv` file logs every attempt (including failures) for post-hoc analysis.

### Architecture (3 files)

| File | Role | Mutability |
|---|---|---|
| `prepare.py` | Data prep, tokenizer, dataloader, eval metric | Read-only (never touched by agents) |
| `train.py` | Full GPT model, optimizer, training loop, hyperparams | Agent-editable (the only file agents modify) |
| `program.md` | Natural language instructions — the "research org code" | Human-editable (programs the AI researcher) |

### The Loop

```
1. Read program.md (skill/instructions)
2. Create git branch autoresearch/<tag>
3. Run baseline train.py → establish starting metric
4. LOOP FOREVER:
   a. Modify train.py with an experimental idea
   b. git commit the change
   c. Run: uv run train.py > run.log 2>&1  (5 min fixed budget)
   d. Extract: grep "^val_bpb:" run.log
   e. IF improved → keep commit, advance branch
      IF worse/equal → git reset --hard (revert)
      IF crashed → read traceback, attempt fix or skip
   f. Log result to results.tsv
   g. NEVER STOP
```

### Key Design Principles

1. **Fixed-Budget Normalization**: Every experiment gets exactly 300 seconds wall-clock training. This makes all results directly comparable regardless of architectural changes. The agent optimizes for "best model you can train in 5 minutes on this hardware."

2. **Radical Minimalism**: 3 files, 1 metric, 1 file to modify. The constrained action space makes the problem tractable for an AI agent.

3. **Git as Experiment Tracker**: Each experiment is a commit. The branch history is the "kept" log. Discarded experiments vanish from history but remain in `results.tsv`.

4. **Simplicity Criterion**: From `program.md`: "All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Removing something and getting equal or better results is a great outcome."

5. **Crash Recovery**: When a run crashes, the agent reads `tail -n 50 run.log` to diagnose the stack trace and attempt a fix. If it can't fix after a few attempts, it moves on.

6. **Output Redirection**: Training output goes to `run.log`, agent reads only summary metrics via `grep`. Prevents context window pollution from hundreds of progress lines.

### Multi-Agent Extension (Agenthub)

`program_agenthub.md` extends the pattern to multiple agents collaborating via a central hub (`autoresearchhub.com`):

- Agents **register** and get API keys
- **Git bundle push/fetch** system shares commits between agents
- **Message board** with channels (`#results`, `#discussion`) for coordination
- Agents read the hub before each experiment to see what others tried
- Only improvement commits get pushed; all results (including failures) are posted
- Each agent identifies its **compute platform** (H100, A100, M4-Max) since results are hardware-dependent
- **Frontier discovery**: `GET /api/git/leaves` returns leaf commits (tips of exploration)
- **Deduplication**: `GET /api/git/commits/<hash>/children` shows what's been tried on a given commit

Agents are fully independent — they choose what to explore based on hub state, with no central coordinator or task assignment.

### Actual Results

The experiment branch shows 126 experiments, improving from baseline `val_bpb=0.9979` to `0.9697` — a 2.8% improvement. Of 126 experiments, ~25 were kept (20% hit rate). Improvements that stuck: halving batch size, adding a layer, adjusting learning rates, window patterns, weight decay schedules, and init scales.

## Where Flow and Autoresearch Overlap

| Concept | Autoresearch | Flow |
|---|---|---|
| **Agent execution loop** | Infinite modify-run-evaluate-keep/revert | Ralph worker: claim-execute-complete/fail-repeat |
| **Skills as markdown** | `program.md` is the entire "skill" — objective, constraints, loop protocol, crash recovery | `skills/*.md` — same pattern with richer structure (YAML frontmatter, triggers, methodology steps) |
| **Git as memory** | Commit history = linear experiment log, revert on failure | Git integration per outcome (branches, auto-commit, PRs), but not experiment-level keep/revert |
| **Metric-driven decisions** | Single scalar (`val_bpb`) drives all keep/revert decisions instantly | Success criteria in PRD, but evaluated by LLM prose analysis (HOMR observer), not a number |
| **Autonomous execution** | "NEVER STOP" — designed for overnight runs, ~100 experiments/sleep cycle | Ralph runs until tasks exhausted or paused, self-healing restart with exponential backoff |
| **Crash recovery** | Read traceback, attempt fix, skip if stuck | Circuit breaker (auto-pause after consecutive failures), turn exhaustion detection, rate-limit detection |
| **Multi-agent coordination** | Hub-based sharing (git bundles + message board), fully decentralized | Multiple workers per outcome, HOMR observe/steer/escalate, cross-outcome learning via memories table |
| **Context management** | Output redirection to log file, grep for metrics only | Full output capture (500KB max), HOMR extracts discoveries from output |
| **Simplicity preference** | Explicit in instructions: "simpler is better" | Not codified — workers optimize for task completion, not simplicity |

### Key Differences

- **Task model**: Autoresearch has one infinite task (optimize the metric). Flow has many finite tasks (complete PRD items). These are fundamentally different execution models.
- **Success evaluation**: Autoresearch uses instant numeric comparison. Flow uses expensive LLM-based review (HOMR observer + reviewer agent).
- **Action space**: Autoresearch constrains to one file. Flow workers operate across entire codebases/workspaces.
- **State management**: Autoresearch uses git revert as undo. Flow marks tasks failed and creates fix tasks — no automatic rollback.
- **Orchestration overhead**: Autoresearch has zero orchestration (just a markdown file). Flow has multi-layer orchestration (dispatcher, capability planner, HOMR, reviewer). This is appropriate because Flow handles complex multi-step outcomes, not single-metric optimization.

## What We Should Borrow (Ranked by Impact)

### 1. Hard Metric Evaluation with Keep/Revert Loop

**What**: Add an optional `metric_command` field to tasks and a "research mode" on outcomes where workers iterate against a measurable target instead of completing discrete tasks.

**Why it improves Flow**: Right now, task success is determined by LLM prose analysis (HOMR observer compares output to intent). This is slow, expensive, and subjective. A hard metric makes keep/revert decisions instant and objective. Research-type outcomes — optimizing ML models, improving test coverage, reducing bundle size, prompt engineering — would benefit enormously. The 20% keep rate from autoresearch's 126 experiments shows this loop finds real improvements that LLM judgment might miss or take longer to evaluate.

**What to change**:
- Add `metric_command` (string, nullable) and `metric_baseline` (float, nullable) fields to the tasks table
- Add `research_mode` boolean to outcomes table (or an `outcome_type` enum: `standard` | `research`)
- In research mode, Ralph worker behavior changes:
  1. Creates a speculative git commit before running eval
  2. Runs `metric_command`, captures numeric output
  3. If metric improved over baseline/best → keep commit, update baseline, log as "keep"
  4. If metric worsened or equal → `git reset --hard HEAD~1`, log as "discard"
  5. If crashed → read error, attempt fix or skip, log as "crash"
  6. Loop on the same task (new experiment) instead of marking "completed"
  7. Task completes only when: max experiments reached, user stops, or metric target achieved
- New `experiments` table: `id, task_id, outcome_id, commit_hash, metric_value, status (keep/discard/crash), description, created_at`
- HOMR observer analyzes experiment trends (plateau detection, diminishing returns) instead of individual task outputs
- OutputsSection shows experiment log with progress chart

**Effort**: Medium — schema changes + worker.ts loop variant (~200 lines) + new table + API endpoints. The worker change is the core work: adding a second execution mode alongside the current task-based loop.

### 2. Fixed-Budget Execution with Normalized Comparison

**What**: Allow outcomes/tasks to specify a fixed time budget for each experiment iteration, ensuring all attempts are directly comparable.

**Why it improves Flow**: Without time normalization, experiment results aren't comparable — a change that makes training slower but slightly better isn't clearly better or worse. The 5-minute fixed budget is what makes autoresearch's hill climbing rigorous. This also naturally prevents runaway experiments that consume resources indefinitely.

**What to change**:
- Add `time_budget_seconds` field to tasks (nullable, only relevant in research mode)
- Worker enforces wall-clock timeout on the experiment command (kill after budget)
- Results include `training_seconds` alongside metric for validation
- Default to no budget for standard tasks (current behavior)

**Effort**: Small — one schema field + timeout wrapper in worker execution. Could use Node's `child_process` timeout option.

### 3. Research Loop Skill Template

**What**: Create a first-class skill template that codifies the autoresearch pattern — objective, constraints, loop protocol, evaluation, crash recovery — as a reusable skill for optimization outcomes.

**Why it improves Flow**: Flow's skills are methodology guides for workers. Autoresearch proves that a *loop protocol* is a valid and powerful skill type. A well-written research-loop skill means Flow can handle "optimize X" outcomes without new infrastructure — workers just follow the skill's instructions. This is the lowest-effort entry point: even without the `metric_command` infrastructure, a worker following this skill pattern with manual metric checking would work.

**What to change**:
- Create `~/flow-data/skills/research-loop.md` with:
  - Clear objective definition pattern (what to optimize, what metric to use)
  - Constraints section (what files to modify, what to leave alone)
  - Fixed-budget execution protocol
  - Keep/revert decision logic using git
  - Results tracking format (TSV with commit, metric, status, description)
  - Crash recovery instructions
  - "Never stop" loop instruction
  - Simplicity criterion ("removing something and getting equal or better results is a great outcome")
- Teach capability planner to detect research/optimization intents ("optimize", "improve", "minimize", "maximize", "tune", "benchmark") and auto-suggest this skill
- Add "Research Outcome" template option in the UI and `flow new --research` CLI flag

**Effort**: Small — one markdown skill file + minor capability planner pattern addition. The skill itself is ~100 lines of markdown.

### 4. Experiment Results Tracking & Visualization

**What**: Track experiment attempts as first-class entities (not just task completions) with a results log and progress visualization.

**Why it improves Flow**: Currently Flow tracks task completions — binary success/failure. Autoresearch's `results.tsv` captures every attempt with metric, status, and description. The analysis notebook shows progress charts, keep/discard ratios, and top contributions. This visibility is essential for research outcomes where the *trajectory* matters more than any single result.

**What to change**:
- `experiments` table (as described in #1)
- API endpoint: `GET /api/outcomes/[id]/experiments` — returns experiment log
- ExperimentsSection component on outcome page:
  - Progress chart (metric over time, kept experiments highlighted)
  - Keep/discard/crash ratio
  - Top N improvements ranked by delta
  - Current best vs baseline
- CLI: `flow experiments <outcome-id>` — tabular experiment log

**Effort**: Small-Medium — new table, one API route, one UI component. The chart could use a simple inline SVG or existing charting approach.

### 5. Simplicity Criterion in Worker Instructions

**What**: Inject a simplicity preference into worker CLAUDE.md context, especially for research mode: prefer smaller changes, value removing complexity, reject marginal gains that add ugly code.

**Why it improves Flow**: Workers currently optimize purely for task completion. They have no incentive to prefer simpler solutions. Autoresearch's explicit simplicity criterion ("removing something and getting equal or better results is a great outcome") prevents complexity drift across many iterations. This matters for any outcome where workers make repeated changes to the same codebase.

**What to change**:
- Add simplicity guidance to the CLAUDE.md template in `generateWorkerInstructions()`:
  ```
  ## Quality Principle
  All else being equal, simpler is better. A small improvement that adds
  ugly complexity is not worth it. Removing code and getting equal or better
  results is a great outcome. Prefer minimal, targeted changes.
  ```
- HOMR observer could flag "complexity increase without proportional benefit" as a drift signal

**Effort**: Tiny — a few lines in the CLAUDE.md template. Optional HOMR observer enhancement is small.

### 6. Agenthub-Style Cross-Worker Result Sharing

**What**: When multiple workers run on the same outcome (or related outcomes), share experiment results so workers don't duplicate failed attempts.

**Why it improves Flow**: Autoresearch's hub prevents agents from trying the same thing twice. Flow's HOMR already does cross-task context injection, but it shares *discoveries* (constraints, patterns, decisions), not *experiment results*. For research mode, workers need to know "this specific change was tried and didn't work" — not just abstract learnings.

**What to change**:
- In research mode, HOMR steerer injects recent experiment summaries into pending task context:
  ```
  ## Recent Experiments (from other workers)
  - [discard] Doubled hidden dim → val_bpb 1.002 (worse)
  - [keep] Halved batch size → val_bpb 0.985 (improved from 0.990)
  - [crash] Removed LayerNorm → RuntimeError in backward pass
  ```
- Cross-outcome: if two outcomes optimize the same codebase, experiments from one inform the other via the memories table

**Effort**: Small — extends existing HOMR steerer context injection with experiment data. Requires experiments table from #1.

## What We Should NOT Adopt

### Single-File Constraint
Autoresearch works because the action space is tiny — one file, one metric. Flow handles multi-file, multi-task outcomes (build a web app, create a marketing strategy, design an API). Forcing single-file focus would cripple Flow's core value proposition. The constraint is appropriate *within* research mode tasks, but should not be imposed globally.

### Zero Orchestration
Autoresearch has no coordinator, no task queue, no observation layer — just a markdown file and git. This works for single-metric optimization but would be catastrophic for Flow's complex outcomes where tasks have dependencies, gates, capability requirements, and cross-task context. HOMR exists because multi-step outcomes need intelligent oversight.

### Agenthub's Decentralized Model (Full)
The hub pattern (git bundle sharing, message board) is interesting but weaker than what Flow already has. HOMR's structured observe/steer/escalate protocol provides richer coordination than a message board. Flow workers share context via the HOMR context store with typed discoveries, not freeform posts. Adopting the full hub model would be a downgrade.

### Permanent "Never Stop" Execution
Autoresearch runs until manually interrupted — designed for overnight GPU runs. Flow needs controllable execution with pause/resume, circuit breakers, and resource awareness. An "infinite loop" mode should be opt-in for research outcomes with configurable max-experiments, not the default.

### Hardware-Specific Results
Autoresearch tracks compute platform because GPU differences affect training metrics. Flow outcomes are generally hardware-independent (code, docs, strategies). Not worth the complexity unless Flow specifically targets ML workloads.

## Summary

| Idea | Impact | Effort | Recommendation |
|---|---|---|---|
| Hard metric eval + keep/revert loop | **High** | Medium | Build as "research mode" — new outcome type with metric-driven worker loop |
| Fixed-budget execution | **High** | Small | Add `time_budget_seconds` to tasks, enforce in worker |
| Research loop skill template | **Medium-High** | Small | Create skill file + capability planner pattern — lowest-effort entry point |
| Experiment results tracking | **Medium** | Small-Medium | New table + API + UI component for experiment visibility |
| Simplicity criterion in workers | **Medium** | Tiny | Add to CLAUDE.md template — improves all outcomes, not just research |
| Cross-worker result sharing | **Medium** | Small | Extend HOMR steerer with experiment context injection |
| Single-file constraint | N/A | N/A | Do not adopt — too limiting for Flow's multi-file outcomes |
| Zero orchestration | N/A | N/A | Do not adopt — Flow needs HOMR for complex outcomes |
| Full agenthub model | Low | High | Do not adopt — HOMR is already superior for coordination |
| "Never stop" default | Low | N/A | Do not adopt as default — opt-in with max-experiments cap |

### The Core Insight

Autoresearch is what Flow's Ralph worker would look like if it only had one task that never ends and one number to optimize. The best integration path is making Flow capable of *becoming* that when the outcome calls for it — a "research mode" that swaps the task-completion loop for a metric-optimization loop, while keeping HOMR's intelligent oversight for trend analysis and plateau detection.

The recommended implementation order:
1. **Research loop skill** (immediate value, zero infrastructure)
2. **Simplicity criterion** (tiny change, universal benefit)
3. **`metric_command` + keep/revert loop** (the core feature)
4. **Experiments table + visualization** (visibility for the new mode)
5. **Fixed-budget execution** (rigor for comparable results)
6. **Cross-worker result sharing** (multiplayer research)
