# Skills & Tools Sharing Architecture Design

## Problem Statement

The current system has limitations that prevent effective collaboration:

1. **No sharing control**: Skills created in outcomes are either completely private (outcome-specific) or implicitly global (tracked in DB, live in `/skills/`)
2. **No dual-repo support**: Outcomes can target a single working directory, but there's no concept of "my private repo" vs "team shared repo"
3. **Workspaces are gitignored**: All outcome workspaces (`/workspaces/`) are excluded from git, so skills/tools built during execution are never preserved
4. **No integration with existing git settings**: The current `git_mode` (none/local/branch/worktree) controls code, but there's no equivalent for skills/tools
5. **No per-item sharing flags**: Can't mark individual skills as "shareable" vs "private"

## Design Goals

1. **Explicit sharing control** - Users decide what gets shared and where
2. **Dual-repo architecture** - Support personal repo (always) + optional shared repo
3. **Protection levels** - Skills can be private, outcome-scoped, or shared
4. **Git-native workflow** - Leverage git for version control and collaboration
5. **Auto-sync during work** - Skills/tools sync to libraries as they're built
6. **Per-item sharing flags** - Override outcome defaults at the skill/tool level
7. **Backward compatible** - Existing outcomes continue to work

---

## Architecture Overview

### Repository Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    DIGITAL TWIN REPO                         │
│  (your main codebase - virtual_rf)                          │
│                                                              │
│  ├── skills/              ← Global skills (in-repo)         │
│  ├── workspaces/          ← [gitignored] Runtime workspaces │
│  └── data/                ← SQLite database                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  PERSONAL LIBRARY REPO                       │
│  (your private skills/tools collection)                      │
│                                                              │
│  ├── skills/              ← Your private skills             │
│  ├── tools/               ← Your private tools              │
│  └── .skill-registry.json ← Metadata index                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   SHARED LIBRARY REPO                        │
│  (team-shared skills/tools - optional)                       │
│                                                              │
│  ├── skills/              ← Team-shared skills              │
│  ├── tools/               ← Team-shared tools               │
│  └── .skill-registry.json ← Metadata index                  │
└─────────────────────────────────────────────────────────────┘
```

### Four-Tier Protection Model

| Level | Scope | Stored In | Git Behavior |
|-------|-------|-----------|--------------|
| **Private** | Just you, this outcome | `workspaces/{id}/skills/` | Not tracked (gitignored) |
| **Outcome** | Outcome collaborators | Outcome's shared branch/repo | Pushed to outcome repo |
| **Personal** | All your outcomes | Personal Library Repo | Pushed to your private repo |
| **Team** | Organization-wide | Team Library Repo | Pushed to team repo |

**Key distinction:**
- **Outcome-shared**: Only people collaborating on THIS outcome can see it
- **Team-shared**: Everyone in the organization can see it

This allows the workflow: "I'm working with Alice and Bob on this outcome. I want to share skill X with them, but not with the rest of the company."

---

## Integration with Existing Git Settings

### Current Outcome Git Configuration (for CODE)

The existing `git_mode` setting controls how the outcome's **code/deliverables** are managed:

| git_mode | Behavior |
|----------|----------|
| `none` | No git integration for code |
| `local` | Single local working directory |
| `branch` | Feature branch mode |
| `worktree` | Git worktree for parallel workers |

**Important**: These settings are for the OUTCOME'S CODE, not for skills/tools.

### NEW: Outcome Library Configuration (for SKILLS/TOOLS)

Separate from `git_mode`, each outcome can configure where its skills/tools should sync:

```
┌─────────────────────────────────────────────────────────────┐
│                    OUTCOME CONFIGURATION                     │
│                                                              │
│  CODE SETTINGS (existing)          LIBRARY SETTINGS (new)   │
│  ─────────────────────────         ───────────────────────  │
│  git_mode: branch                  skill_sync_target: personal│
│  working_directory: ~/my-app       tool_sync_target: personal │
│  base_branch: main                 auto_sync_on_build: true  │
│  work_branch: feature/x                                      │
│  auto_commit: true                                           │
│  create_pr_on_complete: true                                 │
└─────────────────────────────────────────────────────────────┘
```

### The Matrix: git_mode × library_sync

| git_mode | skill_sync_target | What Happens |
|----------|-------------------|--------------|
| `none` | `none` | Skills stay in workspace only, not synced anywhere |
| `none` | `personal` | Skills sync to personal library as built |
| `none` | `shared` | Skills sync to shared library as built |
| `local` | `personal` | Code is local, skills sync to personal library |
| `branch` | `shared` | Code goes to feature branch, skills sync to shared library |
| `worktree` | `personal` | Workers use worktrees for code, skills sync to personal library |

**Key insight**: Code management and skill/tool management are INDEPENDENT.

---

## Outcome Collaboration Model

### The Problem

You start an outcome solo. You build skills A, B, C. Later, Alice and Bob join as collaborators. You want to:
- Share skill A with Alice and Bob (outcome collaborators)
- Keep skill B private (only you)
- Share skill C with the whole team (organization-wide)

### The Solution: Outcome-Level Sharing

Each outcome can have:
1. **Collaborators** - People who are part of this outcome
2. **Outcome workspace** - A shared branch/repo for this outcome specifically
3. **Per-item sharing flags** - Control what goes where

```
┌─────────────────────────────────────────────────────────────┐
│                     OUTCOME: RF CLI Tool                     │
│                                                              │
│  Owner: You                                                  │
│  Collaborators: Alice, Bob                                   │
│                                                              │
│  Outcome Workspace: git@github.com:team/rf-cli-outcome.git  │
│  (Only you, Alice, Bob have access)                         │
│                                                              │
│  Skills:                                                     │
│  ├── cli-design.md      [🔒 Private]     → stays local      │
│  ├── api-patterns.md    [👥 Outcome]     → outcome repo     │
│  └── testing-guide.md   [🌐 Team]        → team library     │
│                                                              │
│  Data:                                                       │
│  ├── proprietary.csv    [🔒 Private]     → stays local      │
│  ├── test-data.json     [👥 Outcome]     → outcome repo     │
│  └── reference.csv      [🌐 Team]        → team library     │
└─────────────────────────────────────────────────────────────┘
```

### Collaborator Workflow

1. **Owner creates outcome** → private by default
2. **Owner invites collaborators** → they get access to outcome workspace
3. **Owner/collaborators build items** → each item has share_status flag
4. **Items sync based on flag**:
   - `private` → stays in your local workspace
   - `outcome` → syncs to outcome workspace (collaborators can see)
   - `personal` → syncs to your personal library (only you)
   - `team` → syncs to team library (everyone)

---

## Data File Sharing

### The Problem

Outcomes can have uploaded data files:
- CSVs with customer data (proprietary)
- JSON with API responses (sensitive)
- Reference datasets (shareable)
- Test fixtures (outcome-specific)

These need the same four-tier protection as skills/tools.

### Data Categories

| Type | Examples | Default Protection |
|------|----------|-------------------|
| **Uploaded files** | CSVs, Excel, PDFs | Private |
| **Generated outputs** | Reports, exports | Outcome |
| **Reference data** | Public datasets | Team |
| **Credentials/secrets** | .env, keys | Private (locked) |

### Data Storage Locations

```
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL WORKSPACE                           │
│  workspaces/{outcomeId}/                                    │
│  ├── data/                                                  │
│  │   ├── private/        ← Never synced, gitignored        │
│  │   │   └── customer-list.csv                             │
│  │   ├── outcome/        ← Syncs to outcome workspace      │
│  │   │   └── test-fixtures.json                            │
│  │   └── shared/         ← Syncs to team library           │
│  │       └── reference-data.csv                            │
│  ├── skills/                                                │
│  └── tools/                                                 │
└─────────────────────────────────────────────────────────────┘
```

### Sensitive Data Protection

Some files should NEVER be shareable:

```typescript
const ALWAYS_PRIVATE_PATTERNS = [
  '.env*',
  '*.key',
  '*.pem',
  '*credentials*',
  '*secret*',
  '*password*',
];

// These files are locked to 'private' and cannot be changed
```

### Data Upload UI

When uploading a file:

```
┌────────────────────────────────────────────────────────────┐
│ Upload Data File                                           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ File: customer-analysis.csv                                │
│                                                            │
│ ⚠️  This file may contain sensitive data.                  │
│                                                            │
│ Sharing level:                                             │
│ ● 🔒 Private (only you, this outcome)                     │
│ ○ 👥 Outcome collaborators (Alice, Bob)                   │
│ ○ 📚 Your personal library                                │
│ ○ 🌐 Team library (everyone)                              │
│                                                            │
│ [ ] Contains PII or customer data                          │
│ [ ] Contains proprietary business data                     │
│ [ ] Contains credentials or secrets                        │
│                                                            │
│ If any checked, sharing is restricted to Private only.     │
│                                                            │
│              [Cancel]  [Upload]                            │
└────────────────────────────────────────────────────────────┘
```

---

## Database Schema Changes

### New: `skill_libraries` Table

```sql
CREATE TABLE skill_libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'personal' | 'team'
  repo_url TEXT,       -- git remote URL (null for local-only)
  local_path TEXT NOT NULL,  -- local clone path
  branch TEXT DEFAULT 'main',
  auto_push INTEGER DEFAULT 1,  -- push immediately after adding skills
  pr_mode INTEGER DEFAULT 0,    -- create PR instead of direct push (for team)
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### New: `outcome_collaborators` Table

```sql
CREATE TABLE outcome_collaborators (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,  -- collaborator identifier
  role TEXT NOT NULL DEFAULT 'collaborator',  -- 'owner' | 'collaborator' | 'viewer'
  invited_at INTEGER NOT NULL,
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,

  UNIQUE(outcome_id, user_email)
);
```

### New: `outcome_data_files` Table

Track data files with sharing controls:

```sql
CREATE TABLE outcome_data_files (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,  -- original upload filename
  file_path TEXT NOT NULL,      -- local storage path
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  share_status TEXT NOT NULL DEFAULT 'private',  -- 'private' | 'outcome' | 'personal' | 'team'
  contains_pii INTEGER DEFAULT 0,
  contains_proprietary INTEGER DEFAULT 0,
  contains_secrets INTEGER DEFAULT 0,
  synced_to_outcome INTEGER DEFAULT 0,
  synced_to_personal INTEGER DEFAULT 0,
  synced_to_team INTEGER DEFAULT 0,
  uploaded_by TEXT,  -- user who uploaded
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(outcome_id, filename)
);
```

### New: `library_skills` Table

```sql
CREATE TABLE library_skills (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES skill_libraries(id),
  name TEXT NOT NULL,
  filename TEXT NOT NULL,  -- e.g., 'market-research.md'
  category TEXT,
  description TEXT,
  requires TEXT,  -- JSON array of API keys
  source_outcome_id TEXT,  -- which outcome created it (nullable)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(library_id, filename)
);
```

### New: `library_tools` Table

```sql
CREATE TABLE library_tools (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES skill_libraries(id),
  name TEXT NOT NULL,
  filename TEXT NOT NULL,  -- e.g., 'web-scraper.ts'
  description TEXT,
  source_outcome_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(library_id, filename)
);
```

### New: `outcome_items` Table (Per-Item Sharing Flags)

Track sharing status for each skill/tool/data file within an outcome:

```sql
CREATE TABLE outcome_items (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,  -- 'market-research.md' or 'data.csv'
  item_type TEXT NOT NULL,      -- 'skill' | 'tool' | 'data'
  share_status TEXT NOT NULL DEFAULT 'private',  -- 'private' | 'outcome' | 'personal' | 'team'
  share_locked INTEGER DEFAULT 0,  -- if 1, cannot change share_status (e.g., contains secrets)
  synced_to_outcome INTEGER DEFAULT 0,
  synced_to_personal INTEGER DEFAULT 0,
  synced_to_team INTEGER DEFAULT 0,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(outcome_id, filename, item_type)
);
```

### Updated: `outcomes` Table

Add new fields for collaboration and library configuration:

```sql
-- Collaboration settings
ALTER TABLE outcomes ADD COLUMN outcome_repo_url TEXT;           -- repo for outcome collaborators
ALTER TABLE outcomes ADD COLUMN outcome_repo_branch TEXT;        -- branch for this outcome

-- Default sync targets (can be overridden per-item)
ALTER TABLE outcomes ADD COLUMN default_skill_target TEXT DEFAULT 'private';  -- 'private' | 'outcome' | 'personal' | 'team'
ALTER TABLE outcomes ADD COLUMN default_tool_target TEXT DEFAULT 'private';   -- 'private' | 'outcome' | 'personal' | 'team'
ALTER TABLE outcomes ADD COLUMN default_data_target TEXT DEFAULT 'private';   -- 'private' | 'outcome' | 'personal' | 'team'
ALTER TABLE outcomes ADD COLUMN auto_sync_on_build INTEGER DEFAULT 0;

-- Library references
ALTER TABLE outcomes ADD COLUMN personal_library_id TEXT REFERENCES skill_libraries(id);
ALTER TABLE outcomes ADD COLUMN team_library_id TEXT REFERENCES skill_libraries(id);
```

---

## Workflows

### Workflow 1: Capability Phase Auto-Sync

When a worker builds a skill/tool during the capability phase:

```
Worker creates skill file in workspace
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ skill-builder.ts: buildSkill() completes                    │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ Check outcome.auto_sync_on_build                            │
│ If false → stop (skill stays private)                       │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ Check outcome.skill_sync_target                             │
│ 'none' → stop                                               │
│ 'personal' → sync to personal library                       │
│ 'shared' → sync to shared library                           │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ Create outcome_skills record with share_status              │
│ Copy file to target library                                 │
│ Create library_skills record                                │
│ Git: stage, commit, push (if auto_push enabled)             │
└─────────────────────────────────────────────────────────────┘
```

### Workflow 2: Manual Promotion (Override)

User can manually promote a skill to a different level than the outcome default:

```
User views skill in outcome, clicks "Share with Team"
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ Update outcome_skills.share_status = 'shared'               │
│ Copy file to shared library                                 │
│ Create library_skills record in shared library              │
│ Git: stage, commit, push (or create PR)                     │
└─────────────────────────────────────────────────────────────┘
```

### Workflow 3: Mark as Private (Override)

User can mark a skill as private even if outcome default would sync it:

```
User views skill, clicks "Keep Private"
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ Update outcome_skills.share_status = 'private'              │
│ Skill will NOT be synced during auto-sync                   │
│ If already synced, optionally remove from library           │
└─────────────────────────────────────────────────────────────┘
```

### Workflow 4: Import from Library

User imports a skill from a library into their outcome:

```
User browses library, clicks "Import to Outcome"
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ Copy file from library to workspace/skills/                 │
│ Create outcome_skills record                                │
│ share_status = 'personal' or 'shared' (based on source)     │
│ Skill is now available to workers                           │
└─────────────────────────────────────────────────────────────┘
```

---

## UI Components

### 1. Outcome Git & Library Settings (Enhanced)

In the outcome detail page, expand the Git Configuration section:

```
┌────────────────────────────────────────────────────────────────┐
│ Git & Sync Configuration                                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ CODE REPOSITORY                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ Mode: [Branch         ▼]                                   ││
│ │ Working Directory: ~/projects/my-app                       ││
│ │ Base Branch: main    Work Branch: feature/rf-cli           ││
│ │ [✓] Auto-commit after tasks                                ││
│ │ [✓] Create PR on completion                                ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ SKILLS & TOOLS LIBRARY                                         │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ Default Skill Target: [Personal Library  ▼]                ││
│ │                       None / Personal Library / Team Library│
│ │                                                            ││
│ │ Default Tool Target:  [Personal Library  ▼]                ││
│ │                       None / Personal Library / Team Library│
│ │                                                            ││
│ │ [✓] Auto-sync as workers build                             ││
│ │     → Skills/tools sync to target library during work      ││
│ │                                                            ││
│ │ Personal Library: ~/skills-library (connected)             ││
│ │ Team Library: ~/team-skills (connected)                    ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2. Outcome Collaboration Section (New)

```
┌────────────────────────────────────────────────────────────────┐
│ Collaboration                                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ Outcome Workspace                                              │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ Repo: git@github.com:team/rf-cli-outcome.git               ││
│ │ Branch: main                                               ││
│ │ Status: ✓ Connected                                        ││
│ │                                                            ││
│ │ [Configure] [Sync Now]                                     ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ Collaborators                                                  │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 👤 You (Owner)                                             ││
│ │ 👤 alice@company.com (Collaborator) - Joined 2 days ago    ││
│ │ 👤 bob@company.com (Collaborator) - Invited, pending       ││
│ │                                                            ││
│ │ [+ Invite Collaborator]                                    ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ Default Sharing for New Items                                  │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ Skills: [👥 Outcome     ▼]  ← Share with collaborators     ││
│ │ Tools:  [👥 Outcome     ▼]                                 ││
│ │ Data:   [🔒 Private     ▼]  ← Keep data private by default ││
│ │                                                            ││
│ │ [✓] Auto-sync as workers build                             ││
│ └────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

### 3. Outcome Skills Section (With Four-Tier Flags)

```
┌────────────────────────────────────────────────────────────────┐
│ Skills                                                    [+]  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 📄 cli-design.md                                           ││
│ │ CLI design patterns and conventions                        ││
│ │                                                            ││
│ │ Sharing: [🔒 Private     ▼]                                ││
│ │          🔒 Private (only you)                             ││
│ │          👥 Outcome (Alice, Bob)                           ││
│ │          📚 Personal Library                               ││
│ │          🌐 Team Library                                   ││
│ │                                                            ││
│ │ Status: Local only                                         ││
│ │                                                            ││
│ │ [View] [Edit] [Delete]                                     ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 📄 api-patterns.md                                         ││
│ │ API integration patterns for this project                  ││
│ │                                                            ││
│ │ Sharing: [👥 Outcome     ▼]                                ││
│ │                                                            ││
│ │ Status: ✓ Synced to outcome repo (30m ago)                 ││
│ │         Alice, Bob can access                              ││
│ │                                                            ││
│ │ [View] [Edit] [Sync Now]                                   ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 📄 testing-guide.md                                        ││
│ │ Comprehensive testing methodology                          ││
│ │                                                            ││
│ │ Sharing: [🌐 Team        ▼]                                ││
│ │                                                            ││
│ │ Status: ✓ Synced to Team Library (1h ago)                  ││
│ │                                                            ││
│ │ [View] [Edit] [Sync Now]                                   ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ [+ Import from Library]                                        │
└────────────────────────────────────────────────────────────────┘
```

### 4. Data Files Section (New)

```
┌────────────────────────────────────────────────────────────────┐
│ Data Files                                               [+]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 📊 customer-data.csv                         1.2 MB        ││
│ │ Uploaded 2 days ago                                        ││
│ │                                                            ││
│ │ Sharing: [🔒 Private     ▼]  🔒 Locked (contains PII)      ││
│ │                                                            ││
│ │ ⚠️ Marked as containing PII - cannot be shared            ││
│ │                                                            ││
│ │ [View] [Download] [Delete]                                 ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 📊 test-fixtures.json                        45 KB         ││
│ │ Uploaded 1 day ago                                         ││
│ │                                                            ││
│ │ Sharing: [👥 Outcome     ▼]                                ││
│ │                                                            ││
│ │ Status: ✓ Synced to outcome repo                           ││
│ │                                                            ││
│ │ [View] [Download] [Sync Now]                               ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 📊 industry-reference.csv                    230 KB        ││
│ │ Public dataset - safe to share                             ││
│ │                                                            ││
│ │ Sharing: [🌐 Team        ▼]                                ││
│ │                                                            ││
│ │ Status: ✓ Synced to Team Library                           ││
│ │                                                            ││
│ │ [View] [Download] [Sync Now]                               ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ [+ Upload Data File]                                           │
└────────────────────────────────────────────────────────────────┘
```

### 3. Tools Section (Same Pattern)

```
┌────────────────────────────────────────────────────────────────┐
│ Tools                                                     [+]  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 🔧 web-scraper.ts                                          ││
│ │ Fetch and parse web pages                                  ││
│ │                                                            ││
│ │ Sharing: [📚 Personal    ▼]                                ││
│ │ Status: ✓ Synced to Personal Library                       ││
│ │                                                            ││
│ │ [View] [Edit] [Run]                                        ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐│
│ │ 🔧 internal-formatter.ts                                   ││
│ │ Project-specific data formatter (not reusable)             ││
│ │                                                            ││
│ │ Sharing: [🔒 Private     ▼]  ← User marked as private      ││
│ │ Status: Not synced (marked private)                        ││
│ │                                                            ││
│ │ [View] [Edit] [Run]                                        ││
│ └────────────────────────────────────────────────────────────┘│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 4. Library Manager Page (`/libraries`)

```
┌────────────────────────────────────────────────────────────────┐
│ Skill Libraries                                                │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 📚 My Personal Library                                   │ │
│  │                                                          │ │
│  │ Local Path: ~/skills-library                             │ │
│  │ Remote: git@github.com:me/my-skills.git                  │ │
│  │ Branch: main                                             │ │
│  │                                                          │ │
│  │ Skills: 12 │ Tools: 5 │ Last sync: 2h ago                │ │
│  │                                                          │ │
│  │ Settings:                                                │ │
│  │ [✓] Auto-push after adding skills                        │ │
│  │ [ ] Create PR instead of direct push                     │ │
│  │                                                          │ │
│  │ [Sync Now] [Browse Contents] [Configure]                 │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 👥 Team Shared Library                                   │ │
│  │                                                          │ │
│  │ Local Path: ~/team-skills                                │ │
│  │ Remote: git@github.com:team/shared-skills.git            │ │
│  │ Branch: main                                             │ │
│  │                                                          │ │
│  │ Skills: 28 │ Tools: 9 │ Last sync: 15m ago               │ │
│  │                                                          │ │
│  │ Settings:                                                │ │
│  │ [✓] Auto-push after adding skills                        │ │
│  │ [✓] Create PR instead of direct push                     │ │
│  │                                                          │ │
│  │ [Sync Now] [Browse Contents] [Configure]                 │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  [+ Add Library]                                               │
└────────────────────────────────────────────────────────────────┘
```

---

## Auto-Sync Implementation

### Hook into Skill Builder

Modify `lib/agents/skill-builder.ts` to call library sync after building:

```typescript
// After skill file is written to workspace
async function onSkillBuilt(
  outcomeId: string,
  skillFilename: string,
  skillPath: string
): Promise<void> {
  const outcome = getOutcomeById(outcomeId);

  // Check if auto-sync is enabled
  if (!outcome.auto_sync_on_build) return;

  // Check if there's a target library
  const target = outcome.skill_sync_target; // 'none' | 'personal' | 'shared'
  if (target === 'none') return;

  // Get or create the outcome_skills record
  const skillRecord = getOrCreateOutcomeSkill(outcomeId, skillFilename, 'skill');

  // If manually marked private, don't sync
  if (skillRecord.share_status === 'private') return;

  // Sync to target library
  const libraryId = target === 'personal'
    ? outcome.personal_library_id
    : outcome.shared_library_id;

  if (!libraryId) return;

  await syncSkillToLibrary(skillPath, libraryId, outcomeId);

  // Update sync status
  updateOutcomeSkill(skillRecord.id, {
    synced_to_personal: target === 'personal' ? 1 : skillRecord.synced_to_personal,
    synced_to_shared: target === 'shared' ? 1 : skillRecord.synced_to_shared,
  });
}
```

### Library Sync Function

```typescript
async function syncSkillToLibrary(
  skillPath: string,
  libraryId: string,
  sourceOutcomeId: string
): Promise<void> {
  const library = getLibraryById(libraryId);
  const filename = path.basename(skillPath);

  // Copy file to library
  const destPath = path.join(library.local_path, 'skills', filename);
  fs.copyFileSync(skillPath, destPath);

  // Update registry
  updateLibraryRegistry(library.local_path);

  // Create library_skills record
  upsertLibrarySkill({
    library_id: libraryId,
    name: parseSkillName(skillPath),
    filename,
    source_outcome_id: sourceOutcomeId,
  });

  // Git operations
  if (library.auto_push) {
    await gitAdd(library.local_path, destPath);
    await gitCommit(library.local_path, `Add skill: ${filename}`);

    if (library.pr_mode) {
      await createPR(library, `Add skill: ${filename}`);
    } else {
      await gitPush(library.local_path);
    }
  }
}
```

---

## API Endpoints

### Library Management

```
GET    /api/libraries              # List all configured libraries
POST   /api/libraries              # Add a new library
GET    /api/libraries/[id]         # Get library details
PUT    /api/libraries/[id]         # Update library config
DELETE /api/libraries/[id]         # Remove library
POST   /api/libraries/[id]/sync    # Sync with remote (pull + push)
```

### Outcome Library Settings

```
GET    /api/outcomes/[id]/library-settings      # Get library config for outcome
PUT    /api/outcomes/[id]/library-settings      # Update library config
```

### Outcome Skills (with sharing flags)

```
GET    /api/outcomes/[id]/skills                # List skills with share_status
PUT    /api/outcomes/[id]/skills/[filename]     # Update share_status
POST   /api/outcomes/[id]/skills/[filename]/sync # Manual sync to library
```

### Library Skills

```
GET    /api/libraries/[id]/skills               # List skills in library
POST   /api/outcomes/[id]/skills/import         # Import from library
```

---

## Configuration Examples

### Example 1: Solo Developer (Personal Library)

```
Outcome Settings:
  git_mode: local
  default_skill_target: personal
  default_tool_target: personal
  default_data_target: private
  auto_sync_on_build: true
  collaborators: none

Result:
  - Code stays local
  - Skills/tools auto-sync to personal library
  - Data stays private by default
  - User builds up their personal skill collection
```

### Example 2: Small Team Collaboration

```
Outcome Settings:
  git_mode: branch
  outcome_repo_url: git@github.com:team/project-outcome.git
  default_skill_target: outcome
  default_tool_target: outcome
  default_data_target: private
  auto_sync_on_build: true
  collaborators: [alice@co.com, bob@co.com]

Result:
  - Code goes to feature branch
  - Skills/tools auto-sync to outcome repo (Alice, Bob can see)
  - Data stays private unless explicitly shared
  - NOT visible to entire organization, only this outcome's team
```

### Example 3: Organization-Wide Sharing

```
Outcome Settings:
  git_mode: branch
  default_skill_target: team
  default_tool_target: team
  default_data_target: private
  auto_sync_on_build: true

Result:
  - Code goes to feature branch
  - Skills/tools auto-sync to team library (everyone can see)
  - Good for building org-wide skill library
  - Individual items can still be marked private
```

### Example 4: Experimental (No Sync)

```
Outcome Settings:
  git_mode: none
  default_skill_target: private
  default_tool_target: private
  default_data_target: private
  auto_sync_on_build: false

Result:
  - Nothing leaves local machine
  - Full privacy for experimental work
  - Can manually promote items later if desired
```

### Example 5: Mixed Team + Personal

```
Outcome Settings:
  git_mode: branch
  outcome_repo_url: git@github.com:team/project-outcome.git
  default_skill_target: outcome  # Default: share with collaborators
  default_tool_target: outcome
  default_data_target: private
  auto_sync_on_build: true
  collaborators: [alice@co.com]

Per-Item Overrides:
  - api-patterns.md: share_status = 'outcome'  # Alice can see
  - my-personal-notes.md: share_status = 'private'  # Only me
  - testing-guide.md: share_status = 'team'  # Everyone in org
  - customer-data.csv: share_status = 'private', locked = true  # Contains PII

Result:
  - Collaborators see outcome-shared items
  - Personal items stay private
  - Best practices get promoted to team
  - Sensitive data is protected
```

---

## Implementation Phases

### Phase 1: Database & Core Infrastructure
1. Add tables: `skill_libraries`, `library_skills`, `library_tools`, `outcome_items`, `outcome_collaborators`, `outcome_data_files`
2. Add new columns to `outcomes` table (collaboration + library settings)
3. Create CRUD operations in `lib/db/skill-libraries.ts`
4. Create CRUD operations in `lib/db/outcome-collaboration.ts`
5. Build basic git sync utilities for libraries

### Phase 2: Outcome Collaboration UI
1. Add Collaboration section to outcome detail page
2. Invite collaborators functionality
3. Configure outcome workspace repo
4. Default sharing level dropdowns (4 tiers)

### Phase 3: Per-Item Sharing Flags
1. Add share_status dropdown to each skill/tool/data card
2. Show sync status indicators with collaborator info
3. Manual "Sync Now" button
4. Handle private override logic
5. Lock functionality for sensitive items

### Phase 4: Data File Management
1. File upload UI with sensitivity prompts
2. Data file listing with sharing controls
3. Auto-lock for files marked with PII/secrets
4. Storage in `workspaces/{id}/data/{private|outcome|shared}/`

### Phase 5: Auto-Sync Integration
1. Hook into skill-builder.ts for auto-sync
2. Hook into tool-builder.ts for auto-sync
3. Hook into data file upload for conditional sync
4. Background sync queue for reliability
5. Sync status notifications

### Phase 6: Library Browser
1. Create `/libraries` page
2. Browse skills/tools/data in each library
3. Import to outcome functionality
4. Library-wide sync controls

### Phase 7: Advanced Features
1. PR mode for team library
2. Conflict detection and resolution
3. Skill versioning
4. Update notifications
5. Collaborator permissions (owner/collaborator/viewer)

---

## Summary

This updated design provides:

### Four-Tier Protection Model

| Level | Icon | Who Can See | Use Case |
|-------|------|-------------|----------|
| **Private** | 🔒 | Only you | Experimental, sensitive, WIP |
| **Outcome** | 👥 | Outcome collaborators | Team working on this project |
| **Personal** | 📚 | Only you (reusable) | Your personal skill library |
| **Team** | 🌐 | Everyone in org | Organization best practices |

### Key Features

1. **Outcome Collaboration**
   - Invite collaborators to an outcome
   - Share items specifically with them (not entire org)
   - Configure outcome-specific repo/branch

2. **Per-Item Sharing Control**
   - Each skill/tool/data file has its own share_status
   - Override outcome defaults on individual items
   - Lock sensitive items to 'private' (cannot be changed)

3. **Data File Protection**
   - Same four-tier model for data files
   - Mark files as containing PII/proprietary/secrets
   - Marked files are locked to private
   - Upload UI prompts for sensitivity classification

4. **Auto-Sync During Work**
   - Skills/tools sync as workers build them
   - Respects outcome defaults and per-item overrides
   - Background queue for reliability

5. **Separation of Concerns**
   - Code settings (git_mode) independent from library settings
   - Can have code in branch mode + skills private
   - Or code local + skills shared with team

### Workflow Example

1. You start outcome "RF CLI Tool" in private mode
2. Build skills A, B, C (all private)
3. Invite Alice as collaborator
4. Change skill A to "outcome" → Alice can now see it
5. Skill B stays private (only you)
6. Promote skill C to "team" → everyone in org can use it
7. Upload customer-data.csv marked as "contains PII" → locked private forever

The user always has explicit control over what gets shared and with whom.
