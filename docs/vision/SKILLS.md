# Skills

> Reusable instruction documents that workers load into their context.

---

## Purpose

Skills are the knowledge layer of Digital Twin. Instead of every worker figuring things out from scratch, skills provide:

1. **Methodology** - Step-by-step approaches to common tasks
2. **Tool references** - How to use available tools
3. **Quality criteria** - What good output looks like
4. **Triggers** - When to apply this skill

Think of skills as "employee training manuals" that workers read before starting work.

---

## Current State

**Status:** Complete and production-ready

The skill system handles:
- Global skills (shared across all outcomes)
- Outcome-specific skills (built during capability phase)
- Trigger-based matching (find relevant skills for a task)
- YAML frontmatter parsing
- Skill dependency resolution

---

## Key Concepts

### Two Skill Types

| Type | Location | Scope |
|------|----------|-------|
| **Global** | `/skills/` | Available to all outcomes |
| **Outcome** | `/workspaces/out_{id}/skills/` | Built for specific outcome |

Global skills are general-purpose (e.g., "web-research", "competitive-analysis").
Outcome skills are built during capability phase for that outcome's specific needs.

### Skill Structure

```markdown
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

### Trigger Matching

When a worker claims a task, the system searches for relevant skills:

```typescript
const searchQuery = `${task.title} ${task.description}`;
const matchedSkills = searchSkillsByTriggers(searchQuery);
```

Matching checks if any trigger keywords appear in the task.

---

## Components

### Primary Files

| File | Purpose |
|------|---------|
| `lib/agents/skill-manager.ts` | Load, parse, search skills |
| `lib/agents/skill-builder.ts` | Generate CLAUDE.md for building skills |
| `lib/agents/skill-dependency-resolver.ts` | Ensure required skills exist |
| `lib/db/skills.ts` | Skill database operations |

### Skill Loading Flow

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

## Skill Building

During capability phase, new skills are built:

1. **Planner detects need** - "This outcome needs a skill for X"
2. **Capability task created** - `phase: 'capability', capability_type: 'skill'`
3. **Worker claims task** - Gets special CLAUDE.md for skill building
4. **Skill document created** - Saved to `/workspaces/out_{id}/skills/`
5. **Validation** - Check YAML frontmatter and required sections

### Skill Builder Instructions

The skill builder generates specialized CLAUDE.md that tells the worker:
- Skill document template
- Required sections (Purpose, Methodology, Tools)
- YAML frontmatter format
- Quality criteria

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

## API

### GET /api/skills

List global skills.

### GET /api/skills/outcome?outcomeId={id}

List outcome-specific skills.

### POST /api/skills/create

Create a new global skill.

---

## Open Questions

1. **Skill versioning** - Skills evolve over time. Should we track versions and let workers pin to specific versions?

2. **Skill effectiveness** - How do we know if a skill actually helps? Could track success rates of tasks that use each skill.

3. **Context bloat** - Loading multiple skills can blow up context. Need smarter selection or skill summarization.

4. **Skill dependencies** - Skills can reference tools. Should skills also be able to reference other skills?

5. **API key requirements** - Skills can declare `requires: [API_KEY]`. But enforcement is incomplete - see IDEAS.md for planned improvements.
