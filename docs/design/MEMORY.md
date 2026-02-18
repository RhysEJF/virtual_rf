# Cross-Outcome Memory - Design

> Implementation details for the Cross-Outcome Memory system.

---

## Architecture

### Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Storage | SQLite (better-sqlite3) | Memory persistence |
| Text Search | FTS5 (SQLite built-in) | BM25 keyword search |
| Vector Search | Ollama + nomic-embed-text | Semantic similarity |
| Service Layer | TypeScript | Unified API |

### Directory Structure

```
lib/
├── memory/
│   └── index.ts              # Main service (900+ lines)
├── embedding/
│   ├── ollama.ts             # Embedding generation
│   ├── hybrid-search.ts      # Vector + BM25 combined
│   └── query-expansion.ts    # Claude-powered expansion
└── db/
    └── memory.ts             # Database operations

app/api/memory/
├── search/route.ts           # POST /api/memory/search
└── [id]/feedback/route.ts    # POST /api/memory/{id}/feedback

scripts/
├── generate-embeddings.ts    # Batch embedding generation
└── migrate-discoveries-to-memories.ts  # HOMЯ migration
```

---

## Database Schema

### Core Tables

```sql
-- Main memory storage
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'pattern' | 'constraint' | 'blocker' | etc.
  importance TEXT DEFAULT 'medium', -- 'critical' | 'high' | 'medium' | 'low'
  source TEXT DEFAULT 'system',     -- 'homr_discovery' | 'task_output' | etc.
  source_outcome_id TEXT,
  source_task_id TEXT,
  tags TEXT DEFAULT '[]',           -- JSON array
  embedding TEXT,                   -- JSON array of floats (768 dimensions)
  access_count INTEGER DEFAULT 0,
  times_shown INTEGER DEFAULT 0,
  times_helpful INTEGER DEFAULT 0,
  helpfulness_score INTEGER DEFAULT 0,
  last_accessed_at INTEGER,
  confidence REAL DEFAULT 0.8,
  expires_at INTEGER,
  superseded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- FTS5 virtual table for BM25 search
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  tags,
  content='memories',
  content_rowid='rowid'
);

-- Memory tags
CREATE TABLE memory_tags (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  usage_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Tag links
CREATE TABLE memory_tag_links (
  memory_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag_id)
);

-- Associations (memory ↔ outcome/task)
CREATE TABLE memory_associations (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  association_type TEXT NOT NULL,  -- 'relevant_to_outcome' | 'relevant_to_task'
  target_id TEXT NOT NULL,
  strength REAL DEFAULT 0.5,
  context TEXT,
  created_at INTEGER NOT NULL
);

-- Retrieval logging for feedback loop
CREATE TABLE memory_retrievals (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  outcome_id TEXT,
  task_id TEXT,
  retrieval_method TEXT NOT NULL,  -- 'semantic' | 'keyword' | 'tag'
  query TEXT,
  relevance_score REAL,
  was_useful INTEGER,
  created_at INTEGER NOT NULL
);
```

### Indexes

```sql
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance);
CREATE INDEX idx_memories_source_outcome ON memories(source_outcome_id);
CREATE INDEX idx_memories_created ON memories(created_at DESC);
CREATE INDEX idx_memory_assoc_memory ON memory_associations(memory_id);
CREATE INDEX idx_memory_assoc_target ON memory_associations(target_id);
```

---

## Memory Service API

### TypeScript Interface

```typescript
import { memoryService } from '@/lib/memory';

// Store a memory
const memory = await memoryService.store({
  content: 'Always validate input at API boundaries',
  type: 'pattern',
  importance: 'high',
  tags: ['api', 'validation', 'security'],
});

// Search memories
const results = await memoryService.search({
  query: 'input validation',
  strategy: 'hybrid',  // 'bm25' | 'vector' | 'hybrid' | 'expanded'
  limit: 10,
});

// Get memories for a task
const relevant = await memoryService.getForTask(taskId);

// Mark retrieval as useful
memoryService.markUseful(retrievalId);
```

### Search Strategies

| Strategy | Method | When to Use |
|----------|--------|-------------|
| `bm25` | SQLite FTS5 | Fast keyword matching |
| `vector` | Ollama cosine similarity | Semantic similarity |
| `hybrid` | BM25 + Vector combined | Best of both (default) |
| `expanded` | Query expansion + Hybrid | Comprehensive search |

### Memory Types

```typescript
type MemoryType =
  | 'pattern'     // Recurring patterns discovered
  | 'constraint'  // Limitations or rules
  | 'blocker'     // Critical blockers
  | 'decision'    // Decisions made
  | 'insight'     // General learnings
  | 'lesson'      // Task-specific lessons
  | 'preference'  // User preferences
  | 'fact';       // Factual information
```

---

## REST API

### POST /api/memory/search

Search memories by query with vector similarity.

**Request:**
```json
{
  "query": "authentication patterns",
  "limit": 10,
  "minScore": 0.3
}
```

**Response:**
```json
{
  "results": [
    {
      "memoryId": "mem_abc123",
      "content": "Use JWT with refresh tokens for auth",
      "type": "pattern",
      "importance": "high",
      "similarity": 0.85,
      "tags": ["auth", "jwt", "security"]
    }
  ],
  "timing": {
    "totalMs": 245,
    "embeddingMs": 180,
    "searchMs": 65
  }
}
```

### POST /api/memory/{id}/feedback

Record whether a memory was useful.

**Request:**
```json
{
  "wasUseful": true,
  "context": "Helped solve auth issue"
}
```

---

## Steerer Integration

The steerer injects memories into worker context at task claim time.

### Integration Point

```typescript
// lib/homr/steerer.ts

export async function buildTaskContextAsync(
  taskId: string,
  outcomeId: string
): Promise<BuildTaskContextResult> {
  // 1. Get HOMЯ discoveries
  const discoveries = getDiscoveriesForTask(outcomeId, taskId);

  // 2. Get relevant memories (async)
  const memories = await getRelevantMemoriesForTaskAsync(taskId, outcomeId);

  // 3. Build context sections
  const homrSection = buildTaskContextSection(discoveries, decisions, constraints);
  const memorySection = buildMemoryContextSection(memories);

  // 4. Return combined context
  return {
    context: [homrSection, memorySection].join('\n'),
    timing: { ... },
    memoriesInjected: memories.length,
  };
}
```

### Memory Retrieval Flow

```
┌─────────────────────────────────────────────────────────┐
│                  TASK CLAIM TIME                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Worker claims task                                   │
│           │                                              │
│           ▼                                              │
│  2. Steerer builds context                               │
│           │                                              │
│           ├─► Get task-associated memories               │
│           │                                              │
│           ├─► Get outcome-associated memories            │
│           │                                              │
│           └─► Search by task title/description           │
│                    │                                     │
│                    ▼                                     │
│  3. Deduplicate and rank by importance                   │
│           │                                              │
│           ▼                                              │
│  4. Inject top 5 into CLAUDE.md                          │
│           │                                              │
│           ▼                                              │
│  5. Worker executes with memory context                  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Embedding Generation

### Ollama Configuration

```typescript
// lib/embedding/ollama.ts

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = 'nomic-embed-text';
const DIMENSIONS = 768;

export async function generateEmbedding(
  text: string
): Promise<EmbeddingResult> {
  const response = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });

  return { embedding: response.embedding };
}
```

### Batch Generation

```bash
# Generate embeddings for all memories without them
npx tsx scripts/generate-embeddings.ts
```

---

## Hybrid Search Algorithm

```typescript
// lib/embedding/hybrid-search.ts

export async function searchMemoriesHybrid(
  query: string,
  options: HybridSearchOptions
): Promise<HybridSearchResponse> {
  // 1. BM25 search (fast, keyword-based)
  const bm25Results = searchMemoriesBM25(query, options.limit * 2);

  // 2. Vector search (semantic)
  const embedding = await generateEmbedding(query);
  const vectorResults = searchMemoriesVector(embedding, options.limit * 2);

  // 3. Combine and deduplicate
  const combined = mergeResults(bm25Results, vectorResults);

  // 4. Re-rank by weighted score
  const ranked = combined.sort((a, b) => {
    const scoreA = (a.bm25Score * 0.3) + (a.vectorScore * 0.7);
    const scoreB = (b.bm25Score * 0.3) + (b.vectorScore * 0.7);
    return scoreB - scoreA;
  });

  return { results: ranked.slice(0, options.limit) };
}
```

---

## Migration Scripts

### Migrate HOMЯ Discoveries

```bash
npx tsx scripts/migrate-discoveries-to-memories.ts
```

This script:
1. Reads all `homr_context` entries with discoveries
2. Converts each discovery to a memory
3. Maps discovery types to memory types
4. Sets appropriate importance levels
5. Skips duplicates (idempotent)

### Generate Embeddings

```bash
npx tsx scripts/generate-embeddings.ts
```

Requires Ollama to be running with nomic-embed-text model.

---

## Performance

### Targets

| Operation | Target | Actual |
|-----------|--------|--------|
| BM25 search | <50ms | ~10ms |
| Vector search | <500ms | ~200ms |
| Hybrid search | <500ms | ~250ms |
| Context build | <500ms | ~300ms |

### Optimizations

- FTS5 for fast text search (no embedding needed)
- Embedding caching (stored in DB)
- Batch embedding generation
- Connection pooling (better-sqlite3)

---

## Dependencies

### Required

- `better-sqlite3` - SQLite with FTS5 support
- TypeScript - Type safety

### Optional

- Ollama - For vector embeddings
- `nomic-embed-text` - Embedding model (768 dimensions)

### Graceful Degradation

If Ollama is not available:
- Vector search returns empty results
- BM25 search still works
- System logs warning but doesn't fail

---

## Testing

### Health Check

```typescript
const health = await memoryService.checkHealth();
console.log(health.features);
// { database: true, fts5: true, embeddings: true }
```

### Manual Testing

```bash
# Test BM25 search
curl -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'

# Check memory stats
sqlite3 data/twin.db "SELECT COUNT(*) FROM memories;"
```

---

*For vision and purpose, see [docs/vision/MEMORY.md](../vision/MEMORY.md)*
