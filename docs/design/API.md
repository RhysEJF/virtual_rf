# API - Design

> Implementation details for the unified conversational API layer.

---

## Architecture

### Files (Planned)

| File | Purpose | Status |
|------|---------|--------|
| `app/api/converse/route.ts` | Main conversational endpoint | Not Started |
| `lib/api/session.ts` | Session/thread management | Not Started |
| `lib/api/responder.ts` | Response formatting | Not Started |
| `app/api/dispatch/route.ts` | Classification (exists) | Complete |
| `app/api/outcomes/` | Outcome CRUD (exists) | Complete |
| `app/api/workers/` | Worker management (exists) | Complete |

---

## Core Endpoints

### Existing Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/dispatch` | POST | Classify user input |
| `/api/outcomes` | GET, POST | List/create outcomes |
| `/api/outcomes/[id]` | GET, PATCH, DELETE | Outcome CRUD |
| `/api/outcomes/[id]/start` | POST | Start workers |
| `/api/outcomes/[id]/tasks` | GET, POST | Task management |
| `/api/outcomes/[id]/items` | GET, POST, PATCH | Item sync management |
| `/api/workers` | GET | List workers |
| `/api/workers/[id]` | GET, PATCH | Worker management |
| `/api/workers/[id]/intervene` | POST | Send intervention |
| `/api/skills` | GET, POST | Skills management |
| `/api/skills/outcome` | GET | Outcome-specific skills |
| `/api/tools/outcome` | GET | Outcome-specific tools |
| `/api/repositories` | GET, POST | Repository configuration |
| `/api/repositories/[id]` | GET, PUT, DELETE | Repository CRUD |

### Planned: `/api/converse`

The main conversational endpoint that wraps all others.

**Request:**
```json
{
  "message": "yeah so I need like a landing page that converts really well",
  "session_id": "sess_abc123",
  "context": {
    "outcome_id": "out_xyz789",
    "source": "telegram"
  }
}
```

**Response (clarification):**
```json
{
  "type": "clarification",
  "session_id": "sess_abc123",
  "message": "Let me clarify what I understood:\n\nYou want a landing page that:\n• Converts visitors to signups\n• Targets high conversion rate\n\nA few questions:\n1. Do you have existing brand assets?\n2. What's your target conversion rate?\n3. Where should this be deployed?",
  "understanding": {
    "intent": "build landing page",
    "confidence": 0.75,
    "extracted": {
      "type": "landing page",
      "goal": "high conversion"
    }
  },
  "actions": [
    { "label": "Approve Understanding", "action": "confirm" },
    { "label": "Clarify More", "action": "continue" }
  ]
}
```

**Response (confirmation):**
```json
{
  "type": "confirmation",
  "session_id": "sess_abc123",
  "message": "Ready to create outcome: Product Landing Page\n\nIntent (PRD):\n• Mobile-first landing page with 5% conversion target\n• Email waitlist capture\n• Testimonials and pricing sections\n\nApproach:\n• Next.js 14 + Tailwind\n• Framer Motion for animations\n• Vercel deployment\n\nThis will generate ~8 tasks.",
  "pending_action": {
    "type": "create_outcome",
    "outcome": {
      "name": "Product Landing Page",
      "intent": "...",
      "approach": "..."
    }
  },
  "actions": [
    { "label": "Start Work", "action": "execute" },
    { "label": "Edit First", "action": "edit" }
  ]
}
```

**Response (execution):**
```json
{
  "type": "execution",
  "session_id": "sess_abc123",
  "message": "Created outcome: Product Landing Page\n\n• 8 tasks generated\n• 1 worker starting\n• Estimated completion: I'll notify you",
  "result": {
    "outcome_id": "out_new123",
    "tasks_created": 8,
    "workers_spawned": 1
  }
}
```

**Response (status):**
```json
{
  "type": "status",
  "session_id": "sess_abc123",
  "message": "Product Landing Page progress:\n\n• 3 of 8 tasks complete\n• Ralph working on: Hero section\n• Current iteration: 24\n• Convergence: Improving (3 issues → 1)",
  "data": {
    "outcome_id": "out_xyz789",
    "tasks_complete": 3,
    "tasks_total": 8,
    "active_workers": 1,
    "convergence": "improving"
  }
}
```

---

## Session Management

### Session Schema

```typescript
interface Session {
  id: string;                    // sess_xxx
  source: 'web' | 'cli' | 'telegram' | 'slack';
  source_id?: string;            // telegram_chat_id, etc.
  current_outcome_id?: string;   // Focus context
  messages: SessionMessage[];    // Conversation history
  created_at: string;
  last_activity_at: string;
  expires_at: string;            // Auto-cleanup
}

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    action_taken?: string;
    outcome_created?: string;
  };
}
```

### Session Lifecycle

```
New message arrives
        │
        ▼
┌───────────────────┐
│ Check session_id  │
│                   │
│ Found? → Load     │
│ Missing? → Create │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Add message to    │
│ session history   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Process with full │
│ context           │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Update session    │
│ with response     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Return response   │
│ with session_id   │
└───────────────────┘
```

### Database Table (Planned)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT,
  current_outcome_id TEXT,
  messages TEXT,           -- JSON array
  created_at TEXT,
  last_activity_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (current_outcome_id) REFERENCES outcomes(id)
);
```

---

## Interface Implementations

### Web UI

Already exists as `CommandBar.tsx`. Would be updated to use `/api/converse` instead of direct `/api/dispatch` calls.

```typescript
// Current: Direct dispatch
const result = await fetch('/api/dispatch', { body: { input } });

// Future: Conversational
const result = await fetch('/api/converse', {
  body: { message: input, session_id: sessionId }
});
```

### CLI (In Progress)

The CLI (`cli/` directory) provides command-line access to the API.

```bash
# List outcomes
$ rf list

# Show outcome details
$ rf show out_123

# Create new outcome
$ rf new "Build a landing page"

# Start workers
$ rf start out_123

# Check status
$ rf status

# Stop workers
$ rf stop out_123
```

**Files:**
- `cli/src/commands/list.ts` - List outcomes
- `cli/src/commands/show.ts` - Show outcome details
- `cli/src/commands/new.ts` - Create outcome
- `cli/src/commands/start.ts` - Start workers
- `cli/src/commands/status.ts` - System status
- `cli/src/commands/stop.ts` - Stop workers
- `cli/src/api.ts` - API client wrapper

### Telegram Bot (Planned)

```typescript
// Webhook handler
app.post('/api/telegram/webhook', async (req, res) => {
  const { message } = req.body;
  const chatId = message.chat.id;

  // Map telegram chat to session
  const sessionId = await getOrCreateSession('telegram', chatId);

  // Call converse API
  const response = await fetch('/api/converse', {
    body: {
      message: message.text,
      session_id: sessionId,
      context: { source: 'telegram' }
    }
  });

  // Send response back to Telegram
  await sendTelegramMessage(chatId, response.message);
});
```

---

## Telegram Integration

### Webhook Flow

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Telegram   │ webhook │   Server    │  POST   │  Local API  │
│  Servers    │────────▶│  (hosted)   │────────▶│  (tunnel)   │
│             │         │             │         │             │
│             │◀────────│             │◀────────│  /converse  │
│             │ sendMsg │             │  JSON   │             │
└─────────────┘         └─────────────┘         └─────────────┘
```

### Telegram Commands

| Command | Action |
|---------|--------|
| `/outcomes` | List active outcomes |
| `/switch X` | Set context to outcome X |
| `/status` | Current workers and progress |
| `/pause` | Pause active workers |
| `/intervene ...` | Send intervention to worker |
| *(or just talk)* | Natural language processing |

### Notification Types

```typescript
type TelegramNotification =
  | { type: 'task_complete'; task: string; outcome: string }
  | { type: 'worker_stuck'; worker: string; duration: string }
  | { type: 'review_complete'; issues: number; outcome: string }
  | { type: 'outcome_complete'; outcome: string; tasks: number }
  | { type: 'intervention_needed'; reason: string };
```

---

## Response Formatting

Different interfaces need different formats:

```typescript
interface ConversationResponse {
  type: 'clarification' | 'confirmation' | 'execution' | 'status' | 'error';
  session_id: string;
  message: string;           // Human-readable, markdown
  data?: Record<string, any>; // Structured data for UI
  actions?: Action[];        // Available next actions
}

// Format for different interfaces
function formatForInterface(
  response: ConversationResponse,
  interface: 'web' | 'cli' | 'telegram'
): string | object {
  switch (interface) {
    case 'web':
      return response; // Full object for rich UI
    case 'cli':
      return response.message; // Plain text
    case 'telegram':
      return formatTelegramMarkdown(response.message);
  }
}
```

---

## Dependencies

**Uses:**
- `lib/agents/dispatcher.ts` - For classification
- `lib/agents/briefer.ts` - For outcome creation
- `lib/db/*` - All data operations

**Used by:**
- `app/components/CommandBar.tsx` - Web UI
- `app/api/telegram/webhook` - Telegram bot (planned)
- CLI tool (planned)

---

## Implementation Order

1. **Session table and management** - Foundation for conversation persistence
2. **`/api/converse` endpoint** - Core conversational logic
3. **Update CommandBar** - Use converse instead of dispatch
4. **CLI tool** - Thin client over converse
5. **Telegram webhook** - Bot integration
6. **Notifications** - Proactive updates to chat interfaces
