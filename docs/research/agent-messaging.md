# Agent Messaging System

> Research on inter-worker communication to enable coordinated multi-worker outcomes.

## Source Material

- [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) (1.6k stars) — Agent messaging via MCP

## Problem

Ralph workers operate in isolation. Two workers on the same outcome can't share discoveries, coordinate on files, or avoid duplicate work.

## Proposed Solution

Implement an inbox/messaging system between workers. Workers can send messages, share findings, and reserve files to prevent conflicts.

## Value

- Complex outcomes can have multiple coordinated workers
- Discoveries compound instead of getting lost
- File conflicts become impossible
- Human can message workers directly

## Effort

Medium

## Status

Proposed. Not implemented. Partially addressed by HOMR's cross-worker observation system, which shares discoveries between tasks — but workers can't actively communicate with each other in real-time.
