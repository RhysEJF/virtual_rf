# UI - Design

> Implementation details for frontend components and patterns.

---

## Architecture

### Framework

- **Next.js 14** - App Router
- **React 18** - Functional components with hooks
- **Tailwind CSS** - Utility-first styling
- **TypeScript** - Strict mode

### Directory Structure

```
app/
├── page.tsx                    # Dashboard
├── outcome/[id]/page.tsx       # Outcome detail
├── worker/[id]/page.tsx        # Worker detail
├── skills/page.tsx             # Skills library
├── settings/page.tsx           # Settings
├── components/                 # Shared components
│   ├── ui/                     # Base components
│   └── homr/                   # HOMЯ components
└── api/                        # API routes
```

---

## Color Palette

```css
/* Earthy matte theme */
:root {
  --background: #1a1a1a;      /* Deep charcoal */
  --surface: #252525;         /* Warm dark gray */
  --border: #333333;          /* Soft separator */
  --text-primary: #e5e5e5;    /* Warm white */
  --text-secondary: #888888;  /* Muted gray */
  --accent: #7c9a6c;          /* Sage green */
  --warning: #c9a959;         /* Muted gold */
  --error: #a65d5d;           /* Dusty rose */
  --success: #5d8a6b;         /* Forest green */
}
```

---

## Component Inventory

### Navigation & Layout

| Component | File | Purpose |
|-----------|------|---------|
| CommandBar | `CommandBar.tsx` | Main command input |
| OutcomeCommandBar | `OutcomeCommandBar.tsx` | Per-outcome contextual commands |
| OutcomeBreadcrumbs | `OutcomeBreadcrumbs.tsx` | Hierarchical navigation |
| SystemStatus | `SystemStatus.tsx` | Claude CLI and DB status |
| ThemeToggle | `ThemeToggle.tsx` | Light/dark mode |

### Outcome Display

| Component | File | Purpose |
|-----------|------|---------|
| OutcomeCard | `OutcomeCard.tsx` | Summary card with stats |
| OutcomeTreeView | `OutcomeTreeView.tsx` | Hierarchical tree view |
| CreateChildModal | `CreateChildModal.tsx` | Create nested outcomes |
| ChildOutcomesList | `ChildOutcomesList.tsx` | Display children |

### Work Display

| Component | File | Purpose |
|-----------|------|---------|
| ExpandableTaskCard | `ExpandableTaskCard.tsx` | Task details (~17.9KB) |
| ProgressView | `ProgressView.tsx` | Real-time progress |
| ActivityFeed | `ActivityFeed.tsx` | Event timeline |

### Specialized Sections

| Component | File | Purpose |
|-----------|------|---------|
| OutputsSection | `OutputsSection.tsx` | Auto-detected deliverables |
| DocumentsSection | `DocumentsSection.tsx` | Uploaded documents |
| SkillsSection | `SkillsSection.tsx` | Available skills |
| SkillDetailModal | `SkillDetailModal.tsx` | Skill viewer |
| GitConfigSection | `GitConfigSection.tsx` | Git workflow config |
| IterateSection | `IterateSection.tsx` | Post-completion feedback |
| InterventionForm | `InterventionForm.tsx` | Send worker instructions |
| SupervisorAlerts | `SupervisorAlerts.tsx` | Safety alerts |
| ImprovementSuggestions | `ImprovementSuggestions.tsx` | Auto-generated ideas |

### Base UI (`app/components/ui/`)

| Component | Purpose |
|-----------|---------|
| Card | Container with border |
| Badge | Status indicators |
| Button | Actions (variants: default, outline, ghost) |
| Input | Text entry |
| Textarea | Multi-line text |
| Progress | Progress bar |
| Toast | Notifications |
| Dialog | Modal dialogs |
| Tooltip | Hover information |

---

## State Patterns

### Command Bar States

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

### Polling Pattern

```typescript
// Real-time updates via polling (SSE planned but not implemented)
useEffect(() => {
  const fetchData = async () => {
    const res = await fetch(`/api/outcomes/${id}`);
    const data = await res.json();
    setOutcome(data);
  };

  fetchData();
  const interval = setInterval(fetchData, 5000);
  return () => clearInterval(interval);
}, [id]);
```

### Toast Notifications

```typescript
import { useToast } from '@/app/components/ui/use-toast';

const { toast } = useToast();

toast({
  title: "Worker started",
  description: "Ralph is now working on your tasks",
  variant: "default" // or "destructive"
});
```

---

## Page Layouts

### Dashboard Layout

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

### Outcome Detail Layout

```
┌─────────────────────────────────────────────────┐
│  Breadcrumbs: Home > Outcome Name                │
├─────────────────────────────────────────────────┤
│  Intent Section (collapsible)                    │
├─────────────────────────────────────────────────┤
│  Approach Section (collapsible)                  │
├─────────────────────────────────────────────────┤
│  Tasks Section                                   │
│  ┌─────────────────────────────────────────────┐│
│  │ [Expandable Task Card]                       ││
│  │ [Expandable Task Card]                       ││
│  └─────────────────────────────────────────────┘│
├─────────────────────────────────────────────────┤
│  Workers | Skills | Outputs | Documents          │
├─────────────────────────────────────────────────┤
│  Iterate Section (post-completion)               │
└─────────────────────────────────────────────────┘
```

---

## Responsive Breakpoints

```css
/* Tailwind defaults */
sm: 640px   /* Small devices */
md: 768px   /* Medium devices */
lg: 1024px  /* Large devices */
xl: 1280px  /* Extra large */
2xl: 1536px /* 2x extra large */
```

---

## API Integration

All data fetching uses standard fetch with the Next.js API routes:

```typescript
// Fetch outcome
const res = await fetch(`/api/outcomes/${id}`);
const outcome = await res.json();

// Create task
await fetch(`/api/outcomes/${id}/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title, description })
});

// Start worker
await fetch(`/api/outcomes/${id}/workers`, {
  method: 'POST'
});
```
