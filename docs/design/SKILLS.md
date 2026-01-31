# Skills - Design

> Implementation details for skill loading, parsing, and matching.

---

## Architecture

### Files

| File | Purpose | Size |
|------|---------|------|
| `lib/agents/skill-manager.ts` | Load, parse, search skills | ~10KB |
| `lib/agents/skill-builder.ts` | Generate CLAUDE.md for building skills | ~6KB |
| `lib/agents/skill-dependency-resolver.ts` | Ensure required skills exist | ~5KB |
| `lib/db/skills.ts` | Skill database operations | ~4KB |

---

## Skill File Structure

```yaml
---
name: Web Research
description: Research topics using web search
triggers:
  - research
  - search
  - find information
requires:
  - SERPER_API_KEY
---

# Web Research

## Purpose
Explain why this skill exists...

## When to Use
- Situation 1
- Situation 2

## Methodology
### Step 1: Define search queries
...

### Step 2: Execute searches
...

## Tools Available
### search-web
**Path:** `../tools/search-web.ts`
**Run:** `npx ts-node ../tools/search-web.ts --query "..."`

## Output Template
```
## Research Findings
- Finding 1
- Finding 2
```

## Quality Checklist
- [ ] Multiple sources consulted
- [ ] Findings synthesized
```

---

## Skill Loading Flow

```
Task Claimed
     │
     ▼
┌─────────────────────────┐
│ Check task.required_skills │
└────────────┬────────────┘
             │
     ┌───────┴───────┐
     ▼               ▼
 Explicit         None specified
 skills              │
     │               ▼
     │        ┌─────────────────┐
     │        │ Search by       │
     │        │ triggers        │
     │        └────────┬────────┘
     │                 │
     └────────┬────────┘
              │
              ▼
┌─────────────────────────┐
│ Load skill documents    │
│ (global + outcome)      │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Inject into CLAUDE.md   │
│ context                 │
└─────────────────────────┘
```

---

## Dependencies

**Uses:**
- `lib/db/skills.ts` - Skill persistence
- `lib/workspace/detector.ts` - Find outcome skill paths

**Used by:**
- `lib/ralph/worker.ts` - Loads skills into context
- `lib/ralph/orchestrator.ts` - Triggers skill building
- `lib/agents/capability-planner.ts` - Detects skill needs

---

## API Specification

### GET /api/skills

List global skills.

**Response:**
```json
{
  "skills": [
    {
      "id": "skill_123",
      "name": "Web Research",
      "description": "Research topics using web search",
      "category": "research",
      "triggers": ["research", "search"],
      "requires": ["SERPER_API_KEY"],
      "usageCount": 14
    }
  ]
}
```

### GET /api/skills?includeKeyStatus=true

List skills with API key status.

**Response:**
```json
{
  "skills": [
    {
      "id": "skill_123",
      "name": "Web Research",
      "requires": ["SERPER_API_KEY"],
      "keyStatus": {
        "allConfigured": true,
        "missing": []
      }
    }
  ]
}
```

### GET /api/skills/outcome?outcomeId={id}

List outcome-specific skills.

### POST /api/skills/create

Create a new global skill.

---

## Trigger Matching

```typescript
const searchQuery = `${task.title} ${task.description}`;
const matchedSkills = searchSkillsByTriggers(searchQuery);

function searchSkillsByTriggers(query: string): Skill[] {
  const queryLower = query.toLowerCase();
  return getAllSkills().filter(skill => {
    const triggers = JSON.parse(skill.triggers || '[]');
    return triggers.some(trigger =>
      queryLower.includes(trigger.toLowerCase())
    );
  });
}
```

---

## Skill Building Task

During capability phase, skills are built via special tasks:

```typescript
createTask({
  outcome_id: outcomeId,
  title: `Build skill: ${skillName}`,
  description: `Create a skill for ${skillName}...`,
  phase: 'capability',
  capability_type: 'skill',
  priority: 50,  // High priority
});
```

The worker gets specialized CLAUDE.md instructions for skill building.

---

## YAML Parsing

```typescript
function parseSkillFile(content: string): SkillMetadata {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) throw new Error('No frontmatter');

  const yaml = parse(frontmatterMatch[1]);
  return {
    name: yaml.name,
    description: yaml.description,
    triggers: yaml.triggers || [],
    requires: yaml.requires || [],
  };
}
```

---

## Database Schema

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  category TEXT,
  triggers TEXT,      -- JSON array
  requires TEXT,      -- JSON array of API key names
  usage_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
```

---

## Repository Sync

Skills can be synced to external repositories for sharing and reuse.

### Files

| File | Purpose |
|------|---------|
| `lib/db/repositories.ts` | Repository CRUD, item tracking |
| `lib/sync/repository-sync.ts` | Core sync logic (copy, git operations) |
| `app/api/repositories/route.ts` | Repository management API |
| `app/api/outcomes/[id]/items/route.ts` | Item sync/promotion API |

### Save Targets

| Target | Description |
|--------|-------------|
| `local` | Stays in workspace only (default) |
| `private` | Synced to personal repository |
| `team` | Synced to shared team repository |

### API: Item Promotion

```
PATCH /api/outcomes/{id}/items
{
  "item_type": "skill",
  "filename": "my-skill.md",
  "action": "promote",
  "target": "team"
}
```

### Sync Flow

```
Skill Built
     │
     ▼
┌────────────────────────┐
│ Check outcome.auto_save │
└──────────┬─────────────┘
           │ if enabled
           ▼
┌────────────────────────┐
│ Get effective target   │
│ (skill_target default) │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Get repository config  │
│ for target type        │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Copy file to repo      │
│ Git add, commit, push  │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Mark item as synced    │
└────────────────────────┘
```

### UI Components

- `SkillsSection.tsx` - Shows sync status badge, promotion buttons
- `ToolsSection.tsx` - Same pattern for tools
- `SaveTargetsSection.tsx` - Configure outcome defaults
