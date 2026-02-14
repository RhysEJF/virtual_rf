# Enriched Tasks Design

> Adding optional "What" and "How" context to individual tasks

## Problem

Currently, intent (PRD) and approach (design doc) live at the outcome level only. For complex outcomes with many tasks, users want to:

1. Add specific context to individual tasks ("for this task, use X methodology")
2. Ramble into the "how" of specific work items
3. Have that per-task context inform skill/tool building

The alternative (nested outcomes) creates outcome sprawl and navigation complexity.

## Solution

Add optional `task_intent` and `task_approach` fields to tasks. Users can enrich tasks that need context while keeping simple tasks lightweight.

---

## Schema Changes

### Tasks Table

```sql
ALTER TABLE tasks ADD COLUMN task_intent TEXT;      -- Optional "what" for this task
ALTER TABLE tasks ADD COLUMN task_approach TEXT;    -- Optional "how" for this task
```

Both nullable. Most tasks stay simple (title + description). Users enrich when needed.

### TypeScript Types

```typescript
interface Task {
  id: string;
  outcome_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  phase: 'infrastructure' | 'execution';
  priority: number;
  from_review: boolean;
  // NEW
  task_intent: string | null;           // Mini-PRD for this task
  task_approach: string | null;         // How to execute this task
  required_capabilities: string | null; // JSON array: ["skill:name", "tool:name"]
  created_at: number;
  updated_at: number;
}
```

**Note:** `required_capabilities` is auto-populated when using "Optimize Context" but can also be set manually via API or converse tools.

---

## UI Changes

### Task Card (Collapsed - Default)

```
┌─────────────────────────────────────────────────────────────┐
│ ▶ Build input form with 6-8 fields                  Pending │
│   Create form fields for technician count, rates...         │
│                                            [📝 Has context] │
└─────────────────────────────────────────────────────────────┘
```

- Chevron indicates expandable
- Small indicator if task has intent/approach defined
- Click to expand

### Task Card (Expanded)

```
┌─────────────────────────────────────────────────────────────┐
│ ▼ Build input form with 6-8 fields                  Pending │
├─────────────────────────────────────────────────────────────┤
│ Create form fields for technician count, billable rates,    │
│ hours per week, turnover data, and owner stress proxy.      │
├─────────────────────────────────────────────────────────────┤
│ WHAT (Task Intent)                                   [Edit] │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Capture 6-8 high-signal inputs with minimal friction.   │ │
│ │ Required: technician count, billable rate, hours/week,  │ │
│ │ turnover count, replacement time, ramp-up time.         │ │
│ │ Optional: owner escalation %, firefighting hours.       │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ HOW (Task Approach)                                  [Edit] │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Use HTML5 form with range sliders for numeric inputs.   │ │
│ │ Real-time validation. Mobile-first responsive design.   │ │
│ │ Store nothing server-side - all client-side JS.         │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Add context to this task...                             │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Optimize Context]  AI will structure your ramble          │
└─────────────────────────────────────────────────────────────┘
```

### Ramble Flow

1. User clicks task to expand
2. Types in ramble box: "make sure the sliders feel nice on mobile, maybe use a library like noUiSlider, and validate that numbers make sense - like you can't have negative technicians"
3. Clicks "Optimize Context"
4. AI parses ramble → updates task_intent and/or task_approach
5. Structured context appears in the What/How sections

### Alternative: Dedicated Task Detail Modal

For more complex tasks, clicking could open a modal:

```
┌─────────────────────────────────────────────────────────────┐
│ Build input form with 6-8 fields                    [Close] │
├─────────────────────────────────────────────────────────────┤
│ Status: [Pending ▼]                                         │
├─────────────────────────────────────────────────────────────┤
│ Description                                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Create form fields for technician count, billable...    │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ What should this task achieve?                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Ramble box for intent...]                              │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Optimize What]                                             │
│                                                             │
│ Current Intent:                                             │
│ Capture 6-8 high-signal inputs with minimal friction...    │
├─────────────────────────────────────────────────────────────┤
│ How should this task be done?                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Ramble box for approach...]                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Optimize How]                                              │
│                                                             │
│ Current Approach:                                           │
│ Use HTML5 form with range sliders for numeric inputs...    │
├─────────────────────────────────────────────────────────────┤
│                                              [Save] [Cancel]│
└─────────────────────────────────────────────────────────────┘
```

---

## API Changes

### PATCH /api/tasks/[id]

Accepts new fields:

```json
{
  "task_intent": "Capture 6-8 high-signal inputs...",
  "task_approach": "Use HTML5 form with range sliders..."
}
```

### POST /api/tasks/[id]/optimize-context

New endpoint for ramble → structured:

```json
// Request
{
  "ramble": "make sure sliders feel nice on mobile, use noUiSlider..."
}

// Response
{
  "task_intent": "...",      // Updated or null if no changes
  "task_approach": "...",    // Updated or null if no changes
  "capabilities": {
    "detected": ["skill:noUiSlider Integration"],
    "references": ["Web Components"],
    "setOnTask": ["skill:nouislider-integration"]
  }
}
```

This calls Claude to parse the ramble and determine what's "what" vs "how".

**Capability Detection (Added 2026-02-05):**
The endpoint now also runs capability detection on the ramble text using `lib/capabilities/detection.ts`. Any skills or tools mentioned are automatically added to the task's `required_capabilities` field. Workers will skip the task until those capabilities exist in the workspace.

---

## Infrastructure Planning Integration

Currently, the infrastructure planner looks at:
- Outcome intent
- Outcome approach

Updated to also consider:
- Task-level approaches (task_approach field)

### Example Flow

1. Outcome: "Build ROI Calculator"
2. Task: "Build input form" with approach: "Use noUiSlider library for sliders"
3. Infrastructure planner sees this → creates skill: "noUiSlider Integration"
4. Worker for this task gets that skill injected

This makes skill/tool building more targeted.

---

## Migration Strategy

### Phase 1: Schema (Non-Breaking)

```sql
ALTER TABLE tasks ADD COLUMN task_intent TEXT;
ALTER TABLE tasks ADD COLUMN task_approach TEXT;
```

- Nullable fields, no impact on existing functionality
- Existing tasks continue working unchanged

### Phase 2: Database Layer

Update `lib/db/tasks.ts`:
- Add fields to CreateTaskInput, UpdateTaskInput
- Update createTask, updateTask functions
- Add getTasksWithContext query (for infrastructure planner)

### Phase 3: API Layer

- Update PATCH /api/tasks/[id] to handle new fields
- Add POST /api/tasks/[id]/optimize-context endpoint
- Update infrastructure planner to read task_approach

### Phase 4: UI - Expandable Tasks

- Create ExpandableTaskCard component
- Add expand/collapse to task list on outcome page
- Show task_intent and task_approach when expanded
- Add ramble box and optimize button

### Phase 5: UI - Task Detail Modal (Optional)

- Create TaskDetailModal component
- Richer editing experience for complex tasks
- Full ramble → optimize flow

### Phase 6: Infrastructure Integration

- Update lib/agents/infrastructure-planner.ts
- Consider task-level approaches when planning skills/tools
- Optionally tag skills with which tasks they support

---

## Open Questions

### 1. Inline Expand vs Modal?

**Inline expand:**
- Faster interaction
- See multiple tasks at once
- Can get visually busy

**Modal:**
- Cleaner, focused experience
- Better for complex editing
- Extra click to open

**Recommendation:** Start with inline expand, add modal later for power users.

### 2. One Ramble Box or Two?

**One combined box:**
- Simpler UX
- AI figures out what's "what" vs "how"
- Less cognitive load

**Separate boxes:**
- More explicit control
- User thinks clearly about distinction
- Slightly more complex

**Recommendation:** Start with one combined box, AI parses. Advanced users can edit What/How directly.

### 3. When to Show Enrichment UI?

**Always show ramble box:**
- Encourages adding context
- Consistent UI

**Show on hover/click:**
- Cleaner default view
- Context is opt-in

**Recommendation:** Show ramble box when task is expanded, not by default.

### 4. Task Generation with Context?

When generating tasks from outcome intent, should we also generate task_intent/task_approach?

**Yes:**
- Tasks come pre-structured
- Less manual work

**No:**
- User adds context where needed
- Avoids AI over-specifying

**Recommendation:** Don't auto-generate. Tasks start simple, user enriches as needed.

---

## Files to Modify

| File | Changes |
|------|---------|
| `lib/db/schema.ts` | Add task_intent, task_approach to Task type |
| `lib/db/index.ts` | Migration for new columns |
| `lib/db/tasks.ts` | Update CRUD functions |
| `app/api/tasks/[id]/route.ts` | Handle new fields in PATCH |
| `app/api/tasks/[id]/optimize-context/route.ts` | NEW - ramble parsing |
| `app/components/ExpandableTaskCard.tsx` | NEW - expandable task UI |
| `app/outcome/[id]/page.tsx` | Use ExpandableTaskCard in task list |
| `lib/agents/infrastructure-planner.ts` | Read task_approach for planning |

---

## Success Criteria

1. User can click a task and add "how" context via ramble
2. That context appears structured in What/How sections
3. Infrastructure planner considers task-level approaches
4. Existing tasks (without context) continue working unchanged
5. UI stays clean - enrichment is opt-in, not cluttered

---

## Future Enhancements

- **Task templates:** Pre-defined What/How for common task types
- **Context inheritance:** Child tasks inherit approach from parent outcome
- **Bulk enrichment:** "Add context to all tasks" with AI pass
- **Approach validation:** Warn if task approach conflicts with outcome approach
