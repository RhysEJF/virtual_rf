# Dispatcher

> The entry point for all user requests. Classifies messy human input and routes to appropriate handlers.

---

## Purpose

When a user speaks or types into the command bar, their input is often unstructured - rambling thoughts, partial ideas, or ambiguous requests. The Dispatcher's job is to:

1. Understand what the user is asking for
2. Classify it into a request type
3. Route it to the right handler
4. Match it to existing outcomes when relevant

---

## Current State

**Status:** Complete and production-ready

The Dispatcher handles:
- Classification with confidence scoring
- Smart outcome matching (finds related existing outcomes)
- Clarifying question generation when needed
- Direct routing to Quick/Research/Deep handlers

---

## Key Concepts

### Request Types

| Type | Description | Handler |
|------|-------------|---------|
| `quick` | Simple one-shot questions | Quick Executor |
| `research` | Information gathering | Research Handler |
| `deep` | Building/creating work | Briefer → Orchestrator |
| `clarification` | Ambiguous, needs more info | Returns questions to user |

### Smart Outcome Matching

Before creating a new outcome, the Dispatcher checks if the request relates to an existing outcome. This prevents duplicate outcomes and preserves context.

**Match types:**
- `exact` - Direct match to outcome name/intent
- `related` - Could be added to existing outcome
- `new` - Needs a new outcome

### Confidence Scoring

Every classification includes a confidence score (0-1). Low confidence triggers clarifying questions rather than proceeding with a guess.

---

## Components

### Primary Files

| File | Purpose |
|------|---------|
| `lib/agents/dispatcher.ts` | Main classification logic |
| `lib/agents/quick-executor.ts` | Handles `quick` type requests |
| `lib/agents/research-handler.ts` | Handles `research` type requests |
| `lib/agents/briefer.ts` | Handles `deep` type (creates briefs) |
| `app/api/dispatch/route.ts` | API endpoint |

### Dispatcher Flow

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

## API

### POST /api/dispatch

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

---

## Open Questions

1. **Threshold tuning** - What confidence level should trigger clarification vs. proceeding? Currently uses 0.7 but this may need adjustment based on user feedback.

2. **Multi-intent handling** - What if a user's input contains multiple distinct requests? Currently treats as single request.

3. **Context memory** - Should the Dispatcher remember recent interactions to improve classification? Currently stateless per request.
