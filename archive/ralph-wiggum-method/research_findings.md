# Research Findings: The Ralph Wiggum Method

## Overview
The "Ralph Wiggum" method is an autonomous development loop designed for AI coding agents (specifically Claude Code). It is based on techniques popularized by Geoffrey Huntley and Matt Pocock. The core philosophy is to enable the AI to work iteratively on a project, maintaining context and "memory" between sessions, while avoiding the trap of circular logic or forgetting the bigger picture.

## Key Components

### 1. The Loop Script (`ralph.sh`)
This is the engine. It runs Claude in a loop, feeding it context and instructions for each iteration.
- **Mechanism**: It calls the `claude` CLI with a specific prompt (`RALPH_PROMPT`) and necessary files (`prd.json`, `progress.txt`).
- **Safety**: It has a max iteration limit to prevent runaway costs or infinite loops.
- **Context Injection**: It ensures the agent always sees the "Product Requirements" (PRD) and the "Session Memory" (`progress.txt`) at the start of every turn.

### 2. Structured Memory (`prd.json` & `progress.txt`)
Instead of relying solely on the LLM's context window (which fills up) or file readings (which can be disparate), this method forces structured state management.
- **`prd.json`**: Acts as the "Source of Truth" for features. It tracks `id`, `description`, `status` (`passes: true/false`), and `acceptance_criteria`. This breaks large apps into atomic units of work.
- **`progress.txt`**: Acts as the "Episodic Memory". It records what happened in previous turns, what worked, what failed, and notes for the "next self". This prevents the agent from retrying the same failed approach repeatedly.

### 3. The "Definition of Done" Protocol
The method enforces rigorous verification *before* moving to the next task.
- **Atomic Commits**: Each feature is one unit.
- **Verification**: The loop demands `typecheck`, `test`, and `lint` to pass before a feature is marked complete in the PRD.
- **No Cheating**: The prompt explicitly forbids rewriting tests just to make them pass (unless the test itself is wrong).

### 4. Implementation Strategy for StravaDance
Applying this to StravaDance:
- **Scaffolding**: We need to initialize the repository with this structure (`plans/`, `CLAUDE.md`, etc.).
- **Feature Breakdown**: The `moveshake.md` requirements need to be decomposed into individual JSON objects in `prd.json`.
- **Iteration**: The loop will pick the highest priority feature, implement it, test it, commit it, and update the PRD/progress log.

## Benefits
- **Resilience**: If the agent crashes or the session ends, the `progress.txt` and `prd.json` allow it to pick up exactly where it left off.
- **Focus**: The agent only works on ONE feature at a time, reducing hallucination and complexity.
- **Quality**: The forced testing step ensures the codebase stays buildable.

## Risks & Mitigations
- **Infinite Loops**: The agent might get stuck on a hard bug. *Mitigation:* The prompt instructs it to document the blocker and move on after 3 attempts.
- **Context Drift**: The `progress.txt` might get too long. *Mitigation:* Manual pruning or summarizing if it exceeds token limits (though modern context windows are large).
- **Test Fragility**: Writing good tests autonomously is hard. *Mitigation:* We will start with a robust testing setup in `FEAT-001`.
