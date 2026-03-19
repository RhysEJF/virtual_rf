# Darwin Derby + Autoresearch: Evolve Mode Strengthening Analysis

> Karpathy's autoresearch and kousun12's darwin-derby implement the same hill-climbing optimization pattern as Flow's evolve mode — but with key architectural differences that could make evolve significantly more robust.

## Source Material

- [darwin-derby](https://github.com/kousun12/darwin-derby) — Generalized black-box optimization framework with scoring isolation, branch-based rollback, and multi-agent support
- [autoresearch](https://github.com/karpathy/autoresearch) — Karpathy's auto-tuning loop for ML research, agent-as-orchestrator, simplicity criterion
- [Blog post: "Welcome to the Darwin Derby"](https://robc.substack.com/p/welcome-to-the-darwin-derby) — The article connecting these systems

## The Core Pattern (Shared by All Three)

All three systems implement the same fundamental loop:

```
establish baseline → propose change → measure → keep if better, revert if not → repeat
```

The differences are in *how* each step is implemented, and several of Derby/autoresearch's choices expose gaps in Flow's current evolve mode.

---

## Where Flow Evolve and These Systems Overlap

### 1. The Optimization Loop

- **Darwin Derby**: `runner.py` — create proposal branch → run agent → score → merge or delete branch
- **Autoresearch**: Agent-managed — edit `train.py` → run training → check `val_bpb` → keep commit or `git reset --hard`
- **Flow today**: `evolve-loop.ts` — spawn Claude CLI → commit changes → run `metric_command` → keep or `git revert HEAD`
- **Gap**: Flow's loop is functionally equivalent, but the git strategy and scoring isolation are weaker (see below).

### 2. Metric Direction

- **Derby**: `problem.yaml` → `score.direction: minimize | maximize`
- **Autoresearch**: Hardcoded lower-is-better (`val_bpb`)
- **Flow today**: `metric_direction: 'lower' | 'higher'` column on tasks, propagated to eval recipes
- **No gap**: Flow already has this fully implemented with UI toggle.

### 3. Experiment History as Agent Context

- **Derby**: Generates `leaderboard.md` (best accepted scores with descriptions) + `history.md` (recent attempts INCLUDING rejected ones with scores and outcomes). Agent reads both files before each proposal.
- **Autoresearch**: `results.tsv` — tabular log of ALL experiments with commit, val_bpb, memory_gb, status (keep/revert/crash), and a freeform description of the approach. Agent reads this + has its own context window memory.
- **Flow today**: Injects previous experiments as a flat string: `Iteration N: value=X, kept=Y, change: Z`
- **Gap**: Flow's context is minimal compared to both. It lacks: (a) separation of "what's currently best" from "what was tried and failed", (b) descriptions of *why* approaches failed, (c) the structured leaderboard format that makes the current-best state immediately scannable.

### 4. Stopping / Convergence

- **Derby**: NO plateau detection. Runs until `-n` max iterations or 5 consecutive *crashes* (not rejections). Can run 1000 rejected proposals without stopping.
- **Autoresearch**: NO plateau detection. Explicit instruction: "NEVER STOP... if you run out of ideas, think harder."
- **Flow today**: `PLATEAU_THRESHOLD = 3` consecutive non-improvements → stop.
- **Gap/Tension**: Flow's plateau detection is *more* aggressive than both external systems. 3 may be too conservative — a string of 3 failed experiments is normal in early exploration. Both external systems philosophically lean toward "keep going" and let the budget cap (or human) decide when to stop.

### 5. Git Rollback Strategy

- **Derby**: Branch-based. Creates `proposals/local/attempt-N` branch, scores on that branch, merges to main only on improvement, deletes the branch either way. Main branch history is clean — only improvements.
- **Autoresearch**: Commit + hard reset. Agent commits, runs, then `git reset --hard HEAD~1` on failure. Simple but destructive — no record of failed attempts in git.
- **Flow today**: Commit + revert. `git add -A && git commit`, then `git revert HEAD --no-edit` on failure. Falls back to `git reset --hard HEAD~1`.
- **Gap**: Flow's revert approach litters the git history with revert commits. Every failed experiment produces two commits (the change + the revert). Derby's branch approach keeps main clean. For a 7-iteration budget where 5 iterations fail, Flow produces ~12 commits vs Derby's ~2.

### 6. Scoring Function Visibility

- **Derby**: Scoring is **physically hidden** from agents. The `scoring/` directory is `.gitignore`d AND moved to `.derby/_scoring/` before the agent runs. The agent never sees scoring code, only a numeric result.
- **Autoresearch**: `prepare.py` (containing the eval function) is marked read-only. The agent is told "do NOT modify" but it's technically visible. Less isolated.
- **Flow today**: `metric_command` is a string visible in the task data. For judge mode, `eval.sh` is generated into the workspace — the agent can read it, see the full prompt, see the criteria and weights, see the calibration examples.
- **Gap**: This is the biggest vulnerability. An evolve agent can read `eval.sh`, see exactly what the judge prompt says, and optimize directly for prompt-pleasing output rather than genuinely better work. Derby's physical isolation is the gold standard here.

---

## What We Should Borrow (Ranked by Impact)

### 1. Scoring Isolation — HIGH IMPACT

**What**: Hide the eval script from the agent during evolve iterations. The agent should see the metric *direction* and *name* but never the scoring implementation.

**Why it improves Flow**:
- Prevents metric gaming — agent can't read the judge prompt and craft outputs that hit keywords
- Forces genuine optimization instead of prompt-hacking
- Makes judge-mode evals actually trustworthy
- Matches Derby's core design principle: "agents never access scoring mechanisms"

**What to change**:
- `lib/ralph/evolve-loop.ts`: Before each iteration, move `eval.sh` (and any recipe files) to a hidden location outside the workspace. Restore for scoring. Derby's pattern: `shutil.move(scoring_src, '.derby/_scoring/')` → equivalent in Node with `fs.renameSync`.
- `lib/evolve/eval-generator.ts`: Generate eval scripts to a hidden scoring directory, not the workspace root.
- Worker CLAUDE.md generation: Strip references to eval.sh internals. Only inject: metric name, direction, criteria *names* (not weights or prompts), and previous experiment results.
- Add `eval.sh` and `.evolve/` to the workspace `.gitignore` template.

**Effort**: Medium. The core change is a move/restore dance around `executeIteration`. The eval generator and CLAUDE.md template need adjustment but the patterns are straightforward.

### 2. Richer Experiment Context (Leaderboard + History Split) — HIGH IMPACT

**What**: Replace the flat experiment string with two structured documents: a **leaderboard** (current best state + what got us here) and a **history** (recent attempts including failures with scores and descriptions).

**Why it improves Flow**:
- Agents make better decisions when they can see *what was tried and failed* separately from *what's currently working*
- Derby and autoresearch both give agents significantly more context than Flow does
- The current flat format (`Iteration N: value=X, kept=Y, change: Z`) buries the key signal
- Structured context lets the agent avoid repeating failed approaches and build on successful ones

**What to change**:
- `lib/ralph/evolve-loop.ts`: Replace `prevContext` string building with two sections:
  - **Current Best**: `"Current best: value=X (iteration N). Changes that got us here: [list of kept changes in order]"`
  - **Failed Approaches**: `"These approaches were tried and reverted: [list with metric values and descriptions]"`
- Worker CLAUDE.md evolve template: Two sections instead of one list
- Consider generating `leaderboard.md` and `history.md` files in workspace (matching Derby's approach) so the agent can reference them naturally

**Effort**: Low. It's a restructuring of existing data that's already in the experiments table. No new data collection needed.

### 3. Branch-Based Rollback — HIGH IMPACT

**What**: Use proposal branches instead of commit-then-revert on the main branch. Each iteration creates a branch, scores on it, then either merges (improvement) or deletes (regression).

**Why it improves Flow**:
- Clean git history — main branch only shows the progression of improvements
- No revert commits cluttering the timeline
- Safer — if scoring crashes mid-evaluation, main is untouched
- Atomic — merge is all-or-nothing
- Better audit trail — you can keep proposal branches around for analysis if desired

**What to change**:
- `lib/ralph/evolve-loop.ts`:
  - Replace: `git add -A && git commit` on main → `git checkout -b evolve/iteration-N` + commit there
  - Replace: `revertLastCommit()` → `git checkout main && git branch -D evolve/iteration-N`
  - On improvement: `git checkout main && git merge evolve/iteration-N --no-ff -m "Evolve: kept iteration N"`
  - Cleanup: always delete the proposal branch after evaluation

**Effort**: Medium. The git operations change but the loop structure stays the same. Need to handle the branch checkout/merge carefully with error handling.

### 4. Crash vs. Rejection Separation — MEDIUM IMPACT

**What**: Distinguish between metric command failures (crashes) and valid-but-worse results (rejections). Track them separately with independent counters.

**Why it improves Flow**:
- Currently Flow treats `runMetricCommand` returning `null` the same as returning a worse number — both increment `consecutiveNonImprovements`
- A crash (eval.sh timeout, syntax error) is fundamentally different from "the agent tried something valid but it didn't improve"
- Derby tracks `consecutive_crashes` separately and only stops on repeated crashes, not repeated rejections
- Enables better diagnostics: "5 crashes in a row" means eval.sh is broken; "5 rejections in a row" means the agent is struggling with the optimization

**What to change**:
- `lib/ralph/evolve-loop.ts`: Add `consecutiveCrashes` counter separate from `consecutiveNonImprovements`. Reset crashes on any successful metric extraction (whether improved or not). Stop on crash threshold (5). Keep plateau threshold for rejections.
- `lib/db/experiments.ts`: Add a `status` field to experiments: `'accepted' | 'rejected' | 'crash'` (Derby's schema)
- Experiment events: Include status in `experiment.completed` event data

**Effort**: Low. Small changes to the loop logic and experiment recording.

### 5. Simplicity Criterion — MEDIUM IMPACT

**What**: Inject a "simplicity gate" into the evolve agent's instructions: improvements that add disproportionate complexity relative to metric improvement should be rejected.

**Why it improves Flow**:
- Autoresearch explicitly says: "A 0.001 improvement that adds 20 lines of hacky code? Probably not worth it. A 0.001 improvement from deleting code? Definitely keep."
- Without this, evolve agents tend toward complexity accumulation — each iteration adds more code/text, making future iterations harder
- Especially important for judge-mode evals where the agent is editing prose or creative work

**What to change**:
- Worker CLAUDE.md evolve template: Add a simplicity criterion section:
  ```
  ## Simplicity Rule
  All else being equal, simpler is better. If your change adds substantial complexity
  for a marginal improvement, reconsider. Removing something while maintaining or
  improving the metric is an excellent outcome.
  ```
- For command-mode evals, could add an automatic diff-size gate: if the change is >N lines and improvement is <X%, auto-revert (optional, configurable)

**Effort**: Low. Primarily a prompt engineering change to the CLAUDE.md template. Optional automation is medium effort.

### 6. State Boundary Enforcement — MEDIUM IMPACT

**What**: Define which files/directories the evolve agent is allowed to modify, and auto-reject proposals that touch anything outside the boundary.

**Why it improves Flow**:
- Derby enforces that agents can only modify files in `state/`. Touching `scoring/`, `problem.yaml`, or anything else auto-rejects the proposal.
- Flow's evolve agents can modify anything in the workspace — including the eval recipe, CLAUDE.md, or other task artifacts
- An agent optimizing a headline could decide to "improve" the score by editing the eval script itself

**What to change**:
- `lib/ralph/evolve-loop.ts`: After `executeIteration`, before scoring, validate the git diff:
  ```typescript
  const changedFiles = execSync('git diff --name-only HEAD', { cwd }).toString().split('\n');
  const invalidFiles = changedFiles.filter(f => !f.startsWith('state/') && f !== targetFile);
  if (invalidFiles.length > 0) { /* auto-revert, log as invalid */ }
  ```
- Eval recipe: Add `artifact.file` (already exists) as the mutation boundary. Only changes to that file (or `state/` directory) are allowed.
- CLAUDE.md: Tell the agent explicitly what they can and cannot modify.

**Effort**: Low-Medium. Straightforward git diff validation. The boundary definition is already partially there via `artifact.file` in recipes.

### 7. Configurable Plateau Threshold — LOW IMPACT

**What**: Make the plateau threshold configurable via recipe or task overrides, rather than hardcoded at 3.

**Why it improves Flow**:
- Both external systems lean toward "run longer" — Derby has no plateau detection at all, autoresearch says "NEVER STOP"
- 3 consecutive failures is quite aggressive for creative/subjective optimizations where variance is high
- For command-mode evals (deterministic), 3 might be appropriate. For judge-mode (stochastic), 5-7 may be better since the same change could score differently across samples.

**What to change**:
- `EvolveRecipe.scoring`: Add optional `plateau_threshold` field
- `lib/ralph/evolve-loop.ts`: Read threshold from recipe/overrides, default to 3
- `eval_overrides` JSON: Add `plateau_threshold` as an override option

**Effort**: Low. One new field, one config read.

### 8. Multi-Agent Parallel Proposals — LOW IMPACT (for now)

**What**: Allow multiple agents to propose changes simultaneously for the same evolve task, with serial evaluation.

**Why it improves Flow**:
- Derby's biggest differentiator is that many agents can clone the repo, create proposal branches, and push. The evaluator processes them serially against the current-best.
- More proposals = faster search of the optimization space
- Different agents might have different "styles" — one conservative, one radical

**Why it's low impact right now**:
- Flow's worker system is single-worker-per-task by design
- The infrastructure to spawn and coordinate multiple agents doesn't exist in evolve mode
- This is a significant architectural change

**What it would take** (future consideration):
- Each agent works on its own branch
- A separate evaluator process polls for branches and evaluates serially
- Merge the best, delete the rest
- This is essentially Derby's `evaluator.py` pattern

**Effort**: High. Would require rethinking how evolve workers are spawned and coordinated.

---

## What We Should NOT Adopt

- **Agent-as-orchestrator (autoresearch)** — Karpathy has no orchestration code; the agent manages its own git state and loop. This works for a single researcher running a single experiment session, but Flow needs reliable orchestration across many tasks and outcomes. The TypeScript loop is the right call — it provides consistency, error handling, and integration with the event system.

- **No plateau detection (both)** — While Flow's threshold may be too aggressive at 3, removing it entirely (like Derby/autoresearch) would waste Claude CLI turns. Their systems run cheap/free agents (or the user's own Claude session); Flow burns worker budget on each iteration. A configurable threshold is better than no threshold.

- **results.tsv as untracked file (autoresearch)** — Karpathy deliberately doesn't commit the experiment log. For a single-session experiment this is fine, but Flow needs persistence across worker restarts and session boundaries. The experiments database table is the right approach.

- **Environment variables for iteration context (Derby)** — Derby sets `DERBY_ITERATION`, `DERBY_SCORE` etc. as env vars. Flow's CLAUDE.md injection is richer and more natural for LLM agents. Env vars are useful for programmatic agents but don't add value when the agent is an LLM reading instructions.

---

## Summary

| Idea | Impact | Effort | Recommendation |
|------|--------|--------|----------------|
| Scoring isolation (hide eval.sh from agent) | HIGH | Medium | **Do this first** — biggest integrity improvement |
| Richer experiment context (leaderboard + history) | HIGH | Low | **Quick win** — restructure existing data |
| Branch-based rollback | HIGH | Medium | **Do this** — cleaner git, safer evaluation |
| Crash vs. rejection separation | MEDIUM | Low | **Quick win** — better diagnostics |
| Simplicity criterion | MEDIUM | Low | **Quick win** — prompt engineering change |
| State boundary enforcement | MEDIUM | Low-Med | **Do this** — prevents metric gaming via file edits |
| Configurable plateau threshold | LOW | Low | **Quick win** — expose existing constant |
| Multi-agent parallel proposals | LOW (now) | High | **Future** — needs worker architecture changes |

**Bottom line**: Flow's evolve mode already has the right loop structure, but it's missing the *trust boundaries* that make Darwin Derby's optimization credible. The single biggest takeaway is **scoring isolation** — if the agent can read the judge prompt, the eval is compromised. Combine that with richer experiment context and branch-based rollback, and evolve mode goes from "neat hill-climbing demo" to "production-grade optimization system."
