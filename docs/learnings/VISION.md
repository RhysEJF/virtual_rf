# Persistent Learnings Layer: Vision Document

> Cross-outcome intelligence that remembers, searches, and evolves - completing the Memory primitive.

**Related Documents:**
- [DESIGN.md](./DESIGN.md) - Technical architecture and implementation details
- [../homr/VISION.md](../homr/VISION.md) - HOMЯ Protocol (per-outcome intelligence)
- [../vision/WORKER.md](../vision/WORKER.md) - Ralph worker execution

---

## Executive Summary

The Persistent Learnings Layer is the cross-outcome memory system that accumulates wisdom across all work. While HOMЯ observes and steers within a single outcome, learnings persist globally - enabling workers to ask "how did we solve this before?" and receive relevant context from any past work.

This completes James's three core primitives:
- **Tasks** - What needs to be done (implemented)
- **Orchestration** - How to sequence and coordinate (implemented via HOMЯ)
- **Memory** - What was learned across iterations (**this layer**)

---

## The Problem: Outcomes Are Islands

### What HOMЯ Does Well

Our HOMЯ Protocol provides excellent per-outcome intelligence:
- Observes task outputs and extracts discoveries
- Steers pending tasks with relevant context
- Escalates ambiguity to humans
- Maintains decisions and constraints for the outcome

### What HOMЯ Cannot Do

HOMЯ's scope is limited to a single outcome. When the outcome completes, its discoveries are archived but not accessible to future work.

| Limitation | Description | Impact |
|------------|-------------|--------|
| **Outcome Isolation** | Discoveries stay in `homr_context` per-outcome | Solve the same problem repeatedly across outcomes |
| **No Cross-Outcome Search** | Can't ask "have we seen this before?" | Workers start from scratch every time |
| **No Confidence Evolution** | All discoveries treated equally | No way to know which learnings are actually valuable |
| **No Usage Tracking** | Don't know if injected context helped | Can't improve injection relevance over time |
| **Context Bloat Risk** | Injecting everything relevant floods context | Need smart filtering based on actual usefulness |

### The Core Insight

> **HOMЯ learns within an outcome. Learnings persist across all outcomes.**

A worker in Outcome B doesn't know that:
- Outcome A solved the exact same OAuth integration problem 3 weeks ago
- The solution was documented as a discovery with specific steps
- That discovery was marked helpful by 4 subsequent workers
- There's a pattern emerging across 6 outcomes about API rate limiting

The Persistent Learnings Layer sees all of this and surfaces it at the right moment.

---

## What the Learnings Layer Does

The Learnings Layer performs four core functions:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PERSISTENT LEARNINGS LAYER                           │
│                                                                         │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────┐ │
│  │               │  │               │  │               │  │          │ │
│  │   EXTRACT     │─▶│    SEARCH     │─▶│    INJECT     │─▶│ FEEDBACK │ │
│  │               │  │               │  │               │  │          │ │
│  │ • From HOMЯ   │  │ • BM25 text   │  │ • Top 3-5     │  │ • Helpful│ │
│  │ • COIA format │  │ • Semantic    │  │ • By task     │  │ • Not    │ │
│  │ • Tag & store │  │ • Hybrid      │  │ • Confidence  │  │ • Decay  │ │
│  │               │  │               │  │   filtered    │  │ • Boost  │ │
│  └───────────────┘  └───────────────┘  └───────────────┘  └──────────┘ │
│         │                                                      │        │
│         └──────────────────────────────────────────────────────┘        │
│                         Confidence evolution loop                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1. EXTRACT - Capture Learnings in Structured Format

When HOMЯ observes a completed task and extracts discoveries, the Learnings Layer:

- **Converts to COIA format** - Context, Observation, Implication, Action
- **Tags for searchability** - Domain, technology, pattern type
- **Assigns initial confidence** - Based on discovery type and source
- **Stores globally** - In learnings table, not per-outcome

**COIA Format** (from James's RALPH system):
```markdown
### [Date] - [Brief Title]

**Context**: What were you working on?
**Observation**: What did you notice?
**Implication**: How should this change future work?
**Action**: Specific change to make
```

### 2. SEARCH - Find Relevant Wisdom

When a worker claims a task, the Learnings Layer searches for relevant past learnings:

- **BM25 text search** - Keyword matching for exact terms
- **Semantic search** - Embedding similarity for conceptual matches (future)
- **Hybrid ranking** - Combine both, deduplicate results
- **Confidence filtering** - Only surface learnings above threshold

### 3. INJECT - Deliver Context at the Right Moment

Selected learnings are injected into the worker's CLAUDE.md:

- **Top 3-5 learnings** - Don't overwhelm, prioritize by relevance + confidence
- **Include metadata** - Show confidence score, usage count, source
- **Learning IDs** - Enable feedback tracking

```markdown
## Relevant Learnings (from past outcomes)

### OAuth PKCE Flow Required for Stripe [confidence: 0.85, used 4x]
**Context**: Integrating Stripe payment API
**Observation**: Stripe requires OAuth 2.0 PKCE flow, not basic OAuth
**Implication**: Any Stripe integration needs PKCE support
**Action**: Use @stripe/stripe-js with built-in PKCE handling
_Source: outcome_abc123, 3 weeks ago_
```

### 4. FEEDBACK - Evolve Confidence Over Time

Workers can signal whether learnings helped:

```
LEARNING_HELPFUL: learn_abc123
LEARNING_NOT_HELPFUL: learn_def456
```

The system tracks:
- **Times injected** - How often this learning was surfaced
- **Times helpful** - Worker marked it useful
- **Times not helpful** - Worker marked it irrelevant
- **Last used** - For staleness detection

**Confidence evolution:**
- Helpful → Boost confidence (+0.05, max 1.0)
- Not helpful → Decay confidence (-0.1, min 0.1)
- Unused for 30 days → Gradual decay
- Contradicted by newer learning → Flag for review

---

## User Stories

### Story 1: "How did we handle this before?"

**Before:** Worker encounters OAuth integration. Struggles for 45 minutes. Eventually figures out PKCE is required.

**After:** Worker claims task. Learnings Layer injects: "OAuth PKCE Flow Required for Stripe" with exact steps. Worker completes in 10 minutes.

### Story 2: Pattern Recognition

**Before:** Same rate-limiting issue appears in outcomes A, B, C, D. Each worker solves it independently.

**After:** By outcome C, the learning has high confidence. Workers E, F, G get proactive guidance: "API rate limits typically require exponential backoff with jitter."

### Story 3: Confidence-Based Filtering

**Before:** Every possibly-relevant discovery gets injected. Worker drowns in context.

**After:** Only learnings with >0.6 confidence and >2 uses get injected. High signal, low noise.

### Story 4: Institutional Knowledge

**Before:** Rhys remembers "we solved this OAuth thing a few months ago" but can't find where.

**After:** Learnings browser shows all learnings, searchable. Rhys can manually boost/demote, add tags, mark obsolete.

---

## Relationship to HOMЯ

The Learnings Layer and HOMЯ are complementary:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   OUTCOME A                     OUTCOME B                     OUTCOME C │
│   ─────────                     ─────────                     ───────── │
│                                                                         │
│   ┌─────────┐                   ┌─────────┐                   ┌───────┐ │
│   │  HOMЯ   │                   │  HOMЯ   │                   │ HOMЯ  │ │
│   │Observes │                   │Observes │                   │       │ │
│   │ Steers  │                   │ Steers  │                   │       │ │
│   └────┬────┘                   └────┬────┘                   └───┬───┘ │
│        │                             │                            │     │
│        │ discoveries                 │ discoveries                │     │
│        ▼                             ▼                            ▼     │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                                                                 │   │
│   │                   PERSISTENT LEARNINGS LAYER                    │   │
│   │                                                                 │   │
│   │   • Stores globally            • Searches across all outcomes   │   │
│   │   • Tracks confidence          • Injects into new workers       │   │
│   │   • Evolves with feedback      • Surfaces patterns              │   │
│   │                                                                 │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│        │                             │                            │     │
│        │ inject                      │ inject                     │     │
│        ▼                             ▼                            ▼     │
│   ┌─────────┐                   ┌─────────┐                   ┌───────┐ │
│   │ Workers │                   │ Workers │                   │Workers│ │
│   └─────────┘                   └─────────┘                   └───────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. HOMЯ observes task completion → extracts discoveries
2. Discoveries flow to Learnings Layer → stored globally as COIA
3. New task claimed → Learnings Layer searches
4. Relevant learnings injected → Worker gets cross-outcome wisdom
5. Worker marks helpful/not → Confidence evolves

**Separation of Concerns:**
- **HOMЯ**: Real-time steering within an outcome (context injections, task updates, escalations)
- **Learnings**: Long-term memory across outcomes (search, confidence, evolution)

---

## What This Enables

### Immediate Value

| Capability | Description |
|------------|-------------|
| **Cross-outcome recall** | Workers can leverage solutions from any past outcome |
| **Smart auto-injection** | Relevant learnings appear automatically in worker context |
| **Confidence filtering** | Only high-quality learnings surface |
| **Usage tracking** | Know which learnings are actually valuable |

### Future Enhancements

| Enhancement | Description |
|-------------|-------------|
| **Semantic search** | Vector embeddings for conceptual similarity |
| **Graph relationships** | Link related learnings, trace lineage |
| **Proactive suggestions** | UI shows "Similar problems solved in outcomes X, Y" |
| **Learning synthesis** | Combine related learnings into consolidated guidance |
| **Skill generation** | Automatically propose skills from high-confidence patterns |

---

## Success Metrics

### MVP Success
- Learnings extracted from HOMЯ discoveries
- BM25 search working across outcomes
- Top 3 learnings injected into worker context
- Helpful/not helpful feedback captured
- Confidence updated based on feedback

### Full System Success
- Workers find relevant learnings >70% of the time
- Average task completion time decreases for repeated patterns
- High-confidence learnings (>0.8) have >80% helpful rate
- Stale learnings automatically decay below injection threshold
- UI allows browsing/editing learnings

### Long-term Success
- System accumulates institutional knowledge over months
- New outcomes start with relevant wisdom from day one
- Patterns emerge that inform skill creation
- Human intervention decreases as system learns

---

## Open Questions

1. **Search Strategy**: Start with BM25 only, or invest in embeddings from day one?

2. **Injection Limit**: How many learnings to inject? Too few = missed context, too many = noise.

3. **Confidence Threshold**: What minimum confidence for injection? 0.5? 0.6? 0.7?

4. **Decay Rate**: How quickly should unused learnings decay? Linear? Exponential?

5. **UI Priority**: Build learnings browser early (for visibility) or later (after core works)?

6. **Contradiction Handling**: When a new learning contradicts an old one, how to resolve?

---

## Implementation Path

### Phase 1: Core Infrastructure
- Create `learnings` table with COIA schema
- Hook into HOMЯ observer to extract learnings
- Basic BM25 search via SQLite FTS5
- Inject into worker context

### Phase 2: Feedback Loop
- Parse LEARNING_HELPFUL/NOT_HELPFUL from worker output
- Update confidence based on feedback
- Add decay for unused learnings

### Phase 3: UI & Management
- Learnings browser in Resources page
- Manual edit/tag/archive capabilities
- Search interface for humans

### Phase 4: Intelligence (Future)
- Semantic search with embeddings
- Learning synthesis and consolidation
- Proactive skill suggestions

---

*This document captures the vision for the Persistent Learnings Layer. For technical implementation details, see [DESIGN.md](./DESIGN.md).*
