# Cross-Outcome Memory: Vision Document

> Workers learn from ALL outcomes, not just their current one. Memory lives outside Claude.md and is injected per-task at runtime.

**Status:** ✅ Complete - Fully Implemented
**Last Updated:** 2026-02-04

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Memory database schema | ✅ Complete | SQLite with FTS5 |
| BM25 text search | ✅ Complete | Fast keyword matching |
| Vector search | ✅ Complete | Ollama + nomic-embed-text |
| Hybrid search | ✅ Complete | Combined BM25 + Vector |
| Query expansion | ✅ Complete | Claude-powered expansion |
| Memory service API | ✅ Complete | Full CRUD + search |
| Steerer integration | ✅ Complete | Injection at task claim |
| REST API endpoints | ✅ Complete | /api/memory/* |
| Feedback loop | ✅ Complete | Usefulness tracking |
| Migration script | ✅ Complete | HOMЯ discoveries indexed |
| Graph RAG | 🔮 Future | Phase 4 feature |

---

## Executive Summary

Cross-Outcome Memory enables workers to leverage learnings from past outcomes when working on new tasks. Instead of bloating CLAUDE.md files with accumulated knowledge, we maintain a separate memory layer that injects relevant learnings at runtime based on task context.

**Key Insight (James Phoenix):**
> "Rather than stuff Claude MD, I want you to think of like having your memory outside of Claude MD. And then when you do a task, you inject a piece of memory for that specific run for that specific task rather than bloating out the claude.md files."

---

## Constraints

**Must be 100% Local**
- No external APIs for embeddings or storage
- No cloud services
- Insights are valuable intellectual property and must not leak
- Runs entirely on Mac Mini / local machine

---

## Architecture

### The Three Retrieval Sources

Following James's proven approach, we use three complementary retrieval methods:

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEMORY RETRIEVAL STACK                        │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  VECTOR SEARCH  │  │  BM25 TEXT      │  │  GRAPH RAG      │  │
│  │  (Semantic)     │  │  (Exact Match)  │  │  (Code Context) │  │
│  │                 │  │                 │  │                 │  │
│  │  Ollama +       │  │  SQLite FTS5    │  │  File imports   │  │
│  │  nomic-embed    │  │  built-in       │  │  & references   │  │
│  │  768 dimensions │  │                 │  │                 │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                  │
│                        ┌───────▼───────┐                         │
│                        │   DEDUP &     │                         │
│                        │   RE-RANK     │                         │
│                        └───────┬───────┘                         │
│                                │                                  │
│                        ┌───────▼───────┐                         │
│                        │   TOP 5       │                         │
│                        │   MEMORIES    │                         │
│                        └───────────────┘                         │
│                                                                  │
│  Cost: $0  |  Runs on Mac  |  No external calls                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why Three Sources?

| Source | Catches | Example |
|--------|---------|---------|
| **Vector Search** | Semantically similar concepts | "authentication" finds "JWT tokens", "login flow", "session management" |
| **BM25 Text** | Exact phrases and terms | "bcrypt 12 rounds" finds exactly that phrase |
| **Graph RAG** | Code relationships | Editing `auth.ts` finds learnings from files that import it |

---

## Query Expansion

Before searching, we expand the query to find related concepts:

```typescript
// Original task: "Implement user authentication"
// Expanded queries:
[
  "user authentication",
  "login implementation patterns",
  "session management approaches",
  "security best practices auth",
  "JWT token handling"
]
```

Each expanded query runs against all three retrieval sources, results are deduplicated and re-ranked.

---

## Memory Sources

### Phase 1: HOMЯ Discoveries (Initial)

Index existing discoveries from HOMЯ Protocol:

| Type | Example |
|------|---------|
| **Pattern** | "Always use bcrypt with 12+ rounds for password hashing" |
| **Constraint** | "SQLite has 999 variable limit in queries" |
| **Insight** | "Users prefer email magic links over password reset" |
| **Blocker** | "Third-party API rate limits to 100 req/min" |

### Phase 2: Task Output Learnings (Future)

Extract learnings from completed tasks:
- Error patterns and solutions
- Successful approaches
- Key decisions made

### Phase 3: Episodic Memory (Future)

Compact progress over time:
- "What happened last time we tried X?"
- Summarized iteration history
- Cross-session context

---

## Injection Points

Memory is injected at multiple points in the system:

### 1. Task Claim Time (Primary)

When a worker claims a task:

```
Worker claims: "Implement user authentication"
       │
       ▼
Memory service queries with task context
       │
       ▼
Finds 3 relevant memories:
  - "JWT with refresh tokens preferred" (out_abc, +12 helpful)
  - "Always hash passwords with bcrypt 12+" (out_def, +8 helpful)
  - "Rate limit auth endpoints 5/min" (out_ghi, +5 helpful)
       │
       ▼
Injected into worker's context via steerer
```

### 2. Chat/Iterate Endpoint

When user rambles into the outcome chat box:

```
User: "I want to add social login with Google"
       │
       ▼
Memory search: "social login Google OAuth"
       │
       ▼
Relevant memories injected into Claude response context
```

### 3. Planning Phases

During capability planning and approach optimization:
- What skills worked well for similar outcomes?
- What tools were needed?
- What patterns should we follow?

---

## Configuration

### Retrieval Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Max memories per injection | 5 | Context window limits |
| Minimum similarity threshold | 0.7 | Quality over quantity |
| Query expansion count | 5 | Balance coverage vs noise |
| BM25 weight | 0.3 | Boost exact matches |
| Vector weight | 0.5 | Primary semantic search |
| Graph weight | 0.2 | Code context bonus |

### Conflict Resolution

When memories conflict (different outcomes decided differently):

**Show both with dates, let worker decide:**
```markdown
## Relevant Memories

**Authentication approach** (conflicting):
- out_abc (2026-01-15): "Used JWT with 24h expiry"
- out_xyz (2026-02-01): "Switched to session cookies for better security"

Consider: Session cookies are more recent, may reflect updated best practices.
```

### Expiration Policy

**Never expire, track usefulness instead:**
- Memories accumulate +1 when worker marks as helpful
- Memories accumulate -1 when marked unhelpful
- Low-score memories sink in rankings naturally
- Periodic pruning of consistently unhelpful memories (score < -5)

---

## Database Schema

### Core Tables

```sql
-- Main memory storage with embeddings
CREATE TABLE memory_embeddings (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,        -- 'discovery' | 'task_output' | 'episodic'
  source_id TEXT,                   -- ID in source table (e.g., discovery ID)
  outcome_id TEXT,                  -- Which outcome it came from
  content TEXT NOT NULL,            -- The actual learning text
  embedding BLOB,                   -- Vector (768 floats from nomic-embed)
  helpfulness_score INTEGER DEFAULT 0,  -- +1/-1 tracking
  times_shown INTEGER DEFAULT 0,    -- How often injected
  times_helpful INTEGER DEFAULT 0,  -- How often marked helpful
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- sqlite-vss virtual table for fast similarity search
CREATE VIRTUAL TABLE memory_vss USING vss0(
  embedding(768)
);

-- FTS5 table for BM25 text search
CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  source_type,
  outcome_id,
  content='memory_embeddings',
  content_rowid='rowid'
);

-- Code relationship graph for graph-based retrieval
CREATE TABLE code_graph (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  imports JSON,                     -- Files this file imports
  imported_by JSON,                 -- Files that import this file
  outcome_id TEXT,
  updated_at INTEGER NOT NULL
);

-- Memory usage tracking for feedback loop
CREATE TABLE memory_usage (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_embeddings(id),
  task_id TEXT,
  worker_id TEXT,
  outcome_id TEXT,
  was_helpful BOOLEAN,              -- User/worker feedback
  context TEXT,                     -- Why it was/wasn't helpful
  created_at INTEGER NOT NULL
);

-- Episodic memory from compacted progress
CREATE TABLE episodic_memories (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  summary TEXT NOT NULL,            -- Compacted progress summary
  key_learnings JSON,               -- Extracted learnings array
  embedding BLOB,
  created_at INTEGER NOT NULL
);
```

### Indexes

```sql
CREATE INDEX idx_memory_outcome ON memory_embeddings(outcome_id);
CREATE INDEX idx_memory_source ON memory_embeddings(source_type, source_id);
CREATE INDEX idx_memory_score ON memory_embeddings(helpfulness_score DESC);
CREATE INDEX idx_code_graph_file ON code_graph(file_path);
CREATE INDEX idx_memory_usage_memory ON memory_usage(memory_id);
```

---

## API Design

### Memory Service Interface

```typescript
interface MemoryService {
  // Indexing
  indexDiscovery(discovery: HomrDiscovery): Promise<string>;
  indexTaskOutput(taskId: string, learnings: string[]): Promise<string[]>;
  indexEpisodicMemory(outcomeId: string, summary: string): Promise<string>;

  // Retrieval
  searchMemories(query: string, options?: SearchOptions): Promise<Memory[]>;
  getMemoriesForTask(task: Task): Promise<Memory[]>;
  getMemoriesForChat(message: string, outcomeId?: string): Promise<Memory[]>;

  // Feedback
  recordUsage(memoryId: string, taskId: string, wasHelpful: boolean): Promise<void>;

  // Maintenance
  pruneUnhelpfulMemories(threshold: number): Promise<number>;
  reindexOutcome(outcomeId: string): Promise<void>;
}

interface SearchOptions {
  maxResults?: number;           // Default: 5
  minSimilarity?: number;        // Default: 0.7
  excludeOutcomes?: string[];    // Don't search these outcomes
  sourceTypes?: string[];        // Filter by source type
  expandQueries?: boolean;       // Default: true
}

interface Memory {
  id: string;
  content: string;
  sourceType: 'discovery' | 'task_output' | 'episodic';
  outcomeId: string;
  outcomeName?: string;
  similarity: number;
  helpfulnessScore: number;
  createdAt: number;
}
```

### REST Endpoints

```typescript
// Search memories
GET /api/memory/search?q={query}&max={n}&outcome={id}

// Get memories for a task
GET /api/memory/task/{taskId}

// Record feedback
POST /api/memory/{memoryId}/feedback
{ "taskId": "...", "wasHelpful": true }

// Reindex an outcome's discoveries
POST /api/memory/reindex/{outcomeId}

// Admin: prune unhelpful memories
POST /api/memory/prune
{ "threshold": -5 }
```

---

## Integration Points

### 1. Steerer Integration

The steerer already injects context into workers. Add memory injection:

```typescript
// lib/homr/steerer.ts
async function steerTask(task: Task, worker: Worker): Promise<SteerResult> {
  // Existing context gathering...

  // NEW: Get relevant memories
  const memories = await memoryService.getMemoriesForTask(task);

  // Inject into CLAUDE.md context
  if (memories.length > 0) {
    const memorySection = formatMemoriesForContext(memories);
    await injectIntoContext(worker, memorySection);
  }

  // Continue with existing steering...
}
```

### 2. Observer Integration

After task completion, extract learnings:

```typescript
// lib/homr/observer.ts
async function observeTaskCompletion(task: Task, output: string): Promise<void> {
  // Existing observation logic...

  // NEW: Extract and index learnings
  const learnings = await extractLearnings(task, output);
  if (learnings.length > 0) {
    await memoryService.indexTaskOutput(task.id, learnings);
  }
}
```

### 3. Chat Endpoint Integration

```typescript
// app/api/outcomes/[id]/chat/route.ts
async function handleChat(outcomeId: string, message: string): Promise<Response> {
  // Get relevant memories for this message
  const memories = await memoryService.getMemoriesForChat(message, outcomeId);

  // Include in Claude context
  const systemContext = memories.length > 0
    ? `\n\nRelevant learnings from past work:\n${formatMemories(memories)}`
    : '';

  // Continue with chat handling...
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)

1. **Ollama Setup**
   - Install Ollama with nomic-embed-text model
   - Create embedding service wrapper
   - Test embedding generation

2. **Database Schema**
   - Add memory tables to schema
   - Set up sqlite-vss extension
   - Set up FTS5 tables
   - Create indexes

3. **Basic Memory Service**
   - Implement indexDiscovery()
   - Implement basic searchMemories() (vector only)
   - Unit tests

### Phase 2: Enhanced Retrieval (Week 2)

4. **BM25 Search**
   - Implement FTS5 search
   - Combine with vector search
   - Deduplication logic

5. **Query Expansion**
   - Implement expansion via Claude
   - Multi-query search
   - Result merging

6. **Steerer Integration**
   - Inject memories at task claim
   - Format memories for context
   - Integration tests

### Phase 3: Feedback & Learning (Week 3)

7. **Usage Tracking**
   - Record when memories are shown
   - UI for marking helpful/unhelpful
   - Score updates

8. **Index Existing Discoveries**
   - Migration script for HOMЯ discoveries
   - Batch embedding generation
   - Verification

9. **Chat Integration**
   - Memory injection in chat endpoint
   - Planning phase integration

### Phase 4: Advanced Features (Future)

10. **Graph-Based Retrieval**
    - Code relationship indexing
    - Import/export graph
    - Hop-based memory retrieval

11. **Episodic Memory**
    - Progress compaction
    - Episode summarization
    - Cross-session context

12. **Task Output Learning**
    - Automatic learning extraction
    - Quality filtering
    - Deduplication with existing

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Memory retrieval latency | < 200ms | API timing |
| Relevant memories found | > 70% of tasks | Worker feedback |
| Helpfulness rate | > 60% helpful | Usage tracking |
| Context size impact | < 2000 tokens | Token counting |
| Index size | < 100MB for 1000 outcomes | Database size |

---

## Dependencies

### Required
- **Ollama** - Local embedding generation
- **sqlite-vss** - Vector similarity search extension
- **SQLite FTS5** - Built into SQLite, no extra dependency

### Installation

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull embedding model
ollama pull nomic-embed-text

# sqlite-vss is loaded as SQLite extension
# Bundled with the project
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Ollama not installed | Graceful degradation, BM25-only search |
| Memory index too large | Pruning unhelpful memories, archiving old |
| Irrelevant memories injected | Minimum similarity threshold, feedback loop |
| Conflicting memories confuse worker | Show both with dates, let worker decide |
| Embedding model changes | Store model version, re-embed on change |

---

## References

- James Phoenix call transcripts (james-call-2.txt, james-call-3.txt)
- [Guided Quick Markdown Search](https://example.com) - Query expansion pattern
- HOMЯ Protocol (docs/homr/VISION.md) - Discovery system we're building on
- [sqlite-vss](https://github.com/asg017/sqlite-vss) - Vector search extension

---

*This document defines the vision for Cross-Outcome Memory. For implementation details, see the outcome tasks.*
