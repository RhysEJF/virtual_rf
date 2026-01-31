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

## Current State

**Status:** Complete and production-ready

The UI includes:
- 25+ React components
- 4 main pages (Dashboard, Outcome, Worker, Skills)
- Dark/light theme support
- Real-time updates (polling-based)
- Responsive design

---

## Design Principles

From DESIGN.md:

- **Minimalistic, not busy** - Focus on content
- **Matte, not shiny** - Earthy, calm aesthetic
- **Dark mode optimized** - For long work sessions
- **Voice-first input** - Natural language entry
- **Progressive disclosure** - Summary first, details on demand

### Color Palette

```
Background:    #1a1a1a (deep charcoal)
Surface:       #252525 (warm dark gray)
Border:        #333333 (soft separator)
Text Primary:  #e5e5e5 (warm white)
Text Secondary:#888888 (muted gray)
Accent:        #7c9a6c (sage green)
Warning:       #c9a959 (muted gold)
Error:         #a65d5d (dusty rose)
Success:       #5d8a6b (forest green)
```

---

## Pages

### Dashboard (`app/page.tsx`)

The home page showing all outcomes.

**Features:**
- Outcome list (flat or tree view)
- Filter by status (active/dormant/achieved)
- Command bar for new requests
- Activity feed
- Supervisor alerts
- Improvement suggestions

**Layout:**
```
┌─────────────────────────────────────────────────┐
│  Command Bar                                     │
├────────────────────────┬────────────────────────┤
│  OUTCOMES              │  ACTIVITY              │
│  ─────────             │  ────────              │
│  [Outcome Card]        │  [Activity Item]       │
│  [Outcome Card]        │  [Activity Item]       │
│  [Outcome Card]        │  [Activity Item]       │
├────────────────────────┴────────────────────────┤
│  Supervisor Alerts | Improvement Suggestions     │
└─────────────────────────────────────────────────┘
```

### Outcome Detail (`app/outcome/[id]/page.tsx`)

Full management UI for a single outcome.

**Sections:**
- Intent (PRD) with ramble box
- Approach (Design Doc) with ramble box
- Active Tasks with expandable cards
- Workers with status and controls
- Skills available for this outcome
- Outputs (auto-detected deliverables)
- Documents (uploaded reference materials)
- Iterate (post-completion feedback)

### Worker Detail (`app/worker/[id]/page.tsx`)

Drill-down into a running worker.

**Features:**
- Current task details
- Live progress log
- Iteration count
- Intervention form
- Pause/Resume controls

### Skills Library (`app/skills/page.tsx`)

Browse available skills.

**Features:**
- Global skills tab
- Outcome-specific skills tab
- Skill content viewer (modal)
- Search/filter

---

## Components

### Navigation & Layout

| Component | Purpose |
|-----------|---------|
| `CommandBar.tsx` | Main command input |
| `OutcomeCommandBar.tsx` | Per-outcome contextual commands |
| `OutcomeBreadcrumbs.tsx` | Hierarchical navigation |
| `SystemStatus.tsx` | Claude CLI and DB status |
| `ThemeToggle.tsx` | Light/dark mode |

### Outcome Display

| Component | Purpose |
|-----------|---------|
| `OutcomeCard.tsx` | Summary card with stats |
| `OutcomeTreeView.tsx` | Hierarchical tree view |
| `CreateChildModal.tsx` | Create nested outcomes |
| `ChildOutcomesList.tsx` | Display children |

### Work Display

| Component | Purpose |
|-----------|---------|
| `ExpandableTaskCard.tsx` | Task details (17.9KB) |
| `ProgressView.tsx` | Real-time progress |
| `ActivityFeed.tsx` | Event timeline |

### Specialized Sections

| Component | Purpose |
|-----------|---------|
| `OutputsSection.tsx` | Auto-detected deliverables |
| `DocumentsSection.tsx` | Uploaded documents |
| `SkillsSection.tsx` | Available skills |
| `SkillDetailModal.tsx` | Skill viewer |
| `GitConfigSection.tsx` | Git workflow config |
| `IterateSection.tsx` | Post-completion feedback |
| `InterventionForm.tsx` | Send worker instructions |
| `SupervisorAlerts.tsx` | Safety alerts |
| `ImprovementSuggestions.tsx` | Auto-generated ideas |

### Base UI (`app/components/ui/`)

| Component | Purpose |
|-----------|---------|
| `Card.tsx` | Container |
| `Badge.tsx` | Status indicators |
| `Button.tsx` | Actions |
| `Input.tsx` | Text entry |
| `Progress.tsx` | Progress bar |
| `Toast.tsx` | Notifications |

---

## Patterns

### Command Bar States

The command bar has multiple modes:

```typescript
type CommandState =
  | 'idle'         // Ready for input
  | 'interpreting' // Processing input
  | 'suggesting'   // Showing suggestions
  | 'editing'      // Editing suggestions
  | 'confirming'   // Staged for approval
  | 'executing'    // Running actions
  | 'error';       // Something failed
```

### Real-Time Updates

Currently uses polling (every 5 seconds) to fetch updates:

```typescript
useEffect(() => {
  const interval = setInterval(fetchProgress, 5000);
  return () => clearInterval(interval);
}, []);
```

**Note:** SSE (Server-Sent Events) is planned but not implemented.

### Toast Notifications

```typescript
const { toast } = useToast();

toast({
  title: "Worker started",
  description: "Ralph is now working on your tasks",
  variant: "default" // or "destructive"
});
```

---

## Dependencies

**Uses:**
- Next.js 14 App Router
- Tailwind CSS
- React hooks

**Used by:**
- End users (browser)

---

## Open Questions

1. **Real-time updates** - Polling works but is inefficient. SSE would be better but adds complexity.

2. **Mobile support** - Responsive design exists but not optimized for mobile-first use.

3. **Accessibility** - Basic a11y in place but needs audit.

4. **Offline support** - Currently requires active connection. Could cache state locally.

5. **Performance** - Large outcome lists may need virtualization.
