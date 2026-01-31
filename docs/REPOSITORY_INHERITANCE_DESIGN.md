# Repository Inheritance Design

## Problem

The current save targets design assumes one private repo and one team repo at the account level. This doesn't support:

1. **Multiple clients/teams** - Different outcomes need different repos
2. **Organic growth** - Teams form and change as work evolves
3. **Hierarchy** - Parent-child outcomes should share repository context
4. **Flexibility** - Don't want to require upfront planning

## Proposed Model: Per-Outcome Repos with Inheritance

### Core Concept

Each outcome can have its own repository configuration. Child outcomes **inherit** from their parent unless they override.

```
Vision Outcome (Client A)
├── repo: github.com/client-a/shared
├── Child Outcome 1 → inherits repo
├── Child Outcome 2 → inherits repo
└── Child Outcome 3
    └── repo: github.com/client-a/special-project (override)
```

### Repository Configuration

Instead of global "private" and "team" repos, each outcome can configure:

```typescript
interface OutcomeRepoConfig {
  // Repository for this outcome (null = inherit from parent)
  repository_id: string | null;

  // Per-content-type targets (inherit | local | repo)
  output_target: 'inherit' | 'local' | 'repo';
  skill_target: 'inherit' | 'local' | 'repo';
  tool_target: 'inherit' | 'local' | 'repo';
  file_target: 'inherit' | 'local' | 'repo';

  // Auto-save behavior
  auto_save: boolean | 'inherit';
}
```

### Inheritance Rules

1. **Root outcomes** (no parent) must explicitly configure a repo or stay local
2. **Child outcomes** default to `inherit` for all settings
3. **Override** at any level breaks inheritance for that setting
4. **Effective repo** is resolved by walking up the tree

```typescript
function getEffectiveRepo(outcome: Outcome): Repository | null {
  if (outcome.repository_id) {
    return getRepository(outcome.repository_id);
  }
  if (outcome.parent_id) {
    return getEffectiveRepo(getOutcome(outcome.parent_id));
  }
  return null; // Root with no repo = local only
}
```

### Repository Registry

Repositories are still defined centrally (like address book entries), but outcomes choose which one to use:

```typescript
interface Repository {
  id: string;
  name: string;           // "Client A Shared", "Personal Archive"
  local_path: string;
  remote_url: string;
  auto_push: boolean;
  created_at: number;
}
```

No "type" field (private/team) - just named repositories. The meaning comes from how outcomes use them.

### UI Changes

#### Settings Page
- **Repository Registry**: Add/edit/remove repositories (just the definitions)
- No more "private repo" vs "team repo" distinction
- Just a list of named repos with paths/URLs

#### Outcome Page - Save Targets Section

```
┌─────────────────────────────────────────────────────────┐
│ Save Targets                                            │
│                                                         │
│ Repository: [Dropdown: None / Inherit / Client A / ...] │
│                                                         │
│ If "Inherit": Shows "Inheriting from: Parent Name"      │
│ If "None": Shows "Saving locally only"                  │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Content Type    Target                              │ │
│ │ ─────────────────────────────────────────────────── │ │
│ │ Outputs         ○ Inherit  ○ Local  ● Repository    │ │
│ │ Skills          ● Inherit  ○ Local  ○ Repository    │ │
│ │ Tools           ● Inherit  ○ Local  ○ Repository    │ │
│ │ Files           ○ Inherit  ● Local  ○ Repository    │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Auto-save: ○ Inherit  ○ Off  ● On                      │
│                                                         │
│ Effective settings (resolved):                          │
│   Outputs → github.com/client-a/shared/outputs          │
│   Skills → github.com/client-a/shared/skills            │
│   Tools → github.com/client-a/shared/tools              │
│   Files → Local only                                    │
└─────────────────────────────────────────────────────────┘
```

Key UX elements:
- **Dropdown** to select repository (or inherit/none)
- **Inherit option** for each setting (grayed out if no parent)
- **Effective settings** preview showing resolved values

### Database Changes

```sql
-- Repositories table (simplified - no type field)
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  remote_url TEXT,
  auto_push INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Outcomes table changes
ALTER TABLE outcomes ADD COLUMN repository_id TEXT REFERENCES repositories(id);
-- Existing target columns change meaning:
-- 'local' = save locally
-- 'repo' = save to configured repository
-- 'inherit' = inherit from parent (new value)
```

### Migration Path

1. Keep existing `repositories` table, remove `type` and `content_type` columns
2. Add `repository_id` to outcomes
3. Change target values: 'private'/'team' → 'repo', add 'inherit'
4. Update UI components

### Example Scenarios

#### Scenario 1: New user, simple setup
- Create outcomes without repos → everything stays local
- Later, add a repo in Settings
- Assign repo to outcomes that should sync

#### Scenario 2: Client project hierarchy
```
Client A Vision (repo: client-a-shared)
├── Q1 Campaign (inherits)
│   ├── Landing Page (inherits)
│   └── Email Sequence (inherits)
└── Q2 Campaign (inherits)
    └── Product Launch (inherits)
```
All child outcomes automatically use client-a-shared repo.

#### Scenario 3: Mixed team/personal
```
Personal Research (repo: personal-archive)
├── Market Analysis (inherits)
└── Competitor Deep Dive
    └── repo: shared-intel (override for collaboration)
```

#### Scenario 4: Outcome moves between parents
When re-parenting an outcome:
- If it was set to "inherit", it now inherits from new parent
- If it had explicit settings, those remain

### Open Questions

1. **Bulk re-assignment**: If a parent changes repo, should children be notified/prompted?

2. **Repo removal**: What happens to outcomes using a deleted repo?
   - Option A: Block deletion if in use
   - Option B: Outcomes fall back to local

3. **Cross-repo items**: What if an item was synced to Repo A, then outcome switches to Repo B?
   - Keep sync history? Delete from old repo?

4. **Default for new outcomes**: Should there be a "default repo for new root outcomes" setting?

---

## Implementation Phases

### Phase 1: Schema + Inheritance Logic
- Remove type/content_type from repositories
- Add repository_id to outcomes
- Add 'inherit' as valid target value
- Implement `getEffectiveRepo()` and `getEffectiveTarget()`

### Phase 2: UI Updates
- Simplify Settings repository list
- Update SaveTargetsSection with inheritance UI
- Add "effective settings" preview

### Phase 3: Sync Logic Updates
- Update `repository-sync.ts` to use resolved settings
- Handle inheritance in sync operations

---

## Summary

**Before**: One private repo, one team repo, all outcomes share them.

**After**:
- Outcomes can each have their own repo (or inherit from parent)
- Repository registry is just a list of named repos
- Inheritance flows down the outcome tree
- Override at any level for flexibility
