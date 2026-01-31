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

## Status

| Capability | Status |
|------------|--------|
| Request classification (quick/research/deep) | Complete |
| Confidence scoring | Complete |
| Smart outcome matching | Complete |
| Clarifying question generation | Complete |

**Overall:** Complete and production-ready

---

## Key Concepts

### Request Types

| Type | Description | What Happens |
|------|-------------|--------------|
| `quick` | Simple one-shot questions | Immediate response, no outcome created |
| `research` | Information gathering | Research handler runs, may create outcome |
| `deep` | Building/creating work | Creates outcome, spawns workers |
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

## Behaviors

1. **Natural language understanding** - Accepts messy, incomplete human thoughts and extracts intent
2. **Context awareness** - Considers currently active outcome when classifying
3. **Conservative routing** - When uncertain, asks for clarification rather than guessing
4. **Outcome deduplication** - Prevents creating duplicate outcomes for related requests

---

## Success Criteria

- User input is correctly classified 90%+ of the time
- Related requests are matched to existing outcomes
- Clarifying questions are relevant and helpful
- No false positives (creating outcomes when not needed)

---

## Open Questions

1. **Threshold tuning** - What confidence level should trigger clarification vs. proceeding? Currently uses 0.7 but this may need adjustment based on user feedback.

2. **Multi-intent handling** - What if a user's input contains multiple distinct requests? Currently treats as single request.

3. **Context memory** - Should the Dispatcher remember recent interactions to improve classification? Currently stateless per request.

---

## Related

- **Design:** [DISPATCHER.md](../design/DISPATCHER.md) - Implementation details and API specs
