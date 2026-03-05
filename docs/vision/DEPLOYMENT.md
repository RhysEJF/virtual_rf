# Deployment

> From polished UI to mobile chat to executive agent swarms.

---

## Purpose

Digital Twin has a deployment progression:

1. **Now:** Polished web UI for workflow refinement
2. **Next:** Chat-based interface via Telegram/CLI
3. **Future:** Mobile-first executive interface spawning agent swarms

The architecture must support all three without rebuilding.

---

## Status

| Capability | Status |
|------------|--------|
| Local development (Next.js) | Complete |
| SQLite persistence | Complete |
| Claude CLI integration | Complete |
| API-first architecture | Complete |
| Always-on deployment (Mac Mini) | Not Started |
| Cloudflare Tunnel | Not Started |
| Telegram bot (via claude-code-telegram) | Complete |
| Telegram → Flow integration | Complete |
| CLI thin client | Not Started |
| Push notifications | Not Started |

**Overall:** Telegram chat interface operational. Always-on deployment not yet built.

---

## Key Concepts

### The Deployment Progression

```
PHASE 1: LOCAL UI (Current)
─────────────────────────────
┌─────────────────────────┐
│   Browser               │
│   localhost:3000        │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│   Next.js + SQLite      │
│   Your laptop           │
│   Claude CLI            │
└─────────────────────────┘

Why: Polish workflows, debug issues, refine prompts.
Limitation: Must be at your computer.


PHASE 2a: TELEGRAM CHAT (Current)
──────────────────────────────────
┌─────────────────┐     ┌─────────────────┐
│   Your Phone    │     │   Your Laptop   │
│   Telegram      │     │   Browser       │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ claude-code-    │     │  localhost:3000  │
│ telegram (bot)  │     │  Flow UI        │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│   Your Laptop                           │
│   Claude Code CLI (via SDK)             │
│   ~/telegram-workspace/ (no sandbox)    │
│   Flow CLI available as a skill         │
└─────────────────────────────────────────┘

Why: Chat from phone, spawn Flow outcomes remotely.
Limitation: Laptop must be on with bot running.


PHASE 2b: ALWAYS-ON (Next)
───────────────────────────
Same as 2a but on a Mac Mini with Cloudflare Tunnel.
Benefit: Walk around, have ideas, spawn work 24/7.


PHASE 3: EXECUTIVE INTERFACE (Future)
──────────────────────────────────────
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Phone         │  │   Watch         │  │   AR Glasses    │
│   (Telegram)    │  │   (Voice)       │  │   (Rooms)       │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CORE API                                 │
│   Session management, outcome orchestration, worker swarms  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Outcome A│   │ Outcome B│   │ Outcome C│
        │ 3 workers│   │ 1 worker │   │ 5 workers│
        └──────────┘   └──────────┘   └──────────┘

Why: You become a new kind of executive.
Vision: Enter rooms (outcomes) in AR, coordinate agent swarms.
```

### The Executive Vision

Imagine this workflow:

```
You're at a conference. Someone mentions a problem.

You: *into Telegram* "There's a market for X. Build a
     demo tool, host it, make it investor-ready."

System: "Creating outcome: X Demo Tool
        Analyzing requirements...
        Spawning capability workers first:
        - Building API integration skill
        - Creating demo hosting tool
        Then execution:
        - 4 workers for core functionality
        - 1 worker for landing page

        Estimated demo-ready: 3 hours
        I'll notify you when ready."

3 hours later, you're having dinner...

System: *Telegram notification*
        "X Demo Tool is ready.
        Demo URL: https://x-demo.vercel.app

        Review found 2 minor issues:
        - Mobile layout needs adjustment
        - Loading state missing on submit

        Fixing now. Full completion in 20 min.

        Want me to generate an investor pitch deck?"

You: "Yes, and send me the highlights for my meeting tomorrow"

System: "Creating pitch deck outcome...
        I'll send a summary to your email by 10pm."
```

This is the future: **executives spawning agent swarms** to build, not just manage.

### Infrastructure Requirements

| Component | Purpose | Options |
|-----------|---------|---------|
| **Always-on compute** | Run workers 24/7 | Mac Mini, VPS, home server |
| **Tunnel** | Expose local API to internet | Cloudflare Tunnel, ngrok |
| **Chat interface** | Mobile access | Telegram Bot API |
| **Notifications** | Proactive updates | Telegram, push, email |
| **Claude subscription** | AI compute | Claude Max (no API costs) |

### Why Mac Mini?

1. **Claude CLI** - Uses your existing subscription, no API costs
2. **SQLite** - Simple, no database server needed
3. **Always-on** - Low power, runs 24/7
4. **Local compute** - No cloud costs for workers
5. **Your data** - Stays on your hardware

### Why Cloudflare Tunnel?

1. **No port forwarding** - Works behind any NAT/firewall
2. **HTTPS built-in** - Telegram requires HTTPS webhooks
3. **Free tier** - No cost for personal use
4. **Reliable** - Cloudflare's infrastructure

---

## Behaviors

1. **Local-first** - All data and compute stays on your hardware
2. **Progressive access** - UI → CLI → Chat → Voice → AR
3. **Always available** - 24/7 operation for async work
4. **Notification-driven** - System reaches out when needed
5. **Mobile-native** - Chat is the primary interface

---

## Success Criteria

- Can spawn work from anywhere with internet
- Workers run while you're away
- Notifications arrive for important events
- Demo-ready outputs within hours of request
- No ongoing cloud costs (uses Claude subscription)

---

## The Rooms Vision (Future)

The ultimate interface: AR rooms representing outcomes.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   You're wearing AR glasses. You see:                       │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │   ROOM 1    │  │   ROOM 2    │  │   ROOM 3    │        │
│   │ ProductX    │  │ ConsultingY │  │ New Venture │        │
│   │ 🟢 3 active │  │ 🟡 1 paused │  │ 🔵 complete │        │
│   └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│   You walk into ROOM 1. You see:                           │
│                                                             │
│   - Wall of tasks (kanban-style)                           │
│   - Worker avatars moving between tasks                    │
│   - Progress visualizations                                │
│   - Alert bubbles for issues needing attention             │
│                                                             │
│   You speak: "Add a testimonials section, high priority"    │
│                                                             │
│   A new task card appears. A worker picks it up.            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This requires:
- Rock-solid API (same one Telegram uses)
- Spatial session management
- Real-time worker state
- Voice command processing

But the **same API** powers it all.

---

## Open Questions

1. **Multi-device sessions** - Same conversation on phone and laptop?

2. **Offline resilience** - What if tunnel goes down? Queue commands?

3. ~~**Security** - How to authenticate Telegram users?~~
   **Resolved:** Telegram user ID whitelist (server-side enforced, not spoofable). macOS Seatbelt sandbox for bash commands. Sandbox excluded commands trimmed to only `git` and `npm`. Development mode backdoor closed.

4. **Resource limits** - How many concurrent workers on a Mac Mini?

5. **Backup strategy** - SQLite on single machine is risky. Sync to cloud?

---

## Related

- **Design:** [DEPLOYMENT.md](../design/DEPLOYMENT.md) - Infrastructure setup and configuration
- **Vision:** [API.md](./API.md) - The unified API that powers all interfaces
- **Vision:** [WORKER.md](./WORKER.md) - The agents that execute work
