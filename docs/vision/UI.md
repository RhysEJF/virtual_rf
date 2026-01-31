# UI

> Frontend components and pages for user interaction.

---

## Purpose

The UI is the user's window into Digital Twin. It provides:

1. **Command input** - Voice/text entry for requests
2. **Outcome management** - View, edit, organize outcomes
3. **Progress visibility** - See what workers are doing
4. **Intervention capability** - Pause, redirect, provide feedback
5. **Skill browsing** - View available capabilities

---

## Status

| Capability | Status |
|------------|--------|
| Dashboard with outcome list | Complete |
| Outcome detail page | Complete |
| Split panel layout (context/control) | Complete |
| Collapsible sections with persistence | Complete |
| Unified outcome chat | Complete |
| Worker drill-down page | Complete |
| Skills library page | Complete |
| Command bar (voice/text) | Complete |
| Dark/light theme | Complete |
| Real-time updates (polling) | Complete |
| Responsive design | Complete |
| Settings page (repositories) | Complete |
| Commit settings (renamed from save targets) | Complete |
| Repository inheritance UI | Complete |
| Tools section with sync status | Complete |
| HOMЯ escalation alerts (always visible) | Complete |
| Escalation dismiss functionality | Complete |

**Overall:** Complete and production-ready (35+ components, 5 pages)

---

## Key Concepts

### Design Principles

From DESIGN.md:

- **Minimalistic, not busy** - Focus on content
- **Matte, not shiny** - Earthy, calm aesthetic
- **Dark mode optimized** - For long work sessions
- **Voice-first input** - Natural language entry
- **Progressive disclosure** - Summary first, details on demand

### Pages

| Page | Purpose |
|------|---------|
| **Dashboard** | All outcomes, activity feed, alerts |
| **Outcome Detail** | Full management UI with split panel layout |
| **Worker Detail** | Drill-down into running worker |
| **Skills Library** | Browse global and outcome skills |
| **Settings** | Repository configuration, system preferences |

### Split Panel Layout (Outcome Detail)

The outcome detail page uses a split panel design:

**Left Panel (40%) - Context:**
- Intent (What) - Collapsible, expanded by default
- Approach (How) - Collapsible
- Tasks - Collapsible with progress badge
- Git & Commit Settings - Collapsible
- Skills, Tools, Documents - Collapsible

**Right Panel (60%) - Control Tower:**
- HOMЯ Alerts - Always at top, never buried
- Workers - With intervention form when running
- Progress - Task completion status
- OutcomeChat - Unified conversation interface
- Outputs - Auto-detected deliverables
- Worker Progress - Episodic memory view
- Actions - Quick action buttons

### Collapsible Sections

Sections persist their expanded/collapsed state in localStorage so users' preferences are remembered across sessions.

### Unified Chat (OutcomeChat)

Single chat interface that merges:
- Command interpretation (understand → suggest → approve → execute)
- Iteration feedback (describe issues → create tasks)
- Quick submit for post-work feedback with optional worker start

### Command Bar

The primary input mechanism. Accepts natural language, dispatches to appropriate handlers, shows staged confirmations before executing.

### Intervention System

Users can send instructions to running workers:
- Pause/resume controls
- Text instructions
- Redirect focus

### Real-Time Updates

Currently uses polling (every 5 seconds) for updates. SSE (Server-Sent Events) is planned but not implemented.

---

## Behaviors

1. **Voice-first** - Natural language is the primary input
2. **Progressive disclosure** - Summary cards expand to details
3. **Non-blocking** - UI remains responsive while workers run
4. **Observable** - Every worker action is visible in progress logs

---

## Success Criteria

- Users can create and manage outcomes without touching code
- Worker progress is visible in real-time
- Interventions reach workers promptly
- Theme is comfortable for long work sessions

---

## Open Questions

1. **Real-time updates** - Polling works but is inefficient. SSE would be better but adds complexity.

2. **Mobile support** - Responsive design exists but not optimized for mobile-first use.

3. **Accessibility** - Basic a11y in place but needs audit.

4. **Offline support** - Currently requires active connection. Could cache state locally.

5. **Performance** - Large outcome lists may need virtualization.

---

## Related

- **Design:** [UI.md](../design/UI.md) - Component inventory, color palette, and implementation patterns
- **Vision:** [DISPATCHER.md](./DISPATCHER.md) - How command bar routes requests
