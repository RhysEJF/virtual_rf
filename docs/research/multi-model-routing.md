# Multi-Model Routing

> Research on routing tasks to appropriate models based on complexity for cost and speed optimization.

## Source Material

- [swiss_army_llama](https://github.com/Dicklesworthstone/swiss_army_llama) (1k stars) — Multi-model routing infrastructure

## Problem

Every task uses Claude via CLI subscription. Simple formatting and complex architecture decisions get the same heavyweight treatment.

## Proposed Solution

Route tasks to appropriate models based on complexity:
- Trivial tasks → cheap/fast models (DeepSeek, Haiku)
- Complex reasoning → Claude Opus
- Simple checks → local WASM models

## Value

- 10x more work at same cost
- Faster turnaround on simple tasks
- Premium reasoning preserved for what matters

## Effort

Large (requires model routing infrastructure)

## Status

Proposed. Not implemented. Flow's task complexity estimator (`lib/agents/task-complexity-estimator.ts`) already scores tasks 1-10, which could serve as the routing signal.
