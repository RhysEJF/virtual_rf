# Conversational API Vision Document

> Chat with your Digital Twin from anywhere - Telegram, SMS, or any messaging platform.

**Related Documents:**
- [CLI.md](./CLI.md) - The text interface that Conversational API wraps
- [DISPATCHER.md](./DISPATCHER.md) - Intent classification and routing
- [../DESIGN.md](../DESIGN.md) - Overall system design

---

## Executive Summary

The Conversational API is a **thin layer over the CLI** that enables natural language interaction via messaging platforms. The primary target is Telegram, enabling you to:
- Create outcomes while walking
- Check status from your phone
- Respond to escalations immediately
- Stay connected to your AI workforce 24/7

This is the feature that transforms Digital Twin from "a tool you use at your desk" to "an always-available AI collaborator."

---

## The Vision

### Before (GUI-Only)
```
8:00 AM - Idea while commuting
  → Can't act on it, forget by the time you're at computer

2:00 PM - Quick status check
  → Open laptop, navigate to site, click around

9:00 PM - HOMЯ escalation needs answer
  → Don't see it until next morning
```

### After (Telegram-Connected)
```
8:00 AM - Idea while commuting
  → "Build a landing page for my new product"
  → Outcome created, worker started by the time you arrive

2:00 PM - Quick status check
  → /status
  → "3 outcomes active, 2 workers running, 1 escalation pending"

9:00 PM - HOMЯ escalation needs answer
  → Push notification: "Need your input on authentication approach"
  → Tap "Option A: JWT"
  → Work continues overnight
```

---

## Core Principle

> **The Conversational API should not duplicate logic. It translates messages to CLI commands.**

```
┌─────────────────────────────────────────────────────────────┐
│                    CONVERSATIONAL API                        │
│                                                              │
│   Telegram Bot                                               │
│        │                                                     │
│        ▼                                                     │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│   │   Parse     │───▶│   Route     │───▶│   Format    │    │
│   │   Intent    │    │   to CLI    │    │   Response  │    │
│   └─────────────┘    └─────────────┘    └─────────────┘    │
│        │                    │                   │           │
│        ▼                    ▼                   ▼           │
│   NLP/Classifier       rf commands         Markdown        │
│   or /commands         via API             for chat        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## User Experience

### Message Types

#### 1. Slash Commands (Direct Mapping to CLI)
```
/status              → rf status
/list                → rf list
/show out_abc123     → rf show out_abc123
/start out_abc123    → rf start out_abc123
/stop wrk_xyz789     → rf stop wrk_xyz789
/tasks out_abc123    → rf task list out_abc123
/escalations         → rf homr escalations --pending
```

#### 2. Natural Language (Intent Classification)
```
"Build a landing page for my startup"
  → Detected: create_outcome
  → rf new "Build a landing page for my startup"

"What's the status of the landing page?"
  → Detected: check_status
  → rf show $(rf list --name="landing page" --format=id | head -1)

"Add dark mode support"
  → Detected: iterate_outcome
  → rf outcome iterate out_abc123 --feedback="Add dark mode support"

"How's everything going?"
  → Detected: check_status
  → rf status

"Are there any typecheck errors?"
  → Detected: audit_outcome
  → rf audit

"Does it meet the success criteria?"
  → Detected: review_outcome
  → rf review out_abc123
```

#### 3. Quick Replies (For Escalations)
```
[Push Notification]
HOMЯ needs your input on "User Authentication" (outcome: API Backend)

Which approach should we use?
┌─────────────────────┐ ┌─────────────────────┐
│   A: JWT tokens     │ │  B: Session-based   │
└─────────────────────┘ └─────────────────────┘
┌─────────────────────┐
│   Let me think...   │
└─────────────────────┘
```

---

## Interaction Patterns

### Creating Outcomes
```
User: I want to build a Chrome extension that blocks distracting websites

Bot: Got it! Creating outcome: "Chrome Extension - Distraction Blocker"

  📋 Tasks will be generated from your intent
  🔧 Capabilities will be planned

  Ready to start a worker? [Start Worker] [Not Yet]

User: [Start Worker]

Bot: ✓ Worker started for "Chrome Extension - Distraction Blocker"
     I'll notify you when there's progress or if I need input.
```

### Status Checks
```
User: /status

Bot: 📊 Digital Twin Status

     Active Outcomes: 3
     ├─ Chrome Extension [4/12 tasks] 🔄 1 worker
     ├─ Landing Page [11/11 tasks] ✅ converging
     └─ API Backend [2/8 tasks] ⏸️ escalation pending

     Workers: 1 running
     Alerts: 0

     /show <id> for details
```

### Handling Escalations
```
[Push]
Bot: ⚠️ Need your input

     Outcome: API Backend
     Task: Implement user authentication

     The task description mentions "secure auth" but doesn't
     specify the method. Which approach?

     A: JWT with refresh tokens
        → Stateless, scalable, more complex client

     B: Session-based cookies
        → Simple, requires server state, traditional

     [A] [B] [More Context] [Skip for Now]

User: [A]

Bot: ✓ Using JWT with refresh tokens
     Worker will continue with this approach.
```

### Progress Updates
```
Bot: 📬 Progress Update - Chrome Extension

     Completed: "Set up manifest.json and project structure"
     Next: "Implement popup UI with blocklist management"

     Progress: ████░░░░░░ 4/12 tasks

     [View Details] [Pause Worker]
```

---

## Current Implementation

### Two-Pass Architecture

The conversational agent uses a **two-pass architecture** that separates tool selection from response formatting:

```
┌─────────────────────────────────────────────────────────────┐
│  PASS 1: Tool Execution                                      │
│  • Load skill file (role, tools, guidelines)                │
│  • Inject session context                                    │
│  • Claude outputs: TOOL_CALL: toolName(args)                │
│  • Parse and execute tools via our TypeScript executors     │
└─────────────────────────────────────────────────────────────┘
                    │ tool results (JSON)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  PASS 2: Formatting (only if tools were called)             │
│  • User message + tool results JSON                         │
│  • Formatting guidelines from skill file                     │
│  • Claude outputs: Natural markdown response                │
└─────────────────────────────────────────────────────────────┘
```

**Why two passes?**
- Claude CLI in print mode can't see tool results mid-conversation
- We must execute tools externally then send results back
- Removes need for hardcoded formatters - Claude adapts naturally

**Key files:**
- `skills/converse-agent.md` - Single source of truth (role, tools, format guidelines)
- `lib/converse/skill-loader.ts` - Parses skill file into sections
- `lib/converse/prompt-builder.ts` - Builds prompts for Pass 1 and Pass 2
- `lib/agents/converse-agent.ts` - Orchestrates two-pass execution

### `/api/converse-agent` Endpoint

The conversational API is implemented as a REST endpoint that handles all message types:

```typescript
POST /api/converse-agent
{
  "message": "What outcomes are active?",
  "sessionId": "sess_abc123"  // Optional, for context persistence
}
```

**Response:**
```typescript
{
  "success": true,
  "message": "**Active Outcomes** (2)\n- Landing Page (out_abc): 5/10 tasks done\n...",
  "sessionId": "sess_abc123",
  "toolCalls": [
    { "name": "getActiveOutcomes", "success": true, "data": {...} }
  ]
}
```

### Tool-Based Architecture (20+ Tools)

Instead of intent classification, the agent now uses Claude to select from 20+ tools:

| Category | Tools | Example Usage |
|----------|-------|---------------|
| **Status** | `getSystemStatus`, `getActiveOutcomes`, `getAllOutcomes` | "What's running?" |
| **Outcomes** | `getOutcome`, `getOutcomeTasks`, `getOutcomeWorkers`, `createOutcome`, `iterateOnOutcome` | "Show tasks for X" |
| **Workers** | `getActiveWorkers`, `startWorker`, `stopWorker`, `getWorkerDetails`, `getWorkerProgress` | "Start a worker" |
| **Escalations** | `getPendingEscalations`, `answerEscalation` | "Any questions?" |
| **Tasks** | `getTask`, `addTask`, `updateTask`, `findTask` | "Add context to task", "Optimize task" |
| **HOMR** | `getHomrStatus`, `getHomrDashboard`, `runAutoResolve` | "HOMR status" |
| **Capabilities** | `detectCapabilities`, `listCapabilities`, `createCapability` | "We need a skill for X" |

Claude decides which tool(s) to call based on the user's natural language query.

### Session Management

Conversations are persisted across messages:
- `conversation_sessions` - Session metadata, current outcome context
- `conversation_messages` - Message history per session

Sessions track:
- Current outcome (for contextual commands)
- Message history (for multi-turn conversations)
- Last activity (for session expiry)

---

## Technical Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      TELEGRAM BOT                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Message     │  │   Intent     │  │  Response    │       │
│  │  Handler     │──│  Classifier  │──│  Formatter   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                │                   │               │
│         └────────────────┼───────────────────┘               │
│                          │                                   │
│                    ┌─────▼─────┐                            │
│                    │ CLI/API   │                            │
│                    │ Executor  │                            │
│                    └─────┬─────┘                            │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │    Digital Twin API     │
              │    localhost:3000/api   │
              └─────────────────────────┘
```

### Message Flow

1. **Receive** - Telegram webhook receives message
2. **Classify** - Determine intent (command, natural language, reply)
3. **Route** - Map to appropriate CLI command or API call
4. **Execute** - Call the API
5. **Format** - Convert response to Telegram-friendly markdown
6. **Send** - Reply to user

### Push Notifications

The system needs to **push** to users for:
- Escalation requests (HOMЯ needs input)
- Task completions (milestone reached)
- Worker status changes (paused, failed, completed)
- Alerts (stuck worker, repeated failures)

**Implementation:**
- Polling loop checks for new escalations/alerts
- Or: Webhook from API when events occur
- Send Telegram message when events match notification rules

---

## Notification Settings

### Per-Outcome Configuration
```
/notify chrome-extension

Current notification settings for "Chrome Extension":
  ☑ Escalations (always)
  ☐ Task completions
  ☑ Worker status changes
  ☐ Progress every N tasks

  [Edit Settings]
```

### Global Settings
```
/settings

Notification preferences:
  Quiet hours: 11 PM - 7 AM
  Summary mode: Batch non-urgent notifications

  Default for new outcomes:
  ☑ Escalations
  ☐ All completions
  ☑ Outcome complete

  [Edit] [Test Notification]
```

---

## Security

### Authentication
- **Telegram User ID** whitelist - Only configured user(s) can interact
- **Optional PIN** for sensitive operations (delete, force stop)
- **Session tokens** expire after inactivity

### Access Control
```typescript
// config/telegram.yaml
allowed_users:
  - 123456789  # Your Telegram user ID

require_pin_for:
  - outcome delete
  - worker stop --all
  - config set
```

---

## Deployment

### Mac Mini Setup (Always-On)

```
┌─────────────────────────────────────────────────────────────┐
│                       MAC MINI                               │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Next.js    │  │  Telegram   │  │  Workers    │         │
│  │  Server     │  │  Bot        │  │  (Claude)   │         │
│  │  :3000      │  │  Process    │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                │                                   │
│         └────────────────┼───────────────────────────────────│
│                          │                                   │
│                   Cloudflare Tunnel                          │
│                   (for webhooks)                             │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Telegram   │
                    │   Servers    │
                    └──────────────┘
```

### Process Management
```bash
# Using PM2 for process management
pm2 start npm --name "digital-twin" -- run start
pm2 start npm --name "telegram-bot" -- run bot
pm2 save
pm2 startup  # Auto-start on boot
```

---

## Implementation Phases

### Phase 1: Slash Commands (Complete via CLI)
- [x] `/status` - System overview
- [x] `/list` - Active outcomes
- [x] `/show <id>` - Outcome details
- [x] `/start <id>` - Start worker
- [x] `/stop <id>` - Stop worker
- [x] `/help` - Available commands

### Phase 2: Escalation Handling (Partial)
- [ ] Push notifications for escalations
- [x] Quick reply buttons (answer/dismiss)
- [x] Answer confirmation
- [ ] "More context" expansion

### Phase 3: Natural Language (Complete)
- [x] Tool-based agent (25+ tools, Claude selects)
- [x] Two-pass architecture (tool execution + formatting)
- [x] Skill file as single source of truth
- [x] Context-aware responses (session management)
- [x] Pending action handling ("yes"/"no" follow-ups)
- [x] No hardcoded formatters - Claude formats naturally

### Phase 4: Progress Updates (Not Started)
- [ ] Configurable notifications
- [ ] Task completion batching
- [ ] Quiet hours
- [ ] Summary digests

### Phase 5: Full Conversational (Partial)
- [x] Multi-turn conversations (via sessions)
- [x] Entity tracking for pronoun resolution
- [ ] Clarification questions
- [ ] Voice message support (via transcription)

### Phase 6: Telegram Bridge (Not Started)
- [ ] Bot setup with Telegraf
- [ ] Webhook integration
- [ ] Push notifications
- [ ] Mac Mini deployment

---

## Example Bot Code Structure

```typescript
// telegram/bot.ts
import { Telegraf } from 'telegraf';
import { api } from '../cli/src/api';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Slash commands
bot.command('status', async (ctx) => {
  const status = await api.supervisor.status();
  const outcomes = await api.outcomes.list({ counts: true });
  ctx.reply(formatStatus(status, outcomes));
});

bot.command('list', async (ctx) => {
  const { outcomes } = await api.outcomes.list({ counts: true });
  ctx.reply(formatOutcomeList(outcomes));
});

bot.command('start', async (ctx) => {
  const outcomeId = ctx.message.text.split(' ')[1];
  const result = await api.post(`/outcomes/${outcomeId}/workers`, {});
  ctx.reply(`✓ Worker started for ${outcomeId}`);
});

// Natural language
bot.on('text', async (ctx) => {
  const intent = await classifyIntent(ctx.message.text);

  switch (intent.type) {
    case 'create_outcome':
      const response = await api.dispatch.send(intent.text, { modeHint: 'long' });
      ctx.reply(formatDispatchResponse(response));
      break;
    case 'check_status':
      // ... handle status check
      break;
    default:
      ctx.reply("I'm not sure what you mean. Try /help for commands.");
  }
});

bot.launch();
```

---

## Dependencies

### Required Before Starting
1. **CLI must be complete** - Telegram wraps CLI functionality
2. **API must support all operations** - Already done
3. **Mac Mini deployment** - For always-on availability

### Libraries
- **Telegraf** - Telegram bot framework
- **node-telegram-bot-api** - Alternative framework
- **Cloudflare Tunnel** - Webhook exposure without port forwarding

---

## Success Criteria

### API Foundation (Complete)
- [x] `/api/converse-agent` endpoint with session management
- [x] Two-pass architecture (tool selection + formatting)
- [x] 25+ tools available via skill file (including capability tools)
- [x] Session persistence in database
- [x] `disableNativeTools` option to prevent agentic loops

### Usability (Pending Telegram Bridge)
- [ ] Can create outcome from Telegram in < 30 seconds
- [ ] Escalation response takes < 10 seconds
- [x] Status check returns in < 2 seconds (via CLI/API)

### Reliability
- [ ] 99.9% uptime on Mac Mini
- [x] Graceful handling of API unavailability
- [ ] No lost messages during restarts

### Feature Parity
- [x] All critical operations available via API
- [ ] Escalations get immediate push notifications
- [x] Can manage outcomes without web UI (via CLI)

---

## Why This Matters

From James's original call:
> "The vision is I'm gonna be eventually be just chatting to a Telegram"

The Conversational API is what makes Digital Twin truly personal:
- **Accessible** - Use from anywhere, any device
- **Immediate** - Respond to escalations in real-time
- **Natural** - Chat like you would with a human assistant
- **Always-on** - Your AI workforce never sleeps

This is the feature that transforms daily usage from "when I'm at my desk" to "whenever I have an idea."

---

*The Telegram bridge is the difference between a tool and a collaborator.*
