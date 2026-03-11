# MCP Integration for Ralph Workers

> Research on adding Model Context Protocol servers to Ralph workers for expanded capabilities.

## Source Material

- [MCP Server Fetch](https://github.com/anthropics/claude-code) — Official Anthropic web fetch
- [llm_gateway_mcp_server](https://github.com/Dicklesworthstone/llm_gateway_mcp_server) (135 stars) — Comprehensive MCP gateway
- [ROADMAP-NEXT.md](../ROADMAP-NEXT.md) — Tiered MCP analysis

## Problem

Ralph workers can only access the local filesystem and run shell commands. They can't browse the web, query databases, or access external APIs without custom tool-building for each capability.

**Current workaround:** The skill-builder creates TypeScript tools that make HTTP calls (e.g., a tool that calls the Serper API). Workers run these via `npx ts-node`. This works but is brittle — workers must manually invoke tools, parse output, and handle errors.

## Proposed Solution

Configure MCP servers for Ralph workers. MCP tools appear as first-class capabilities that Claude can call directly, like Read/Write/Bash.

Two approaches:
1. **Global MCP** — Configure in `~/.claude.json`, all Ralph workers get the capability
2. **Per-outcome MCP** — Pass MCP config when spawning workers (more complex)

Start with global `mcp-server-fetch` for web research capability.

## Value

- Workers can research the web autonomously
- Browser automation becomes possible (Playwright MCP)
- Database queries, vector search, etc. become native capabilities
- Reduces need for custom tool-building for common capabilities

## Effort

Small (for basic fetch) / Medium (for full MCP gateway)

## High-Value MCPs (Tiered)

### Tier 1: Core Capability Expansion
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Playwright MCP** | Browser automation, fill forms, screenshot | WebFetch can't handle JS-heavy sites, login flows |
| **PostgreSQL/MySQL MCP** | Direct database queries | Structured queries vs parsing API responses |
| **Vector DB MCP** | Semantic search (local: sqlite-vss + Ollama) | Foundation for cross-outcome memory |
| **Exa API MCP** | Better web search than default | More relevant results, better for research tasks |

### Tier 2: Communication & Output
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Email MCP** | Send/receive emails | Workers email completion reports, alerts |
| **Google Slides MCP** | Create/edit presentations | Auto-generate pitch decks, research presentations |
| **Google Drive MCP** | Read/write files to Drive | Share outputs directly to cloud storage |

### Tier 3: Social & External
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Twitter/X MCP** | Post tweets, read timeline | Content distribution, market signals |
| **Notion MCP** | Read/write Notion pages | Sync outcomes to Notion workspace |
| **GitHub MCP** | Rich repo operations | Better than raw gh CLI for complex operations |

### Tier 4: Creative & Specialized
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Image Generation MCP** | DALL-E, Midjourney, Stable Diffusion | Create assets for outcomes |
| **Calendar MCP** | Check availability, schedule | Workers could schedule reviews |
| **Financial Data MCP** | Stock data, financial APIs | Advanced financial analysis outcomes |
| **PDF Generation MCP** | Create professional PDFs | Reports, proposals, contracts |

### 10 Not-So-Obvious MCPs
1. **Airtable MCP** — Workers manage databases without SQL
2. **Zapier/Make MCP** — Trigger automations in other tools
3. **Figma MCP** — Read designs, extract specs, generate code from designs
4. **Stripe MCP** — Check payments, create invoices
5. **HubSpot/Salesforce MCP** — CRM operations
6. **Jira/Linear MCP** — Project management integration
7. **Slack MCP** — Send messages, read discussions
8. **YouTube MCP** — Upload videos, pull transcripts
9. **Whisper MCP** — Transcribe audio/video files locally
10. **OCR/Document MCP** — Extract text from images, PDFs, scanned docs

## Implementation Approach

**Phase 1: Core MCPs**
- Add MCP configuration to Ralph worker spawn
- Test with mcp-server-fetch (already available)
- Add Playwright MCP for browser automation
- Add local vector DB MCP (sqlite-vss)

**Phase 2: Communication MCPs**
- Email MCP (Gmail or SMTP)
- Google Drive MCP
- Google Slides MCP

**Phase 3: Optional MCPs**
- User-configurable MCP list per outcome
- MCP marketplace/registry

## Open Questions

- Global MCP config vs per-outcome MCP config?
- How to handle MCP authentication (API keys)?
- Should outcomes declare required MCPs in their approach?

## Status

Proposed. Design exists in ROADMAP-NEXT.md, not implemented.
