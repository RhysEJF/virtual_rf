# Dispatcher - Design

> Implementation details for request classification and routing.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/agents/dispatcher.ts` | Main classification logic | ~8KB |
| `lib/agents/quick-executor.ts` | Handles `quick` type requests | ~3KB |
| `lib/agents/research-handler.ts` | Handles `research` type requests | ~4KB |
| `lib/agents/briefer.ts` | Handles `deep` type (creates briefs) | ~6KB |
| `app/api/dispatch/route.ts` | API endpoint | ~2KB |

---

## Dispatcher Flow

```
User Input
    │
    ▼
┌─────────────────────────────────┐
│         DISPATCHER              │
│                                 │
│  1. Parse input                 │
│  2. Check existing outcomes     │
│  3. Classify request type       │
│  4. Generate confidence score   │
│  5. Create clarifying Qs if low │
│                                 │
└────────────┬────────────────────┘
             │
     ┌───────┼───────┬───────┐
     ▼       ▼       ▼       ▼
  quick  research  deep  clarify
     │       │       │       │
     ▼       ▼       ▼       ▼
  Quick   Research  Briefer  Return
  Exec    Handler     │      to User
     │       │        │
     ▼       ▼        ▼
  Response  Outcome  Outcome
            Created  Created
```

---

## Dependencies

**Uses:**
- `lib/claude/client.ts` - For LLM classification
- `lib/db/outcomes.ts` - To check existing outcomes
- `lib/db/skills.ts` - To check available capabilities

**Used by:**
- `app/api/dispatch/route.ts` - Main entry point
- `app/components/CommandBar.tsx` - UI integration

---

## API Specification

### POST /api/dispatch

Classify user input and route to appropriate handler.

**Request:**
```json
{
  "input": "I need a landing page for my product",
  "context": {
    "currentOutcomeId": "out_abc123"
  }
}
```

**Response (classification):**
```json
{
  "type": "deep",
  "confidence": 0.92,
  "reasoning": "User wants to build something (landing page)",
  "suggestedOutcome": "Product Landing Page",
  "matchedOutcome": null
}
```

**Response (match found):**
```json
{
  "type": "deep",
  "confidence": 0.88,
  "matchType": "related",
  "matchedOutcome": {
    "id": "out_xyz789",
    "name": "Product Launch MVP"
  },
  "matchReason": "This appears related to your existing Product Launch MVP outcome"
}
```

**Response (clarification needed):**
```json
{
  "type": "clarification",
  "confidence": 0.45,
  "questions": [
    "Are you asking about an existing project or starting something new?",
    "Can you tell me more about what kind of landing page you need?"
  ]
}
```

---

## Classification Logic

```typescript
interface ClassificationResult {
  type: 'quick' | 'research' | 'deep' | 'clarification';
  confidence: number;
  reasoning: string;
  suggestedOutcome?: string;
  matchedOutcome?: { id: string; name: string };
  matchType?: 'exact' | 'related' | 'new';
  matchReason?: string;
  questions?: string[];
}
```

### Confidence Thresholds

| Threshold | Action |
|-----------|--------|
| `>= 0.7` | Proceed with classification |
| `< 0.7` | Generate clarifying questions |
| `< 0.3` | Return "I don't understand" |

---

## Outcome Matching Algorithm

1. Get all active/dormant outcomes
2. For each outcome, compute similarity score against input
3. If any score > 0.8, mark as `exact` match
4. If any score > 0.5, mark as `related` match
5. Otherwise, mark as `new`

The LLM handles similarity scoring using semantic understanding, not just keyword matching.
