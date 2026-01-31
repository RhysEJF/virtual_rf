# API

> All interfaces are thin clients over a unified conversational API.

---

## Purpose

Digital Twin is API-first. Every interface - web UI, CLI, Telegram, future AR headsets - is just a thin client talking to the same core API. This enables:

1. **Interface flexibility** - Build once, expose everywhere
2. **Consistent behavior** - Same logic regardless of how you access it
3. **Chat-first design** - Natural language is the primary input
4. **Future-proofing** - New interfaces (Slack, voice, AR) plug into existing API

---

## Status

| Capability | Status |
|------------|--------|
| Dispatch API (classification) | Complete |
| Outcomes CRUD API | Complete |
| Workers API | Complete |
| Skills API | Complete |
| Tools API | Complete |
| Repositories API | Complete |
| Items API (sync management) | Complete |
| CLI thin client | In Progress |
| Converse API (conversational) | Not Started |
| Session/thread management | Not Started |
| Telegram integration | Not Started |

**Overall:** Foundation complete, CLI in progress, conversational layer not yet built

---

## Key Concepts

### API-First Architecture

```
                    ┌─────────────┐
                    │   WEB UI    │
                    │  (Next.js)  │
                    └──────┬──────┘
                           │
┌─────────────┐     ┌──────┴──────┐     ┌─────────────┐
│  TELEGRAM   │────▶│             │◀────│    CLI      │
│    BOT      │     │   CORE API  │     │   (rf)      │
└─────────────┘     │             │     └─────────────┘
                    │  /converse  │
┌─────────────┐     │  /outcomes  │     ┌─────────────┐
│   SLACK     │────▶│  /workers   │◀────│  AR/VR      │
│  (future)   │     │  /skills    │     │  (future)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

All interfaces call the same endpoints. The API handles:
- Natural language understanding
- Request classification
- Outcome management
- Worker orchestration

### The `/api/converse` Endpoint

The heart of chat-based interaction. Unlike `/api/dispatch` (which classifies), `/api/converse` handles multi-turn conversations:

```
User: "I need a landing page"
      │
      ▼
┌─────────────────────────────────┐
│        /api/converse            │
│                                 │
│  1. Parse input                 │
│  2. Check session context       │
│  3. Classify intent             │
│  4. Generate response OR        │
│     ask clarifying questions    │
│  5. Execute if confirmed        │
│                                 │
└─────────────────────────────────┘
      │
      ▼
RF: "Let me clarify - you want a landing page that:
     • Converts visitors to signups
     • Works on mobile
     Is that right?"
      │
      ▼
User: "Yes, and deploy to Vercel"
      │
      ▼
RF: "Creating outcome: Product Landing Page
     Tasks generated: 8
     Starting worker..."
```

### Session/Thread Management

Conversations persist across messages via sessions:

| Concept | Description |
|---------|-------------|
| **Session** | A conversation thread with context |
| **Context** | Current outcome, recent messages, user preferences |
| **Handoff** | Moving from clarification to execution seamlessly |

Sessions enable:
- Multi-turn clarification
- Context switching ("switch to ConsultingY")
- Resuming where you left off

### Response Types

| Type | When | Example |
|------|------|---------|
| `clarification` | Need more info | "What conversion rate are you targeting?" |
| `confirmation` | Ready to execute | "I'll create 8 tasks for the landing page. Proceed?" |
| `execution` | Action taken | "Outcome created. Worker starting now." |
| `status` | Reporting progress | "Ralph is 60% through the hero section." |
| `error` | Something went wrong | "I couldn't understand that. Can you rephrase?" |

---

## Behaviors

1. **Conversational** - Handles messy human input, asks clarifying questions
2. **Context-aware** - Remembers session history, current focus
3. **Confirm before execute** - Never takes action without user approval
4. **Interface-agnostic** - Same response format works for web, CLI, Telegram

---

## Success Criteria

- Same request produces same result regardless of interface
- Multi-turn conversations feel natural
- Context persists across messages
- Adding new interfaces requires no API changes

---

## The Vision: Executive Interface

The ultimate goal is to become a new kind of executive:

```
You're at a networking event. Someone mentions a problem.

You: *speaks into phone/watch/glasses*
     "Build a tool that solves X, demo-ready in 2 hours"

Telegram: "Creating outcome: X Solution Tool
          Generating approach...
          Spawning 2 workers...
          I'll notify you when demo is ready."

2 hours later...

Telegram: "Demo ready. Here's the link: [url]
          3 issues found in review, fixing now."

You: "Perfect, show me the demo"
```

This requires:
- Rock-solid API that handles everything
- Chat interface that works from anywhere
- Workers that execute autonomously
- Notifications when human attention needed

---

## Open Questions

1. **Session persistence** - How long do sessions live? Per-device? Per-outcome?

2. **Voice input** - Should `/api/converse` accept audio directly or expect transcription?

3. **Proactive notifications** - When should the system reach out vs. wait for user?

4. **Multi-user sessions** - Can collaborators share a conversation thread?

5. **Rate limiting** - How to prevent runaway conversations from spawning too much work?

---

## Related

- **Design:** [API.md](../design/API.md) - Endpoint specifications and implementation
- **Vision:** [DISPATCHER.md](./DISPATCHER.md) - Request classification (used by converse)
- **Vision:** [DEPLOYMENT.md](./DEPLOYMENT.md) - How API is hosted and accessed
