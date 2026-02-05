# Next Features Roadmap - Working Document

> Sequential feature planning document. Work through each section, update status, then create outcomes.

**Last Updated:** 2026-02-05

---

## Overview

| Feature | Status | Notes |
|---------|--------|-------|
| 1. MCP Integration | 🟡 Needs refinement | Design exists, not implemented |
| 2. Project Analyzer Agent | 🔴 Needs design | Not started |
| 3. Conversational API | ✅ **IMPLEMENTED** | `/api/converse` + sessions + intent classification |
| 4. Cross-Outcome Memory | ✅ **IMPLEMENTED** | Core system complete, task injection pending |
| 5. Workspace Isolation | ✅ **IMPLEMENTED** | Schema, CLI flags, Settings UI, Worker enforcement |
| 6. Retro Tools in Converse | ✅ **IMPLEMENTED** | 5 tools added to converse agent |

---

## 1. MCP Integration

### What Workers Already Have
- **WebFetch** - Fetch and analyze web pages (built into Claude Code)
- **WebSearch** - Search the web (built into Claude Code)
- **Bash** - Can run curl, wget, etc.

### High-Value MCPs to Add

#### Tier 1: Core Capability Expansion
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Playwright MCP** | Browser automation, fill forms, screenshot | WebFetch can't handle JS-heavy sites, login flows |
| **PostgreSQL/MySQL MCP** | Direct database queries | Structured queries vs parsing API responses |
| **Vector DB MCP** | Semantic search (local: sqlite-vss + Ollama) | Foundation for cross-outcome memory |
| **Exa API MCP** | Better web search than default | More relevant results, better for research tasks |

#### Tier 2: Communication & Output
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Email MCP** | Send/receive emails | Workers email completion reports, alerts |
| **Google Slides MCP** | Create/edit presentations | Auto-generate pitch decks, research presentations |
| **Google Drive MCP** | Read/write files to Drive | Share outputs directly to cloud storage |

#### Tier 3: Social & External
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Twitter/X MCP** | Post tweets, read timeline | Content distribution, market signals |
| **Notion MCP** | Read/write Notion pages | Sync outcomes to Notion workspace |
| **GitHub MCP** | Rich repo operations | Better than raw gh CLI for complex operations |

#### Tier 4: Creative & Specialized
| MCP | Purpose | Why It Matters |
|-----|---------|----------------|
| **Image Generation MCP** | DALL-E, Midjourney, Stable Diffusion | Create assets for outcomes |
| **Calendar MCP** | Check availability, schedule | Workers could schedule reviews |
| **Financial Data MCP** | Stock data, financial APIs | Advanced financial analysis outcomes |
| **PDF Generation MCP** | Create professional PDFs | Reports, proposals, contracts |

### 10 Not-So-Obvious MCPs

1. **Airtable MCP** - Workers manage databases without SQL, great for non-technical outcomes
2. **Zapier/Make MCP** - Trigger automations in other tools (connect to 1000s of apps)
3. **Figma MCP** - Read designs, extract specs, generate code from designs
4. **Stripe MCP** - Check payments, create invoices, financial operations
5. **HubSpot/Salesforce MCP** - CRM operations, lead management
6. **Jira/Linear MCP** - Project management integration, sync tasks
7. **Slack MCP** - Send messages to channels, read discussions for context
8. **YouTube MCP** - Upload videos, manage playlists, pull transcripts
9. **Whisper MCP** - Transcribe audio/video files locally
10. **OCR/Document MCP** - Extract text from images, PDFs, scanned docs

### Exa vs Default Web Search

| Feature | Claude's WebSearch | Exa API |
|---------|-------------------|---------|
| Result Quality | Good general search | Optimized for AI/semantic queries |
| Code Search | Basic | Excellent (finds code examples) |
| Recent Content | Good | Excellent (real-time indexing) |
| Research Papers | Basic | Excellent (semantic paper search) |
| Pricing | Included | Paid API (~$0.005/query) |
| Verdict | Good for general use | Better for research-heavy outcomes |

### Implementation Approach

**Phase 1: Core MCPs**
- [ ] Add MCP configuration to Ralph worker spawn
- [ ] Test with mcp-server-fetch (already available)
- [ ] Add Playwright MCP for browser automation
- [ ] Add local vector DB MCP (sqlite-vss)

**Phase 2: Communication MCPs**
- [ ] Email MCP (Gmail or SMTP)
- [ ] Google Drive MCP
- [ ] Google Slides MCP

**Phase 3: Optional MCPs**
- [ ] User-configurable MCP list per outcome
- [ ] MCP marketplace/registry

### Questions to Resolve
- [ ] Global MCP config vs per-outcome MCP config?
- [ ] How to handle MCP authentication (API keys)?
- [ ] Should outcomes declare required MCPs in their approach?

### Status: 🟡 Needs refinement on Phase 1 scope

---

## 2. Project Analyzer Agent

### Current Review System (What Exists)

The **Reviewer Agent** (`lib/agents/reviewer.ts`) does:
- Reviews **completed work** against PRD acceptance criteria
- Runs after tasks complete (every N iterations)
- Creates new tasks for issues found
- Tracks convergence (fewer issues = getting closer to done)

**What it does NOT do:**
- Analyze PRD quality before work starts
- Suggest improvements to the approach
- Navigate outcome trees (parent/child outcomes)
- Proactively identify gaps in planning
- Compare outcomes to identify overlaps/synergies

### What You Want: Project Analyzer

A **proactive planning agent** that:

1. **Analyzes PRD Quality**
   - Is the intent clear enough?
   - Are acceptance criteria measurable?
   - Are there implicit requirements that should be explicit?

2. **Evaluates Approach**
   - Does the approach address all intent items?
   - Are there skill gaps that need filling?
   - Is the tech stack appropriate for the requirements?

3. **Identifies Planning Gaps**
   - Missing tasks that should exist
   - Task dependencies that aren't captured
   - Unrealistic scope vs available capabilities

4. **Cross-Outcome Intelligence**
   - Navigate parent/child outcome relationships
   - Identify semantic overlaps between outcomes
   - Suggest consolidation or task sharing

5. **Success Probability Assessment**
   - Based on patterns from completed outcomes
   - Complexity estimation vs capability match
   - Risk factors (new tech, unclear requirements, etc.)

### Proposed Interface

```
┌─────────────────────────────────────────────────────────────┐
│  OUTCOME: Build Chrome Extension                             │
│                                                              │
│  [Analyze Project]  ← NEW BUTTON                            │
│                                                              │
│  ┌─ PROJECT ANALYSIS ──────────────────────────────────────┐│
│  │                                                          ││
│  │  Intent Quality: 🟡 Needs Work                          ││
│  │  • "Block distracting websites" - which websites?       ││
│  │  • No acceptance criteria for "distraction"             ││
│  │  • Suggestion: Define blocklist management UI           ││
│  │                                                          ││
│  │  Approach Gaps: 2 found                                 ││
│  │  • No plan for Chrome Web Store submission              ││
│  │  • Missing: How does user configure blocklist?          ││
│  │                                                          ││
│  │  Task Coverage: 🟢 Good                                 ││
│  │  • 12 tasks cover core functionality                    ││
│  │  • Missing: User onboarding flow                        ││
│  │                                                          ││
│  │  Success Probability: 78%                               ││
│  │  • Similar outcomes succeeded at this complexity        ││
│  │  • Risk: Chrome extension APIs can be tricky            ││
│  │                                                          ││
│  │  [Apply Suggestions] [Dismiss]                          ││
│  │                                                          ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Implementation Options

**Option A: Separate Agent**
- New `lib/agents/project-analyzer.ts`
- Called via button click
- Returns analysis + suggestions
- User approves changes

**Option B: Enhance Orchestrator**
- Add analysis phase before capability phase
- Automatic but shows results for approval
- More integrated workflow

**Option C: HOMЯ Extension**
- Add "planning analysis" to HOMЯ observer
- Runs when approach is optimized
- Suggestions become escalations if significant

### Questions to Resolve
- [ ] When should analysis run? (Manual button vs automatic)
- [ ] Should suggestions auto-apply or require approval?
- [ ] How deep should cross-outcome analysis go?
- [ ] What data do we need to train success probability?

### Status: 🔴 Needs design decisions

---

## 3. Conversational API

### Status: ✅ IMPLEMENTED

**Implementation Date:** 2026-02-04

### What's Built

#### `/api/converse` Endpoint (`app/api/converse/route.ts` - 1200+ lines)

- **POST /api/converse** - Multi-turn chat endpoint
- **GET /api/converse?session_id=** - Retrieve session info and history

#### Intent Classification (`lib/agents/intent-classifier.ts`)

Supports intent types:
- `create_outcome` - "Build me a landing page"
- `check_status` - "What's running?"
- `list_outcomes` / `show_outcome` - "Show my projects"
- `list_tasks` - "Show tasks for X"
- `start_worker` / `stop_worker` / `pause_worker` - Worker control
- `answer_escalation` / `show_escalations` - Escalation handling
- `iterate` - "Change the button to blue"
- `audit_outcome` / `review_outcome` - Quality checks
- `help` / `general_query`

#### Session Management (`lib/db/sessions.ts`)

- `conversation_sessions` table - Tracks active sessions with context
- `conversation_messages` table - Stores message history
- `buildEnrichedContext()` - Aggregates session state, intent history, entity references
- `updateSessionAfterClassification()` - Tracks intent history for disambiguation
- Pronoun/entity resolution - "start worker" after "show landing page" knows which outcome

#### CLI Integration

- `flow converse` / `flow talk` - REPL mode using local tool execution (not HTTP API)
- `lib/converse/` - Tool definitions and executor for CLI mode

### What's NOT Built Yet

1. **Telegram Bridge** - External client using `/api/converse`
2. **Session Expiration** - Sessions persist indefinitely (no cleanup)
3. **Message Summarization** - No auto-summarize for long conversations
4. **Web Chat UI** - No web-based chat interface (only CLI REPL)

---

## 4. Cross-Outcome Memory

### Status: ✅ CORE IMPLEMENTED

**Implementation Date:** 2026-02-04

### What's Built

#### Memory Database (`lib/db/memory.ts` - 1200+ lines)

Full CRUD operations for cross-outcome memories:
- **Memory types**: `fact`, `pattern`, `preference`, `decision`, `lesson`, `context`
- **Importance levels**: `low`, `medium`, `high`, `critical`
- **Confidence scores** and expiration tracking
- **Supersession** - mark old memories as superseded by newer ones
- **Access tracking** - `access_count`, `last_accessed_at`

#### BM25 Full-Text Search (FTS5)

- `memories_fts` virtual table for fast text search
- `searchMemoriesBM25()` - BM25 ranked search
- `searchMemoriesExactPhrase()` - Exact phrase matching
- `searchMemoriesByKeywords()` - Multi-keyword AND search
- `searchMemoriesAdvanced()` - Boolean queries (must/should/must-not)
- Auto-fallback to LIKE search if FTS5 unavailable

#### Embedding & Vector Search (`lib/embedding/`)

- `lib/embedding/ollama.ts` - Ollama integration for embeddings
- `lib/embedding/hybrid-search.ts` - Combined BM25 + vector search
- `lib/db/memory-vss.ts` - sqlite-vss vector extension support
- `searchMemoriesHybrid()` - Multi-source retrieval with dedup
- `searchMemoriesVector()` - Pure vector similarity search

#### Query Expansion (`lib/embedding/query-expansion.ts`)

- `expandQuery()` - Expand to 5+ related queries via Claude
- `shouldExpandQuery()` - Determine if expansion is needed
- `searchMemoriesExpanded()` - Search with auto-expansion

#### Tag System

- `memory_tags` table with usage counts
- `memory_tag_links` for many-to-many
- `getMemoriesByTag()`, `getMemoriesByTags()` (AND logic)

#### Association System

- `memory_associations` table - Link memories to outcomes/tasks/other memories
- Association types: `relevant_to_outcome`, `relevant_to_task`, `supersedes`, etc.
- `getMemoriesForOutcome()`, `getMemoriesForTask()`

#### Retrieval Logging

- `memory_retrievals` table - Track when memories are shown
- `logRetrieval()` - Record with method, query, relevance score
- `markRetrievalUsefulness()` - +1/-1 feedback
- `getRetrievalStatsForMemory()` - Usage analytics

### What's NOT Built Yet

1. **Task Claim Injection** - Steerer doesn't auto-inject memories at task claim time
2. **HOMЯ Discovery Indexing** - Observations not automatically indexed as memories
3. **Graph-Based Retrieval** - Code import/dependency graph not implemented
4. **Memory API Endpoints** - No `/api/memory/` routes for UI
5. **Memory UI** - No web interface for browsing/managing memories

### Implementation Checklist Update

**Phase 1: Core Infrastructure** ✅ COMPLETE
- [x] Ollama setup with nomic-embed-text
- [x] sqlite-vss extension integration
- [x] FTS5 table for BM25 search
- [x] Memory service with basic search

**Phase 2: Enhanced Retrieval** ✅ MOSTLY COMPLETE
- [x] Query expansion via Claude
- [x] Multi-source search with dedup
- [ ] Steerer integration (task claim injection) ← **NEXT**
- [ ] Chat/iterate integration

**Phase 3: Feedback & Learning** 🟡 PARTIAL
- [x] Usage tracking infrastructure
- [ ] Index existing HOMЯ discoveries
- [ ] Memory pruning for unhelpful

**Phase 4: Advanced (Future)**
- [ ] Graph-based code retrieval
- [ ] Episodic memory from progress compaction
- [ ] Task output learning extraction

### Full Vision Doc
See: [docs/vision/MEMORY.md](./vision/MEMORY.md)

---

## Working Through This Document

### Process

1. **Read current section** - Understand what's designed/missing
2. **Discuss with user** - Resolve open questions
3. **Update this doc** - Mark questions resolved, add decisions
4. **When ready** - Create outcome with `flow new` or web UI
5. **Move to next section**

### Current Focus

**Completed:**
- ✅ Cross-Outcome Memory (core system built)
- ✅ Conversational API (`/api/converse` + CLI converse mode)
- ✅ Retro Tools in Converse (5 tools added)
- ✅ Workspace Isolation (schema, CLI, UI, worker enforcement)

**Next Up:**
- Memory Task Injection (wire existing memory system to steerer)
- HOMЯ Discovery Indexing (auto-index observations as memories)
- Project Analyzer Agent (new capability)
- MCP Integration (can be done incrementally)
- Telegram Bridge (external client for `/api/converse`)

---

## Decisions Log

| Date | Feature | Decision | Rationale |
|------|---------|----------|-----------|
| 2026-02-04 | Cross-Outcome Memory | Must be 100% local | Insights are valuable, no data leakage |
| 2026-02-04 | Cross-Outcome Memory | Use Ollama + sqlite-vss | Free, runs on Mac, good quality |
| 2026-02-04 | Cross-Outcome Memory | Three retrieval sources (Vector + BM25 + Graph) | James's approach: catches semantic, exact, and code context |
| 2026-02-04 | Cross-Outcome Memory | Query expansion to 5 queries | Better recall for related concepts |
| 2026-02-04 | Cross-Outcome Memory | Max 5 memories per injection | Context window limits |
| 2026-02-04 | Cross-Outcome Memory | 0.7 minimum similarity threshold | Quality over quantity |
| 2026-02-04 | Cross-Outcome Memory | Show conflicting memories with dates | Let worker decide, don't hide context |
| 2026-02-04 | Cross-Outcome Memory | Never expire, track usefulness (+1/-1) | Natural pruning via feedback loop |
| 2026-02-04 | Cross-Outcome Memory | Multiple injection points | Task claim + chat/iterate + planning |
| 2026-02-04 | Cross-Outcome Memory | Start with HOMЯ discoveries only | Proven data source, add task outputs later |
| 2026-02-05 | Retro Tools | Add 5 retro tools to converse mode | Feature parity with CLI for retrospective analysis |
| 2026-02-05 | Roadmap | Audit implementation status | Found Memory + Converse API + Workspace Isolation were built but not documented |

---

## Next Steps (Priority Order)

1. **Memory Task Injection** - Wire steerer to inject memories at task claim time
2. **HOMЯ Discovery Indexing** - Auto-index observations as memories
3. **Telegram Bridge** - External client using `/api/converse`
4. **Project Analyzer Agent** - Proactive planning analysis
5. **MCP Integration** - Phase 1 (Playwright, local vector DB)

---

*Update this document as we work through each feature.*
