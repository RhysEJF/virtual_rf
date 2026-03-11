# AG-UI Protocol: Integration Analysis for Flow

> Deep dive on the AG-UI (Agent-User Interaction) protocol and how its patterns could improve Flow's frontend-agent communication layer.

## Source Material

- [AG-UI Documentation](https://docs.ag-ui.com/introduction)
- [AG-UI GitHub](https://github.com/ag-ui-protocol/ag-ui)
- [@ag-ui/core npm package](https://www.npmjs.com/package/@ag-ui/core)

## What Is AG-UI?

AG-UI is an open, lightweight, event-based protocol that standardizes how AI agents connect to user-facing applications. It's the "HTTP for the agentic era" — defining a typed event stream (via SSE or WebSocket) so any agent can talk to any UI in a structured way.

Traditional REST/GraphQL fails for agentic applications because agents are:
- **Long-running** — stream intermediate work across multi-turn sessions
- **Nondeterministic** — behavior and UI control can't be predetermined
- **Mixed I/O** — simultaneously handle structured data (tool calls, state) and unstructured content (text, voice)
- **Interactive** — users need to pause, approve, edit, and steer execution mid-flow
- **Composable** — agents recursively call sub-agents requiring nested delegation

### The Three-Protocol Stack

| Layer | Protocol | Flow Equivalent |
|---|---|---|
| Agent ↔ User | **AG-UI** | Our polling-based API routes + OutcomeChat |
| Agent ↔ Tools | **MCP** | Our skill/tool injection into worker CLAUDE.md |
| Agent ↔ Agent | **A2A** | Our HOMR cross-worker observations + interventions |

## Core Architecture

AG-UI implements a client-server structure with four layers:
- **Frontend Application** — User-facing interfaces
- **AG-UI Client** — Communication handlers (e.g., `HttpAgent`)
- **Backend Agents** — AI processors generating streaming responses
- **Secure Proxy** — Security and additional capability layer

Agents extend `AbstractAgent` and implement a `run(input: RunAgentInput)` method that returns an `Observable<BaseEvent>` stream.

### 15 Primary Capabilities

**Communication & Data Flow**: Streaming chat (token/event streaming with cancel/resume), custom events

**Multimodal**: Typed attachments, real-time media, voice, previews, annotations, provenance tracking

**UI Generation**: Static generative UI (typed components), declarative generative UI (agent proposes trees, app validates), backend tool rendering

**State Management**: Shared state with read-only and read-write stores, event-sourced diffs, conflict resolution

**Agent Transparency**: Thinking steps visualization, interrupts (human-in-the-loop), agent steering

**Tool Integration**: Frontend tool calls (typed handoffs from agent to browser-executed actions), tool output streaming

**Composition**: Sub-agents with scoped state, tracing, and cancellation

## Event System

Events are the fundamental units of communication. All events share base properties: `type`, `timestamp`, and `rawEvent`.

### Seven Event Categories

1. **Lifecycle Events**: `RunStarted`, `StepStarted`/`StepFinished`, `RunFinished`, `RunError`
2. **Text Message Events**: `TextMessageStart` → `TextMessageContent` chunks → `TextMessageEnd`
3. **Tool Call Events**: `ToolCallStart` → `ToolCallArgs` chunks → `ToolCallEnd`, plus `ToolCallResult`
4. **State Management Events**: `StateSnapshot` (complete state), `StateDelta` (JSON Patch RFC 6902)
5. **Activity Events**: `ActivitySnapshot` + `ActivityDelta` for in-progress work
6. **Special Events**: `Raw` (passthrough) and `Custom` (application-defined extensions)
7. **Reasoning Events**: `ReasoningStart`/`Content`/`End` for chain-of-thought visibility

### Event Flow Patterns

- **Start-Content-End**: Streams text and tool arguments incrementally
- **Snapshot-Delta**: Synchronizes state via complete snapshots + lightweight JSON patches
- **Lifecycle**: Monitors agent execution from initiation through completion

## Shared State Management

Bidirectional state sync between agent and frontend using two mechanisms:

- **StateSnapshot**: Complete state replacement — used for initial load, reconnection, major changes
- **StateDelta**: Incremental JSON Patch (RFC 6902) operations — `add`, `replace`, `remove`, `move`

Patches applied atomically using `fast-json-patch`. Frontends can request fresh snapshots if inconsistencies emerge.

## Frontend Tool Calls

Tools are defined in the frontend and passed to agents during execution. The agent calls tools by name, streaming arguments as JSON. The frontend accumulates fragments, validates against the tool's schema, executes the function, and returns results to the agent as conversation history.

This enables human-in-the-loop workflows where agents request user confirmation or data verification before proceeding.

## SDK

`@ag-ui/core` provides:
- **Types**: `RunAgentInput`, `Message`, `Context`, `Tool`, `State`
- **Events**: 16 standardized event types across 5 categories
- **Agents**: `AbstractAgent` (base), `HttpAgent` (remote HTTP connections)
- **Transport**: SSE (text-based, debuggable) and binary protocols (performant)

## Where Flow and AG-UI Overlap

### 1. Worker Progress → UI (biggest gap)
- **AG-UI**: Real-time event stream (`RUN_STARTED` → `TEXT_MESSAGE_CONTENT` chunks → `STATE_DELTA` → `RUN_FINISHED`). Token-by-token streaming.
- **Flow today**: `setInterval` polling every 3-10 seconds across 12+ components. Workers write to `progress_entries` DB table, UI polls API routes. No streaming.
- **Overlap**: Both solve the same problem — getting agent state to the user in real-time.

### 2. Human-in-the-Loop / Interrupts
- **AG-UI**: First-class interrupts — agents pause, emit an interrupt event, UI renders approval/edit UI, user responds, agent resumes. State preserved throughout.
- **Flow today**: Task gates (`document_required`, `human_approval`), escalations, interventions. Workers check for interventions between task claims. Escalations create UI alerts that require manual resolution.
- **Overlap**: Same concept, different implementation. AG-UI's is more real-time and bidirectional.

### 3. Shared State
- **AG-UI**: `STATE_SNAPSHOT` + `STATE_DELTA` (JSON Patch RFC 6902). Agent and frontend share a typed state object with efficient incremental sync.
- **Flow today**: No shared state concept. UI fetches full outcome/task/worker objects on each poll. No delta/patch mechanism.

### 4. Frontend Tool Calls
- **AG-UI**: Agent can call tools that execute *in the browser* — the agent emits `TOOL_CALL_START`, the frontend runs the tool, returns the result.
- **Flow today**: All tools are backend-only (Claude CLI, file system). No concept of frontend-executed tools.

### 5. Agent Lifecycle Events
- **AG-UI**: `RunStarted` → `StepStarted/Finished` → `RunFinished/RunError`. Structured lifecycle.
- **Flow today**: Worker status enum (`running`, `paused`, `completed`, `failed`). Task status enum (`pending`, `claimed`, `running`, `completed`, `failed`). Similar concept, but coarser-grained and poll-based.

## What We Should Borrow (Ranked by Impact)

### 1. SSE Event Stream for Worker Progress — HIGH IMPACT

**What**: Replace polling with Server-Sent Events. Workers emit typed events, a single SSE endpoint streams them to the UI.

**Why it improves Flow**:
- Eliminates 12+ `setInterval` polls (3-30s latency → instant)
- Real-time token streaming from workers (see Claude thinking live)
- Lower server load (no repeated full-object fetches)
- Foundation for everything else below

**What to change**:
- Add `app/api/outcomes/[id]/stream/route.ts` — SSE endpoint
- Worker writes events to a channel (DB table or in-memory pub/sub)
- Replace `setInterval` in outcome page, worker page, dashboard with `EventSource`
- Define Flow event types: `worker.started`, `task.claimed`, `task.completed`, `progress.update`, `escalation.created`, `homr.observation`, etc.

**Effort**: Medium. Core change is one SSE route + refactoring polling hooks into a `useEventStream` hook.

### 2. State Snapshots + Deltas — MEDIUM IMPACT

**What**: Instead of fetching the full outcome object (tasks, workers, design doc, etc.) on every poll, send an initial snapshot then stream JSON Patch deltas.

**Why it improves Flow**:
- Outcome pages currently re-fetch the entire outcome + all tasks + all workers every 5 seconds
- With deltas, the UI only receives what changed (a task status flip, a new progress entry)
- Smoother UI — no full re-renders on every poll cycle

**What to change**:
- Track outcome version/timestamp server-side
- SSE endpoint sends `STATE_SNAPSHOT` on connect, then `STATE_DELTA` events
- Use `fast-json-patch` (or similar) to compute and apply diffs
- `useOutcome` hook manages local state with patch application

**Effort**: Medium. Builds on #1.

### 3. Structured Interrupt Protocol for Gates/Escalations — MEDIUM IMPACT

**What**: Formalize the gate/escalation flow as a typed interrupt event. When a worker hits a gate, it emits an `INTERRUPT` event with structured data (what it needs, options, context). UI renders a purpose-built approval/input component. User responds. Worker resumes.

**Why it improves Flow**:
- Gates today are somewhat disconnected — worker skips the task, escalation appears in HOMR dashboard, user resolves it asynchronously
- With interrupts, the user sees the request *immediately* in context, responds inline, and the worker continues without reclaiming
- Enables richer gate types (multi-choice, file upload, code review)

**What to change**:
- Define `InterruptEvent` type with `reason`, `options`, `context`
- Worker emits interrupt via the event stream
- New `InterruptBanner` component that renders inline in outcome page
- Resolution writes back to the interrupt, worker picks it up

**Effort**: Medium-High. Touches worker loop, event stream, and UI.

### 4. Frontend Tool Calls — LOWER PRIORITY BUT INTERESTING

**What**: Let workers request actions that execute in the user's browser — open a URL, show a preview, request clipboard content, trigger a file picker.

**Why it improves Flow**:
- Workers currently can't interact with the user's local environment through the UI
- Could enable "show me what this looks like" previews during execution
- Could let workers request user input mid-task without the full gate/escalation ceremony

**What to change**:
- Define frontend tool registry in the UI
- Workers emit `TOOL_CALL` events for frontend tools
- UI executes and returns results via the event stream
- Requires bidirectional channel (WebSocket or long-polling response)

**Effort**: High. Requires bidirectional communication (SSE is one-way).

### 5. Activity/Thinking Events — LOW EFFORT, NICE UX

**What**: AG-UI has `ReasoningStart/Content/End` events that visualize agent thinking. We could stream worker reasoning steps (complexity estimation, skill matching, decomposition decisions) as structured events.

**Why it improves Flow**:
- ProgressView currently shows flat log lines
- Structured thinking events could render as collapsible reasoning chains
- Better transparency into *why* a worker made decisions

**What to change**:
- Tag worker log entries with event types (`complexity_check`, `skill_match`, `decomposition`, `task_claim`)
- Render them with appropriate UI (collapsible, icons, severity)

**Effort**: Low. Mostly a UI/presentation change on existing data.

## What We Should NOT Adopt

- **Generative UI** — AG-UI lets agents generate UI components. Flow's workers are code-executing agents, not conversational ones. Our UI is purpose-built. This adds complexity without value for our use case.
- **@ag-ui/core SDK directly** — It's designed for connecting to AG-UI-compatible backends. Our backend is Claude CLI processes, not an AG-UI agent server. We'd borrow the *concepts* (event types, state sync) not the library.
- **A2A protocol for worker-to-worker** — Our workers are isolated Claude CLI processes that don't directly communicate. HOMR's observation/steering pattern is more appropriate for our architecture.

## Integration Path (Ecosystem Play)

The most natural integration: **make Flow's event stream AG-UI compatible**. If Flow emitted AG-UI-formatted events from its SSE endpoint, then any AG-UI client (CopilotKit, custom React app, etc.) could connect to a Flow outcome and see live worker progress, respond to interrupts, and interact with the system — without our custom UI.

This would mean:
1. Flow becomes an AG-UI-compatible agent backend
2. The AG-UI protocol becomes the transport layer for Flow's UI
3. Other people could build alternative UIs for Flow using AG-UI clients

**The minimal version**: Implement SSE with AG-UI event types in one endpoint. Everything else is incremental.

## Summary

| Idea | Impact | Effort | Recommendation |
|------|--------|--------|----------------|
| SSE event stream | High | Medium | **Do first** — kills 12 polling intervals |
| State snapshots + deltas | Medium | Medium | Do second, builds on SSE |
| Structured interrupts | Medium | Med-High | Do third, improves gates/escalations |
| Frontend tool calls | Low-Med | High | Explore later |
| Thinking/activity events | Low | Low | Easy win, do anytime |
| AG-UI compatibility | High (ecosystem) | Medium | Consider for external access |

**Bottom line**: AG-UI's biggest lesson for Flow is "stop polling, start streaming." Our architecture is ready for it — we just need one SSE endpoint and a hook refactor. The event type taxonomy and state sync patterns are well-designed and worth adopting conceptually, even if we don't use their SDK directly.

## Flow's Current Communication Architecture (Reference)

For context, here's how Flow currently handles UI-agent communication:

**Polling intervals across the app:**
- Outcome page: 5s (`/api/outcomes/{id}?relations=true`)
- Worker page: 3s (`/api/workers/{id}`, `/api/workers/{id}/logs`)
- ProgressView: 10s (`/api/outcomes/{id}/progress`)
- Dashboard: 5s (all outcomes)
- ActivityFeed: 10s
- SupervisorAlerts: 10s
- HomrStatusCard: 30s
- ImprovementSuggestions: 30s
- Supervisor/Insights pages: 30s

**Intervention flow**: UI → POST `/api/outcomes/{id}/interventions` → DB record → Worker polls `getPendingInterventionsForWorker()` between tasks → processes intervention → UI polls to see result

**No SSE, no WebSocket, no streaming** — entirely HTTP polling.

**Key files**:
- `app/outcome/[id]/page.tsx` — Main polling orchestrator (5s interval)
- `app/components/ProgressView.tsx` — Progress display + polling (10s)
- `app/components/OutcomeChat.tsx` — Chat-like request interpreter
- `app/components/InterventionForm.tsx` — Intervention UI
- `lib/ralph/worker.ts` — Worker main loop (intervention check at line ~1149)
