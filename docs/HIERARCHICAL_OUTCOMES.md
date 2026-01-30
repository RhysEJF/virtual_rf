# Hierarchical Outcomes

> Nested outcome structure for organizing work from strategy to execution

## Overview

Outcomes can now be organized hierarchically, enabling you to structure work at different levels of abstraction:

- **Strategy** (depth 0): High-level goals with no direct tasks
- **Product/Initiative** (depth 1): Major work streams
- **Feature** (depth 2+): Executable work with tasks and workers

Each outcome maintains its own PRD (intent) and Design Doc (approach), preserving the "compound documents" philosophy.

## Key Rules

1. **Arbitrary depth**: Outcomes can be nested to any level
2. **Workers at leaves only**: Only outcomes without children can have active workers
3. **Progress rolls up**: Parent outcomes display aggregated stats from all descendants
4. **Cascade delete**: Deleting a parent deletes all children

## Database Schema

New columns on `outcomes` table:

```sql
parent_id TEXT REFERENCES outcomes(id) ON DELETE CASCADE  -- NULL for root outcomes
depth INTEGER NOT NULL DEFAULT 0  -- Computed from parent chain
```

Indexes for efficient tree queries:
- `idx_outcomes_parent`: Fast child lookups
- `idx_outcomes_depth`: Level-based queries

## API Reference

### GET /api/outcomes

Query parameters:
- `?tree=true` - Return nested tree structure with children
- `?parent_id=xxx` - Get direct children of specific outcome
- `?roots_only=true` - Get only root-level outcomes
- `?counts=true` - Include task/worker counts
- `?status=active|dormant|achieved|archived` - Filter by status

### POST /api/outcomes

Create outcome with optional parent:

```json
{
  "name": "User Authentication",
  "brief": "Handle user login and session management",
  "parent_id": "out_abc123"  // Optional - makes this a child
}
```

Server automatically computes `depth` based on parent.

### GET /api/outcomes/[id]

Response includes hierarchy data:

```json
{
  "outcome": { ... },
  "parent": { "id": "out_abc", "name": "Parent Name" },
  "children": [
    { "id": "out_xyz", "name": "Child 1", "status": "active", ... }
  ],
  "breadcrumbs": [
    { "id": "out_abc", "name": "Root" },
    { "id": "out_def", "name": "Middle" },
    { "id": "out_ghi", "name": "Current" }
  ],
  "aggregatedStats": {
    "total_tasks": 45,
    "completed_tasks": 32,
    "pending_tasks": 10,
    "failed_tasks": 3,
    "active_workers": 2,
    "total_descendants": 5
  },
  "isParent": true
}
```

## UI Guide

### Dashboard

Toggle between flat and tree view using the icons next to "Outcomes":
- **List icon**: Traditional flat view grouped by status
- **Tree icon**: Hierarchical view with expand/collapse

Tree view features:
- Click chevron to expand/collapse
- Depth labels (Strategy, Product) show automatically
- Aggregated stats for parent nodes
- Quick "Start" action on leaf nodes

### Outcome Detail Page

**For parent outcomes (has children):**
- Shows aggregated progress card
- Lists children with their stats
- "Add Child" button to create sub-outcomes
- No "Start Worker" button (workers only at leaves)

**For leaf outcomes (no children):**
- Full current UI with tasks, workers, skills
- "Start Worker" button available
- "Add Child" button still available (converts to parent)

### Breadcrumbs

Navigation path shown below the back button:
```
Dashboard > Strategy Name > Product Name > Feature Name
```

Each segment is clickable to navigate up the hierarchy.

## Depth Conventions

| Depth | Typical Name | Has Intent/Approach | Has Tasks/Workers |
|-------|--------------|---------------------|-------------------|
| 0 | Strategy | Brief only | No |
| 1 | Product/Initiative | Yes | Optional |
| 2+ | Feature | Yes (full PRD) | Yes |

These are conventions, not enforced constraints. Any outcome can have children or be a leaf.

## Examples

### Creating a Hierarchy

1. Create root outcome: "Win Field Management Market"
2. Add children: "Scheduling App", "Mobile Companion"
3. Add grandchildren to Scheduling App: "Auth", "Calendar", "Reports"

### Typical Workflow

1. Create strategy-level outcome
2. Break down into product/initiative children
3. Further decompose into feature-level leaves
4. Workers execute on leaf outcomes
5. Progress aggregates up to parents

## Technical Details

### Tree Queries

The database layer uses recursive CTEs for efficient tree operations:

```typescript
// Get all descendants
getAllDescendants(outcomeId)

// Get breadcrumb path
getBreadcrumbs(outcomeId)

// Get aggregated stats
getAggregatedStats(outcomeId)

// Build full tree structure
getOutcomeTree()
```

### Worker Constraint Enforcement

The API enforces leaf-only workers at multiple points:
- `POST /api/outcomes/[id]/workers` - Checks `hasChildren()`
- `POST /api/outcomes/[id]/orchestrate` - Same check
- `POST /api/outcomes/[id]/execute-plan` - For `start_worker` action

## Future Enhancements (Not Implemented)

- Skill inheritance from parent to children
- Move outcome to different parent
- Bulk operations on tree branches
- Template outcomes for common patterns
