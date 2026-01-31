# Repository Configuration Design

## Overview

Users can configure where different types of content are saved. Four content types, each can go to local, private repo, or team repo.

## Content Types

| Type | Description | Examples |
|------|-------------|----------|
| **Outputs** | Outcome work product | Code, reports, websites, research docs |
| **Skills** | Reusable instructions | market-research.md, code-review.md |
| **Tools** | Reusable scripts | web-scraper.ts, data-aggregator.ts |
| **Files** | Uploaded data | customers.csv, report.pdf, notes.docx |

## Save Targets

| Target | Where It Goes | Who Can See |
|--------|---------------|-------------|
| **Local** | Workspace only | Just you, this outcome |
| **Private** | Your private repo | Just you, all outcomes |
| **Team** | Team shared repo | Your team |

## Database Schema

### `repositories` Table

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'private' | 'team'
  content_type TEXT NOT NULL,  -- 'outputs' | 'skills' | 'tools' | 'files' | 'all'
  repo_url TEXT,
  local_path TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  auto_push INTEGER DEFAULT 1,
  require_pr INTEGER DEFAULT 0,  -- for team repos
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Updated `outcomes` Table

```sql
ALTER TABLE outcomes ADD COLUMN output_target TEXT DEFAULT 'local';  -- 'local' | 'private' | 'team'
ALTER TABLE outcomes ADD COLUMN skill_target TEXT DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN tool_target TEXT DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN file_target TEXT DEFAULT 'local';
ALTER TABLE outcomes ADD COLUMN auto_save INTEGER DEFAULT 0;
```

### `outcome_items` Table

Track individual items and their sync status:

```sql
CREATE TABLE outcome_items (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,  -- 'output' | 'skill' | 'tool' | 'file'
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  target_override TEXT,  -- null = use outcome default, or 'local' | 'private' | 'team'
  synced_to_private INTEGER DEFAULT 0,
  synced_to_team INTEGER DEFAULT 0,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(outcome_id, item_type, filename)
);
```

## UI: Settings > Repositories

```
┌────────────────────────────────────────────────────────────┐
│ Repository Configuration                                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ Setup Mode                                                 │
│ ┌────────────────────────────────────────────────────────┐│
│ │ ● Simple (one repo for everything)                     ││
│ │ ○ Advanced (separate repos per type)                   ││
│ └────────────────────────────────────────────────────────┘│
│                                                            │
│ Private Repository                                         │
│ ┌────────────────────────────────────────────────────────┐│
│ │ URL:   git@github.com:me/my-library.git                ││
│ │ Local: ~/my-library                                    ││
│ │ Status: ✓ Connected                     [Test] [Edit]  ││
│ └────────────────────────────────────────────────────────┘│
│                                                            │
│ Team Repository (optional)                                 │
│ ┌────────────────────────────────────────────────────────┐│
│ │ URL:   git@github.com:team/shared-library.git          ││
│ │ Local: ~/team-library                                  ││
│ │ [✓] Require PR for changes                             ││
│ │ Status: ✓ Connected                     [Test] [Edit]  ││
│ └────────────────────────────────────────────────────────┘│
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## UI: Outcome Configuration

```
┌────────────────────────────────────────────────────────────┐
│ Save Settings                                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ Default save target for new items:                         │
│                                                            │
│              Local    Private    Team                      │
│ Outputs:      ○         ●         ○                        │
│ Skills:       ○         ●         ○                        │
│ Tools:        ○         ●         ○                        │
│ Files:        ●         ○         ○   ← safe default       │
│                                                            │
│ [✓] Auto-save as workers build                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## UI: Item Cards with Promotion

```
┌────────────────────────────────────────────────────────────┐
│ Skills                                                     │
├────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────┐│
│ │ 📄 market-research.md                                  ││
│ │ Saved to: Private                                      ││
│ │ [View] [Edit] [→ Push to Team]                         ││
│ └────────────────────────────────────────────────────────┘│
│ ┌────────────────────────────────────────────────────────┐│
│ │ 📄 internal-notes.md                                   ││
│ │ Local only                                             ││
│ │ [View] [Edit] [→ Save to Private] [→ Save to Team]     ││
│ └────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

## Folder Structure

### Simple Mode (one repo)

```
my-library/
├── outputs/
│   └── {outcome-id}/
│       └── ...
├── skills/
│   └── market-research.md
├── tools/
│   └── web-scraper.ts
└── files/
    └── reference-data.csv
```

### Advanced Mode (separate repos)

```
my-outputs/        ← outputs repo
├── {outcome-id}/
│   └── ...

my-skills/         ← skills repo
├── market-research.md
└── code-review.md

my-tools/          ← tools repo
├── web-scraper.ts
└── data-aggregator.ts

my-files/          ← files repo
├── reference-data.csv
└── templates/
```

## Implementation Phases

### Phase 1: Database & Core
1. Add `repositories` table
2. Add columns to `outcomes` table
3. Add `outcome_items` table
4. Create `lib/db/repositories.ts` with CRUD

### Phase 2: Settings UI
1. Add Repositories section to Settings page
2. Simple/Advanced mode toggle
3. Repository configuration forms
4. Connection testing

### Phase 3: Outcome Configuration
1. Add Save Settings section to outcome page
2. Default target radio buttons
3. Auto-save toggle

### Phase 4: Sync Logic
1. Create `lib/sync/repository-sync.ts`
2. Hook into skill-builder, tool-builder
3. File upload sync
4. Manual promotion actions

### Phase 5: Item UI
1. Show sync status on skill/tool/file cards
2. Promotion buttons
3. Sync status indicators
