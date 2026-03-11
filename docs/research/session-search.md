# Cross-Outcome Session Search

> Research on indexing and searching across all past worker outputs for institutional memory.

## Source Material

- [coding_agent_session_search](https://github.com/Dicklesworthstone/coding_agent_session_search) (398 stars) — Session search for coding agents

## Problem

Each outcome is an island. Lessons learned, patterns discovered, and solutions developed stay trapped in that outcome's history.

## Proposed Solution

Index all worker outputs and progress logs. Provide semantic search across all past work. Workers can query "how did we handle X before?"

## Value

- Past work accelerates future work
- Patterns emerge from history
- New outcomes start with relevant context
- System gets smarter with every completed outcome

## Effort

Large

## Current Status

Partially addressed. The cross-outcome memory system (`lib/db/memory.ts`) with BM25 + vector search provides some of this capability. HOMR discoveries are promoted to memories and retrieved globally by the steerer. However, raw worker session outputs and progress logs are not indexed — only structured discoveries extracted by the observer.

## Remaining Gap

Full-text search across raw worker outputs (`progress_entries.full_output`) is not implemented. This would enable "how did we handle X before?" queries against the actual implementation work, not just the extracted observations.
