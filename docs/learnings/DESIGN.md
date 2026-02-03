# Persistent Learnings Layer: Design Document

> Technical architecture for cross-outcome memory with search, injection, and confidence evolution.

**Related Documents:**
- [VISION.md](./VISION.md) - Philosophy and user stories
- [../homr/DESIGN.md](../homr/DESIGN.md) - HOMЯ Protocol technical architecture

---

## Table of Contents

1. [Database Schema](#database-schema)
2. [COIA Format](#coia-format)
3. [Extraction Pipeline](#extraction-pipeline)
4. [Search System](#search-system)
5. [Injection Mechanics](#injection-mechanics)
6. [Feedback Loop](#feedback-loop)
7. [Confidence Algorithm](#confidence-algorithm)
8. [API Endpoints](#api-endpoints)
9. [Integration Points](#integration-points)
10. [File Structure](#file-structure)

---

## Database Schema

### Learnings Table

```sql
CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY,

  -- COIA Content
  title TEXT NOT NULL,
  context TEXT NOT NULL,           -- What were you working on?
  observation TEXT NOT NULL,       -- What did you notice?
  implication TEXT NOT NULL,       -- How should this change future work?
  action TEXT NOT NULL,            -- Specific change to make

  -- Metadata
  source_outcome_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  source_discovery_id TEXT,        -- Links back to HOMЯ discovery

  -- Classification
  tags TEXT DEFAULT '[]',          -- JSON array: ["oauth", "stripe", "authentication"]
  domain TEXT,                     -- e.g., "api-integration", "database", "ui"
  pattern_type TEXT,               -- "solution", "gotcha", "best-practice", "constraint"

  -- Confidence & Usage
  confidence REAL DEFAULT 0.5,     -- 0.0 - 1.0
  times_injected INTEGER DEFAULT 0,
  times_helpful INTEGER DEFAULT 0,
  times_not_helpful INTEGER DEFAULT 0,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_injected_at INTEGER,
  last_helpful_at INTEGER,

  -- Status
  status TEXT DEFAULT 'active',    -- 'active', 'archived', 'superseded'
  superseded_by TEXT,              -- ID of newer learning that replaces this

  FOREIGN KEY (source_outcome_id) REFERENCES outcomes(id)
);

-- Full-text search index for BM25
CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
  title,
  context,
  observation,
  implication,
  action,
  tags,
  content='learnings',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
  INSERT INTO learnings_fts(rowid, title, context, observation, implication, action, tags)
  VALUES (new.rowid, new.title, new.context, new.observation, new.implication, new.action, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
  INSERT INTO learnings_fts(learnings_fts, rowid, title, context, observation, implication, action, tags)
  VALUES ('delete', old.rowid, old.title, old.context, old.observation, old.implication, old.action, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
  INSERT INTO learnings_fts(learnings_fts, rowid, title, context, observation, implication, action, tags)
  VALUES ('delete', old.rowid, old.title, old.context, old.observation, old.implication, old.action, old.tags);
  INSERT INTO learnings_fts(rowid, title, context, observation, implication, action, tags)
  VALUES (new.rowid, new.title, new.context, new.observation, new.implication, new.action, new.tags);
END;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_learnings_confidence ON learnings(confidence);
CREATE INDEX IF NOT EXISTS idx_learnings_status ON learnings(status);
CREATE INDEX IF NOT EXISTS idx_learnings_domain ON learnings(domain);
CREATE INDEX IF NOT EXISTS idx_learnings_source_outcome ON learnings(source_outcome_id);
```

### Learning Injections Table

Track which learnings were injected into which tasks:

```sql
CREATE TABLE IF NOT EXISTS learning_injections (
  id TEXT PRIMARY KEY,
  learning_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  injected_at INTEGER NOT NULL,
  feedback TEXT,                   -- 'helpful', 'not_helpful', null
  feedback_at INTEGER,

  FOREIGN KEY (learning_id) REFERENCES learnings(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(id),
  UNIQUE(learning_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_injections_task ON learning_injections(task_id);
CREATE INDEX IF NOT EXISTS idx_learning_injections_learning ON learning_injections(learning_id);
```

---

## COIA Format

### TypeScript Interface

```typescript
interface Learning {
  id: string;

  // COIA Content
  title: string;           // Brief title (max 100 chars)
  context: string;         // What were you working on?
  observation: string;     // What did you notice?
  implication: string;     // How should this change future work?
  action: string;          // Specific change to make

  // Metadata
  source_outcome_id: string;
  source_task_id: string;
  source_discovery_id?: string;

  // Classification
  tags: string[];
  domain?: string;
  pattern_type: 'solution' | 'gotcha' | 'best-practice' | 'constraint';

  // Confidence & Usage
  confidence: number;      // 0.0 - 1.0
  times_injected: number;
  times_helpful: number;
  times_not_helpful: number;

  // Timestamps
  created_at: number;
  updated_at: number;
  last_injected_at?: number;
  last_helpful_at?: number;

  // Status
  status: 'active' | 'archived' | 'superseded';
  superseded_by?: string;
}

interface LearningInjection {
  id: string;
  learning_id: string;
  task_id: string;
  outcome_id: string;
  injected_at: number;
  feedback?: 'helpful' | 'not_helpful';
  feedback_at?: number;
}
```

### COIA Markdown Format

When injected into worker context:

```markdown
### [Title] [confidence: X.XX, used Nx]

**Context**: [What were you working on?]
**Observation**: [What did you notice?]
**Implication**: [How should this change future work?]
**Action**: [Specific change to make]

_ID: learn_abc123 | Source: outcome_xyz, 2 weeks ago_
```

---

## Extraction Pipeline

### When Extraction Happens

Learnings are extracted when:
1. HOMЯ Observer extracts a discovery from completed task
2. Human explicitly creates a learning via UI
3. Review agent identifies a recurring pattern

### Extraction from HOMЯ Discovery

```typescript
// lib/learnings/extract.ts

import { HomrDiscovery } from '../db/schema';
import { complete } from '../claude/client';

interface ExtractionResult {
  success: boolean;
  learning?: Omit<Learning, 'id' | 'created_at' | 'updated_at'>;
  skipped?: string;  // Reason if skipped
}

/**
 * Extract a learning from a HOMЯ discovery
 */
export async function extractLearningFromDiscovery(
  discovery: HomrDiscovery,
  taskContext: {
    taskId: string;
    taskTitle: string;
    outcomeId: string;
    outcomeName: string;
  }
): Promise<ExtractionResult> {

  // Skip certain discovery types that don't make good learnings
  if (discovery.type === 'dependency') {
    return { success: false, skipped: 'Dependencies are task-specific, not learnable' };
  }

  // Use Claude to convert discovery to COIA format
  const prompt = buildExtractionPrompt(discovery, taskContext);

  const response = await complete({
    system: 'You extract learnings from discoveries. Respond with valid JSON only.',
    prompt,
    maxTurns: 1,
    timeout: 30000,
  });

  if (!response.success || !response.text) {
    return { success: false, skipped: 'Extraction failed' };
  }

  const parsed = parseExtractionResponse(response.text);
  if (!parsed) {
    return { success: false, skipped: 'Failed to parse extraction response' };
  }

  // Assign initial confidence based on discovery type
  const confidence = getInitialConfidence(discovery.type);

  return {
    success: true,
    learning: {
      title: parsed.title,
      context: parsed.context,
      observation: parsed.observation,
      implication: parsed.implication,
      action: parsed.action,
      source_outcome_id: taskContext.outcomeId,
      source_task_id: taskContext.taskId,
      source_discovery_id: discovery.source,
      tags: parsed.tags || [],
      domain: parsed.domain,
      pattern_type: mapDiscoveryTypeToPattern(discovery.type),
      confidence,
      times_injected: 0,
      times_helpful: 0,
      times_not_helpful: 0,
      status: 'active',
    },
  };
}

function getInitialConfidence(discoveryType: string): number {
  const confidenceMap: Record<string, number> = {
    blocker: 0.7,      // Blockers are usually significant
    constraint: 0.6,   // Constraints are contextual but valuable
    pattern: 0.5,      // Patterns need validation
    decision: 0.5,     // Decisions may be outcome-specific
  };
  return confidenceMap[discoveryType] || 0.5;
}

function mapDiscoveryTypeToPattern(discoveryType: string): Learning['pattern_type'] {
  const mapping: Record<string, Learning['pattern_type']> = {
    blocker: 'gotcha',
    constraint: 'constraint',
    pattern: 'best-practice',
    decision: 'solution',
  };
  return mapping[discoveryType] || 'solution';
}
```

### Extraction Prompt

```typescript
function buildExtractionPrompt(
  discovery: HomrDiscovery,
  taskContext: { taskTitle: string; outcomeName: string }
): string {
  return `
Convert this discovery into a structured learning using the COIA format.

## Discovery
Type: ${discovery.type}
Content: ${discovery.content}
From task: ${taskContext.taskTitle}
From outcome: ${taskContext.outcomeName}

## Output Format
Respond with JSON:
{
  "title": "Brief title (max 100 chars) - what someone would search for",
  "context": "What were you working on? (1-2 sentences)",
  "observation": "What did you notice? The core insight. (1-3 sentences)",
  "implication": "How should this change future work? (1-2 sentences)",
  "action": "Specific change to make. Be concrete. (1-2 sentences)",
  "tags": ["tag1", "tag2"],  // 2-5 relevant tags for searchability
  "domain": "category"  // e.g., "api-integration", "database", "authentication", "ui", "testing"
}

## Guidelines
- Title should be what someone would search for when facing this problem
- Context should be general enough to apply across outcomes
- Observation should capture the core insight, not outcome-specific details
- Action should be concrete and actionable
- Tags should help with search - include technologies, concepts, problem types

Respond ONLY with valid JSON, no other text.
`;
}
```

---

## Search System

### BM25 Search (MVP)

```typescript
// lib/learnings/search.ts

interface SearchOptions {
  query: string;
  minConfidence?: number;      // Default: 0.5
  limit?: number;              // Default: 10
  excludeOutcomeId?: string;   // Optionally exclude current outcome
  domain?: string;             // Filter by domain
  status?: 'active' | 'all';   // Default: 'active'
}

interface SearchResult {
  learning: Learning;
  score: number;               // BM25 relevance score
  matchedFields: string[];     // Which fields matched
}

/**
 * Search learnings using BM25 full-text search
 */
export function searchLearnings(options: SearchOptions): SearchResult[] {
  const {
    query,
    minConfidence = 0.5,
    limit = 10,
    excludeOutcomeId,
    domain,
    status = 'active',
  } = options;

  const db = getDb();

  // Build FTS5 query
  // Escape special characters and add prefix matching
  const ftsQuery = query
    .split(/\s+/)
    .filter(term => term.length > 2)
    .map(term => `"${term}"*`)
    .join(' OR ');

  if (!ftsQuery) {
    return [];
  }

  let sql = `
    SELECT
      l.*,
      bm25(learnings_fts) as score,
      highlight(learnings_fts, 0, '<mark>', '</mark>') as title_highlight
    FROM learnings l
    JOIN learnings_fts ON l.rowid = learnings_fts.rowid
    WHERE learnings_fts MATCH ?
      AND l.confidence >= ?
  `;

  const params: (string | number)[] = [ftsQuery, minConfidence];

  if (status === 'active') {
    sql += ` AND l.status = 'active'`;
  }

  if (excludeOutcomeId) {
    sql += ` AND l.source_outcome_id != ?`;
    params.push(excludeOutcomeId);
  }

  if (domain) {
    sql += ` AND l.domain = ?`;
    params.push(domain);
  }

  sql += ` ORDER BY score, l.confidence DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as (Learning & { score: number })[];

  return rows.map(row => ({
    learning: {
      ...row,
      tags: JSON.parse(row.tags as unknown as string || '[]'),
    },
    score: row.score,
    matchedFields: ['title', 'observation', 'action'],  // Simplified for MVP
  }));
}
```

### Hybrid Search (Future Enhancement)

```typescript
// Future: Add semantic search with embeddings

interface HybridSearchOptions extends SearchOptions {
  strategy: 'bm25' | 'semantic' | 'hybrid';
  semanticWeight?: number;  // 0.0 - 1.0, default 0.5
}

/**
 * Hybrid search combining BM25 and semantic similarity
 */
export async function hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
  const { strategy, semanticWeight = 0.5 } = options;

  if (strategy === 'bm25') {
    return searchLearnings(options);
  }

  if (strategy === 'semantic') {
    return semanticSearch(options);
  }

  // Hybrid: run both, combine scores, deduplicate
  const [bm25Results, semanticResults] = await Promise.all([
    searchLearnings({ ...options, limit: options.limit! * 2 }),
    semanticSearch({ ...options, limit: options.limit! * 2 }),
  ]);

  // Combine and deduplicate
  const combined = new Map<string, SearchResult>();

  for (const result of bm25Results) {
    combined.set(result.learning.id, {
      ...result,
      score: result.score * (1 - semanticWeight),
    });
  }

  for (const result of semanticResults) {
    const existing = combined.get(result.learning.id);
    if (existing) {
      existing.score += result.score * semanticWeight;
    } else {
      combined.set(result.learning.id, {
        ...result,
        score: result.score * semanticWeight,
      });
    }
  }

  // Sort by combined score
  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 10);
}
```

---

## Injection Mechanics

### When Injection Happens

Learnings are injected when:
1. Worker claims a task (via `generateTaskInstructions()`)
2. Manual injection via UI (future)

### Injection into Worker Context

```typescript
// lib/learnings/inject.ts

interface InjectionOptions {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  outcomeId: string;
  maxLearnings?: number;       // Default: 5
  minConfidence?: number;      // Default: 0.6
}

interface InjectionResult {
  learnings: Learning[];
  markdown: string;
  injectionRecords: LearningInjection[];
}

/**
 * Find and format learnings for injection into worker context
 */
export function injectLearnings(options: InjectionOptions): InjectionResult {
  const {
    taskId,
    taskTitle,
    taskDescription = '',
    outcomeId,
    maxLearnings = 5,
    minConfidence = 0.6,
  } = options;

  // Build search query from task context
  const searchQuery = `${taskTitle} ${taskDescription}`.trim();

  // Search for relevant learnings
  const results = searchLearnings({
    query: searchQuery,
    minConfidence,
    limit: maxLearnings,
    excludeOutcomeId: outcomeId,  // Don't inject learnings from current outcome
    status: 'active',
  });

  if (results.length === 0) {
    return { learnings: [], markdown: '', injectionRecords: [] };
  }

  // Record injections
  const injectionRecords: LearningInjection[] = results.map(result => {
    const injection = recordInjection(result.learning.id, taskId, outcomeId);
    incrementTimesInjected(result.learning.id);
    return injection;
  });

  // Format as markdown
  const markdown = formatLearningsForInjection(results.map(r => r.learning));

  return {
    learnings: results.map(r => r.learning),
    markdown,
    injectionRecords,
  };
}

/**
 * Format learnings as markdown for CLAUDE.md injection
 */
function formatLearningsForInjection(learnings: Learning[]): string {
  if (learnings.length === 0) return '';

  const lines: string[] = [
    '## Relevant Learnings (from past outcomes)',
    '',
    'These learnings from previous work may be relevant. Mark helpful with `LEARNING_HELPFUL: <id>` or not with `LEARNING_NOT_HELPFUL: <id>`.',
    '',
  ];

  for (const learning of learnings) {
    const usageInfo = learning.times_helpful > 0
      ? `helpful ${learning.times_helpful}x`
      : `used ${learning.times_injected}x`;

    lines.push(`### ${learning.title} [confidence: ${learning.confidence.toFixed(2)}, ${usageInfo}]`);
    lines.push('');
    lines.push(`**Context**: ${learning.context}`);
    lines.push(`**Observation**: ${learning.observation}`);
    lines.push(`**Implication**: ${learning.implication}`);
    lines.push(`**Action**: ${learning.action}`);
    lines.push('');
    lines.push(`_ID: ${learning.id}_`);
    lines.push('');
  }

  return lines.join('\n');
}
```

### Integration with Worker

```typescript
// In lib/ralph/worker.ts - generateTaskInstructions()

import { injectLearnings } from '../learnings/inject';

function generateTaskInstructions(
  outcomeName: string,
  intent: Intent | null,
  task: Task,
  additionalSkillContext?: string,
  outcomeId?: string,
  gitConfig?: GitConfig
): string {
  // ... existing code ...

  // NEW: Inject learnings from past outcomes
  let learningsContext = '';
  if (outcomeId) {
    const injection = injectLearnings({
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description || '',
      outcomeId,
      maxLearnings: 5,
      minConfidence: 0.6,
    });
    learningsContext = injection.markdown;
  }

  return `# Current Task

## Outcome: ${outcomeName}
${intentSummary}

---
${gitInstructions}${homrContext ? `\n${homrContext}` : ''}${learningsContext ? `\n${learningsContext}\n---\n` : ''}
## Your Current Task
// ... rest of template ...
`;
}
```

---

## Feedback Loop

### Parsing Worker Feedback

```typescript
// lib/learnings/feedback.ts

interface FeedbackSignal {
  learningId: string;
  helpful: boolean;
}

/**
 * Parse learning feedback from worker output
 */
export function parseLearningFeedback(output: string): FeedbackSignal[] {
  const signals: FeedbackSignal[] = [];

  // Match LEARNING_HELPFUL: learn_xxx
  const helpfulMatches = output.matchAll(/LEARNING_HELPFUL:\s*(learn_[a-zA-Z0-9]+)/g);
  for (const match of helpfulMatches) {
    signals.push({ learningId: match[1], helpful: true });
  }

  // Match LEARNING_NOT_HELPFUL: learn_xxx
  const notHelpfulMatches = output.matchAll(/LEARNING_NOT_HELPFUL:\s*(learn_[a-zA-Z0-9]+)/g);
  for (const match of notHelpfulMatches) {
    signals.push({ learningId: match[1], helpful: false });
  }

  return signals;
}

/**
 * Process feedback and update confidence
 */
export function processFeedback(taskId: string, output: string): void {
  const signals = parseLearningFeedback(output);

  for (const signal of signals) {
    // Update injection record
    updateInjectionFeedback(signal.learningId, taskId, signal.helpful);

    // Update learning confidence
    if (signal.helpful) {
      incrementTimesHelpful(signal.learningId);
      boostConfidence(signal.learningId);
    } else {
      incrementTimesNotHelpful(signal.learningId);
      decayConfidence(signal.learningId);
    }
  }
}
```

### Integration with Worker Completion

```typescript
// In lib/ralph/worker.ts - after task completion

import { processFeedback } from '../learnings/feedback';

// After capturing full output...
if (fullOutput) {
  processFeedback(task.id, fullOutput);
}
```

---

## Confidence Algorithm

### Confidence Updates

```typescript
// lib/learnings/confidence.ts

const CONFIDENCE_CONFIG = {
  minConfidence: 0.1,
  maxConfidence: 1.0,
  helpfulBoost: 0.05,
  notHelpfulDecay: 0.1,
  unusedDecayRate: 0.02,      // Per 30 days
  unusedDecayThreshold: 30,    // Days before decay starts
};

/**
 * Boost confidence when learning was helpful
 */
export function boostConfidence(learningId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE learnings
    SET confidence = MIN(?, confidence + ?),
        last_helpful_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    CONFIDENCE_CONFIG.maxConfidence,
    CONFIDENCE_CONFIG.helpfulBoost,
    now(),
    now(),
    learningId
  );
}

/**
 * Decay confidence when learning was not helpful
 */
export function decayConfidence(learningId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE learnings
    SET confidence = MAX(?, confidence - ?),
        updated_at = ?
    WHERE id = ?
  `).run(
    CONFIDENCE_CONFIG.minConfidence,
    CONFIDENCE_CONFIG.notHelpfulDecay,
    now(),
    learningId
  );
}

/**
 * Apply time-based decay to unused learnings
 * Run periodically (e.g., daily cron or on app startup)
 */
export function applyUnusedDecay(): number {
  const db = getDb();
  const thresholdMs = CONFIDENCE_CONFIG.unusedDecayThreshold * 24 * 60 * 60 * 1000;
  const cutoff = now() - thresholdMs;

  const result = db.prepare(`
    UPDATE learnings
    SET confidence = MAX(?, confidence - ?),
        updated_at = ?
    WHERE status = 'active'
      AND (last_injected_at IS NULL OR last_injected_at < ?)
      AND confidence > ?
  `).run(
    CONFIDENCE_CONFIG.minConfidence,
    CONFIDENCE_CONFIG.unusedDecayRate,
    now(),
    cutoff,
    CONFIDENCE_CONFIG.minConfidence
  );

  return result.changes;
}
```

### Confidence Calculation

```
Initial confidence: Based on discovery type (0.5 - 0.7)

After each injection:
  - If helpful: confidence += 0.05 (max 1.0)
  - If not helpful: confidence -= 0.1 (min 0.1)

Time decay:
  - If not injected for 30+ days: confidence -= 0.02 per period
  - Minimum confidence: 0.1 (never fully forgotten)

Superseded:
  - If new learning contradicts: original marked 'superseded', new learning links back
```

---

## API Endpoints

### Learnings CRUD

```typescript
// app/api/learnings/route.ts

// GET /api/learnings - List learnings with optional filters
// Query params: status, domain, minConfidence, search, limit, offset

// POST /api/learnings - Create a learning manually
// Body: { title, context, observation, implication, action, tags, domain }

// app/api/learnings/[id]/route.ts

// GET /api/learnings/[id] - Get single learning
// PATCH /api/learnings/[id] - Update learning (edit, archive, change tags)
// DELETE /api/learnings/[id] - Archive learning (soft delete)

// app/api/learnings/search/route.ts

// GET /api/learnings/search?q=oauth+stripe&minConfidence=0.6&limit=10
// Returns: { results: SearchResult[], total: number }
```

### Feedback Endpoint

```typescript
// app/api/learnings/[id]/feedback/route.ts

// POST /api/learnings/[id]/feedback
// Body: { taskId: string, helpful: boolean }
// Manually record feedback (alternative to parsing from output)
```

---

## Integration Points

### HOMЯ Observer Integration

```typescript
// lib/homr/observer.ts - after extracting discoveries

import { extractLearningFromDiscovery, createLearning } from '../learnings';

export async function observeTask(input: ObserveTaskInput): Promise<ObservationResult | null> {
  // ... existing observation code ...

  // After extracting discoveries, attempt to create learnings
  for (const discovery of result.discoveries) {
    // Skip certain types
    if (discovery.type === 'dependency') continue;

    const extraction = await extractLearningFromDiscovery(discovery, {
      taskId: task.id,
      taskTitle: task.title,
      outcomeId,
      outcomeName: outcome?.name || 'Unknown',
    });

    if (extraction.success && extraction.learning) {
      createLearning(extraction.learning);
      console.log(`[Learnings] Extracted learning: ${extraction.learning.title}`);
    }
  }

  return result;
}
```

### Worker Integration

Already shown in Injection Mechanics section.

### UI Integration (Future)

```typescript
// Resources page: Add "Learnings" tab alongside Skills, Tools, Documents, Files

// Components needed:
// - LearningsTable: List all learnings with filters
// - LearningCard: Display single learning in COIA format
// - LearningEditor: Edit learning content, tags, domain
// - LearningSearch: Search interface
```

---

## File Structure

```
lib/
├── learnings/
│   ├── index.ts           # Main exports
│   ├── extract.ts         # Extract learnings from discoveries
│   ├── search.ts          # BM25 (and future hybrid) search
│   ├── inject.ts          # Inject into worker context
│   ├── feedback.ts        # Parse and process feedback
│   ├── confidence.ts      # Confidence calculation and decay
│   └── prompts.ts         # Extraction prompts
├── db/
│   └── learnings.ts       # CRUD operations, schema
app/
├── api/
│   └── learnings/
│       ├── route.ts       # List, create
│       ├── [id]/
│       │   ├── route.ts   # Get, update, delete
│       │   └── feedback/
│       │       └── route.ts
│       └── search/
│           └── route.ts
```

---

## Migration Plan

### Phase 1: Schema & Extraction
1. Add `learnings` table with FTS5
2. Add `learning_injections` table
3. Hook into HOMЯ observer for extraction
4. Run extraction on new discoveries

### Phase 2: Search & Injection
5. Implement BM25 search
6. Integrate injection into `generateTaskInstructions()`
7. Record injections in database

### Phase 3: Feedback & Confidence
8. Parse feedback from worker output
9. Implement confidence boost/decay
10. Add periodic unused decay job

### Phase 4: API & UI
11. Build REST API endpoints
12. Add Learnings tab to Resources page
13. Build management UI

---

*This document captures the technical design for the Persistent Learnings Layer. For philosophy and user stories, see [VISION.md](./VISION.md).*
