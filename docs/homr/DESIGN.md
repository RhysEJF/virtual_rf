# The HOMЯ Protocol: Design Document

> Technical architecture and implementation details for the intelligent orchestration layer.

**Related Documents:**
- [VISION.md](./VISION.md) - What HOMЯ does and why
- [../../CLAUDE.md](../../CLAUDE.md) - Project coding standards

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Specifications](#component-specifications)
3. [Data Model](#data-model)
4. [Integration Points](#integration-points)
5. [API Design](#api-design)
6. [UI Components](#ui-components)
7. [Implementation Phases](#implementation-phases)
8. [Configuration](#configuration)

---

## Architecture Overview

### System Placement

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              OUTCOME                                          │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         THE HOMЯ PROTOCOL                                │ │
│  │                                                                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │ │
│  │  │   Observer   │  │   Steerer    │  │  Escalator   │  │   Context   │ │ │
│  │  │              │  │              │  │              │  │   Store     │ │ │
│  │  │ • Reviews    │  │ • Modifies   │  │ • Detects    │  │             │ │ │
│  │  │   output     │  │   tasks      │  │   ambiguity  │  │ • Cross-    │ │ │
│  │  │ • Checks     │  │ • Injects    │  │ • Pauses     │  │   task      │ │ │
│  │  │   alignment  │  │   context    │  │   work       │  │   memory    │ │ │
│  │  │ • Extracts   │  │ • Adjusts    │  │ • Creates    │  │ • Intent    │ │ │
│  │  │   learnings  │  │   priority   │  │   questions  │  │   cache     │ │ │
│  │  │              │  │              │  │              │  │             │ │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │ │
│  │         │                 │                 │                 │        │ │
│  │         └─────────────────┴─────────────────┴─────────────────┘        │ │
│  │                                   │                                     │ │
│  │                           HOMЯ Core Loop                                │ │
│  │                                   │                                     │ │
│  └───────────────────────────────────┼─────────────────────────────────────┘ │
│                                      │                                       │
│         ┌────────────────────────────┼────────────────────────────┐          │
│         │                            │                            │          │
│         ▼                            ▼                            ▼          │
│  ┌─────────────┐            ┌─────────────┐             ┌─────────────┐      │
│  │  Supervisor │            │    Ralph    │             │  Reviewer   │      │
│  │  (Security) │            │   Workers   │             │   Agent     │      │
│  │             │            │             │             │             │      │
│  │  Watches    │            │  Execute    │             │  Deep       │      │
│  │  files      │◀───────────│  tasks      │────────────▶│  review     │      │
│  │             │            │             │             │             │      │
│  └─────────────┘            └─────────────┘             └─────────────┘      │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Core Loop

HOMЯ runs a continuous observation-steering loop:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOMЯ CORE LOOP                               │
│                                                                     │
│                    ┌──────────────────┐                             │
│                    │   Task Completes │                             │
│                    │    (trigger)     │                             │
│                    └────────┬─────────┘                             │
│                             │                                       │
│                             ▼                                       │
│                    ┌──────────────────┐                             │
│                    │     OBSERVE      │                             │
│                    │                  │                             │
│                    │ • Read output    │                             │
│                    │ • Check intent   │                             │
│                    │ • Extract learns │                             │
│                    └────────┬─────────┘                             │
│                             │                                       │
│                             ▼                                       │
│              ┌──────────────────────────────┐                       │
│              │      Analysis Result         │                       │
│              │                              │                       │
│              │  on_track: boolean           │                       │
│              │  drift: string[]             │                       │
│              │  discoveries: Discovery[]    │                       │
│              │  quality: 'good'|'fix'|'bad' │                       │
│              │  ambiguity: Ambiguity|null   │                       │
│              └──────────────┬───────────────┘                       │
│                             │                                       │
│           ┌─────────────────┼─────────────────┐                     │
│           │                 │                 │                     │
│           ▼                 ▼                 ▼                     │
│    ┌────────────┐   ┌────────────┐   ┌────────────┐                │
│    │ ambiguity? │   │  drift?    │   │discoveries?│                │
│    │            │   │            │   │            │                │
│    │ ESCALATE   │   │  STEER     │   │  STEER     │                │
│    │            │   │            │   │            │                │
│    │ Pause +    │   │ Modify     │   │ Inject     │                │
│    │ Question   │   │ tasks      │   │ context    │                │
│    └────────────┘   └────────────┘   └────────────┘                │
│           │                 │                 │                     │
│           └─────────────────┴─────────────────┘                     │
│                             │                                       │
│                             ▼                                       │
│                    ┌──────────────────┐                             │
│                    │  Update Context  │                             │
│                    │     Store        │                             │
│                    └────────┬─────────┘                             │
│                             │                                       │
│                             ▼                                       │
│                    ┌──────────────────┐                             │
│                    │  Wait for Next   │                             │
│                    │  Task Completion │                             │
│                    └──────────────────┘                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Observer (`lib/homr/observer.ts`)

**Purpose:** Analyze completed task output against intent and design.

**Inputs:**
- Completed task with full output
- Outcome intent (PRD)
- Outcome approach (Design Doc)
- Current context store state

**Outputs:**
```typescript
interface ObservationResult {
  taskId: string;
  timestamp: number;

  // Alignment assessment
  onTrack: boolean;
  alignmentScore: number;  // 0-100
  drift: DriftItem[];

  // Quality assessment
  quality: 'good' | 'needs_work' | 'off_rails';
  issues: QualityIssue[];

  // Extracted learnings
  discoveries: Discovery[];
  decisions: Decision[];

  // Ambiguity detection
  ambiguity: AmbiguitySignal | null;

  // Summary for logging
  summary: string;
}

interface DriftItem {
  type: 'scope_creep' | 'wrong_direction' | 'missed_requirement' | 'contradicts_design';
  description: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string;  // Quote from output
}

interface Discovery {
  type: 'constraint' | 'dependency' | 'pattern' | 'decision' | 'blocker';
  content: string;
  relevantTasks: string[];  // Task IDs that should know about this
  source: string;  // Where this was found in output
}

interface AmbiguitySignal {
  detected: boolean;
  type: 'unclear_requirement' | 'multiple_approaches' | 'blocking_decision' | 'contradicting_info';
  description: string;
  evidence: string[];
  affectedTasks: string[];
  suggestedQuestion: string;
  options?: QuestionOption[];
}
```

**Implementation Approach:**

The Observer uses Claude to analyze task outputs semantically:

```typescript
async function observeTask(
  task: Task,
  fullOutput: string,
  intent: Intent,
  designDoc: string,
  contextStore: ContextStore
): Promise<ObservationResult> {

  // Build analysis prompt
  const prompt = buildObservationPrompt(task, fullOutput, intent, designDoc, contextStore);

  // Use Claude to analyze (smaller model for efficiency)
  const analysis = await claude.analyze(prompt, { model: 'haiku' });

  // Parse structured response
  const result = parseObservationResponse(analysis);

  // Store observation in database
  storeObservation(result);

  return result;
}
```

**Observation Prompt Structure:**

```markdown
# Task Observation Analysis

## Context
- Outcome: {outcomeName}
- Task: {taskTitle}
- Intent: {intentSummary}
- Approach: {designDocSummary}

## Prior Context (from other tasks)
{contextStoreSummary}

## Task Output
```
{fullOutput}
```

## Analysis Required

1. **Alignment Check**
   - Does this work align with the intent?
   - Does it follow the design approach?
   - Any scope creep or wrong direction?

2. **Quality Assessment**
   - Is the work well-executed?
   - Any obvious issues or shortcuts?

3. **Discovery Extraction**
   - What did this task learn that other tasks should know?
   - Any constraints, dependencies, or patterns discovered?

4. **Ambiguity Detection**
   - Does the output show uncertainty?
   - Are there unresolved decisions?
   - Would a human want to know about something before continuing?

Respond in JSON format: { onTrack, drift, quality, discoveries, ambiguity, summary }
```

---

### 2. Steerer (`lib/homr/steerer.ts`)

**Purpose:** Modify the work environment based on observations.

**Capabilities:**

```typescript
interface SteererActions {
  // Context injection
  injectContext(taskIds: string[], context: ContextInjection): void;

  // Task modification
  updateTaskDescription(taskId: string, additions: string): void;
  updateTaskPriority(taskId: string, newPriority: number, reason: string): void;
  markTaskObsolete(taskId: string, reason: string): void;

  // Task creation
  createTask(task: NewTaskInput, reason: string): string;

  // Dependency management
  addTaskDependency(taskId: string, dependsOn: string, reason: string): void;

  // Design doc suggestions
  suggestDesignUpdate(suggestion: DesignSuggestion): void;
}

interface ContextInjection {
  type: 'discovery' | 'warning' | 'constraint' | 'pattern';
  content: string;
  source: string;  // Which task discovered this
  priority: 'must_know' | 'should_know' | 'nice_to_know';
}
```

**How Context Injection Works:**

When a task is about to start, HOMЯ builds its context:

```typescript
function buildTaskContext(task: Task, outcomeId: string): string {
  const contextStore = getContextStore(outcomeId);

  // Get discoveries relevant to this task
  const relevantDiscoveries = contextStore.discoveries
    .filter(d => d.relevantTasks.includes(task.id) || d.relevantTasks.includes('*'))
    .sort((a, b) => priorityOrder(b.priority) - priorityOrder(a.priority));

  // Get injections specifically for this task
  const injections = contextStore.injections
    .filter(i => i.targetTaskId === task.id);

  // Build context section for CLAUDE.md
  return `
## HOMЯ Context (Cross-Task Learnings)

${relevantDiscoveries.map(d => `
### ${d.type}: ${d.content}
_Discovered by Task ${d.source}_
`).join('\n')}

${injections.map(i => `
### ${i.type}: ${i.content}
`).join('\n')}
`;
}
```

**Steering Decision Logic:**

```typescript
async function steer(observation: ObservationResult): Promise<SteeringActions> {
  const actions: SteeringActions = [];

  // Handle drift
  if (observation.drift.length > 0) {
    for (const drift of observation.drift) {
      if (drift.severity === 'high') {
        // Create corrective task
        actions.push({
          type: 'create_task',
          task: {
            title: `Fix: ${drift.description}`,
            description: `Correct drift detected by HOMЯ: ${drift.evidence}`,
            priority: 1,  // High priority
          }
        });
      } else {
        // Add warning to pending tasks
        const pendingTasks = getPendingTasks(observation.outcomeId);
        actions.push({
          type: 'inject_context',
          taskIds: pendingTasks.map(t => t.id),
          context: {
            type: 'warning',
            content: `Previous task drifted: ${drift.description}. Ensure you stay aligned.`,
            source: observation.taskId,
            priority: 'should_know',
          }
        });
      }
    }
  }

  // Share discoveries
  if (observation.discoveries.length > 0) {
    for (const discovery of observation.discoveries) {
      actions.push({
        type: 'inject_context',
        taskIds: discovery.relevantTasks,
        context: {
          type: 'discovery',
          content: discovery.content,
          source: observation.taskId,
          priority: discovery.type === 'blocker' ? 'must_know' : 'should_know',
        }
      });
    }
  }

  return actions;
}
```

---

### 3. Escalator (`lib/homr/escalator.ts`)

**Purpose:** Detect when human input is needed and manage the escalation process.

**Ambiguity Detection Patterns:**

```typescript
const AMBIGUITY_PATTERNS = [
  // Uncertainty markers in output
  { pattern: /I('m| am) (not sure|unsure|uncertain)/i, type: 'explicit_uncertainty' },
  { pattern: /assuming (that|this)/i, type: 'assumption' },
  { pattern: /could (go either|be done|approach)/i, type: 'multiple_approaches' },
  { pattern: /need(s)? clarification/i, type: 'explicit_request' },
  { pattern: /which (approach|method|way)/i, type: 'decision_needed' },

  // Blocking indicators
  { pattern: /blocked (by|on|waiting)/i, type: 'blocker' },
  { pattern: /can('t| not) proceed/i, type: 'blocker' },

  // Contradiction indicators
  { pattern: /contradict(s|ing)?/i, type: 'contradiction' },
  { pattern: /conflict(s|ing)? with/i, type: 'contradiction' },
];
```

**Escalation Process:**

```typescript
interface Escalation {
  id: string;
  outcomeId: string;
  createdAt: number;
  status: 'pending' | 'answered' | 'dismissed';

  // What triggered this
  trigger: {
    type: AmbiguitySignal['type'];
    taskId: string;
    evidence: string[];
  };

  // The question for the human
  question: {
    text: string;
    context: string;
    options: QuestionOption[];
  };

  // What's affected
  affectedTasks: string[];  // These are paused

  // Resolution
  answer?: {
    selectedOption: string;
    additionalContext?: string;
    answeredAt: number;
  };
}

interface QuestionOption {
  id: string;
  label: string;
  description: string;
  implications: string;  // What happens if chosen
}
```

**Creating Structured Questions:**

HOMЯ doesn't just say "help" - it formulates specific questions:

```typescript
async function createEscalation(
  ambiguity: AmbiguitySignal,
  task: Task,
  outcome: Outcome
): Promise<Escalation> {

  // Use Claude to generate a clear question with options
  const prompt = `
Given this ambiguity detected during task execution:

Task: ${task.title}
Ambiguity Type: ${ambiguity.type}
Evidence: ${ambiguity.evidence.join('\n')}

Outcome Intent: ${outcome.intent}

Generate a clear question for the human with 2-4 concrete options.
Each option should include:
- A short label
- A description of what it means
- The implications of choosing it

Format as JSON: { question, options: [{ id, label, description, implications }] }
`;

  const response = await claude.generate(prompt, { model: 'sonnet' });
  const { question, options } = JSON.parse(response);

  // Pause affected tasks
  for (const taskId of ambiguity.affectedTasks) {
    pauseTask(taskId, `Paused by HOMЯ: Awaiting human input on ${ambiguity.type}`);
  }

  // Create escalation record
  const escalation: Escalation = {
    id: generateId('esc'),
    outcomeId: outcome.id,
    createdAt: Date.now(),
    status: 'pending',
    trigger: {
      type: ambiguity.type,
      taskId: task.id,
      evidence: ambiguity.evidence,
    },
    question: {
      text: question,
      context: ambiguity.description,
      options,
    },
    affectedTasks: ambiguity.affectedTasks,
  };

  // Store and notify
  storeEscalation(escalation);
  notifyUser(escalation);

  return escalation;
}
```

**Resolving Escalations:**

```typescript
async function resolveEscalation(
  escalationId: string,
  answer: { selectedOption: string; additionalContext?: string }
): Promise<void> {
  const escalation = getEscalation(escalationId);

  // Update escalation record
  escalation.status = 'answered';
  escalation.answer = {
    ...answer,
    answeredAt: Date.now(),
  };

  // Inject the decision into context
  const selectedOption = escalation.question.options.find(o => o.id === answer.selectedOption);

  injectContext(escalation.affectedTasks, {
    type: 'decision',
    content: `Human decided: ${selectedOption.label}. ${answer.additionalContext || ''}`,
    source: 'HOMЯ Escalation',
    priority: 'must_know',
  });

  // Resume affected tasks
  for (const taskId of escalation.affectedTasks) {
    resumeTask(taskId);
  }

  // Log the resolution
  logHomrActivity({
    type: 'escalation_resolved',
    escalationId,
    selectedOption: selectedOption.label,
  });
}
```

---

### 4. Context Store (`lib/homr/context-store.ts`)

**Purpose:** Maintain cross-task memory and learnings.

**Data Structure:**

```typescript
interface ContextStore {
  outcomeId: string;

  // Accumulated discoveries
  discoveries: Discovery[];

  // Decisions made (by humans or derived)
  decisions: Decision[];

  // Active constraints
  constraints: Constraint[];

  // Pending injections for specific tasks
  injections: ContextInjection[];

  // Observation history (compacted)
  observationHistory: ObservationSummary[];

  // Statistics
  stats: {
    tasksObserved: number;
    discoveriesExtracted: number;
    escalationsCreated: number;
    steeringActions: number;
  };
}

interface Decision {
  id: string;
  content: string;
  madeBy: 'human' | 'worker' | 'homr';
  madeAt: number;
  context: string;
  affectedAreas: string[];
}

interface Constraint {
  id: string;
  type: 'technical' | 'business' | 'dependency' | 'resource';
  content: string;
  discoveredAt: number;
  source: string;
  active: boolean;
}
```

**Context Compaction:**

To prevent context from growing unboundedly:

```typescript
function compactContext(store: ContextStore): ContextStore {
  const DISCOVERY_LIMIT = 50;
  const OBSERVATION_LIMIT = 20;

  // Keep most relevant discoveries
  if (store.discoveries.length > DISCOVERY_LIMIT) {
    // Score by recency and relevance
    const scored = store.discoveries.map(d => ({
      ...d,
      score: calculateRelevanceScore(d),
    }));

    // Keep top discoveries, summarize the rest
    const top = scored.sort((a, b) => b.score - a.score).slice(0, DISCOVERY_LIMIT);
    const rest = scored.slice(DISCOVERY_LIMIT);

    // Create summary of compacted discoveries
    if (rest.length > 0) {
      const summary: Discovery = {
        type: 'pattern',
        content: `[Compacted] ${rest.length} earlier discoveries including: ${rest.slice(0, 3).map(d => d.content).join('; ')}...`,
        relevantTasks: ['*'],
        source: 'HOMЯ Compaction',
      };
      store.discoveries = [...top, summary];
    }
  }

  // Compact observation history
  if (store.observationHistory.length > OBSERVATION_LIMIT) {
    const recent = store.observationHistory.slice(-OBSERVATION_LIMIT / 2);
    const old = store.observationHistory.slice(0, -OBSERVATION_LIMIT / 2);

    // Create summary observation
    const summary: ObservationSummary = {
      type: 'compacted',
      content: `[Compacted] ${old.length} observations from tasks ${old.map(o => o.taskId).join(', ')}`,
      timestamp: old[0].timestamp,
    };

    store.observationHistory = [summary, ...recent];
  }

  return store;
}
```

---

## Data Model

### Database Schema Additions

```sql
-- HOMЯ Context Store
CREATE TABLE homr_context (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- Serialized context store
  discoveries TEXT NOT NULL DEFAULT '[]',  -- JSON array
  decisions TEXT NOT NULL DEFAULT '[]',    -- JSON array
  constraints TEXT NOT NULL DEFAULT '[]',  -- JSON array
  injections TEXT NOT NULL DEFAULT '[]',   -- JSON array

  -- Statistics
  tasks_observed INTEGER NOT NULL DEFAULT 0,
  discoveries_extracted INTEGER NOT NULL DEFAULT 0,
  escalations_created INTEGER NOT NULL DEFAULT 0,
  steering_actions INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_homr_context_outcome ON homr_context(outcome_id);

-- HOMЯ Observations
CREATE TABLE homr_observations (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- Observation results
  on_track INTEGER NOT NULL,  -- boolean
  alignment_score INTEGER NOT NULL,
  quality TEXT NOT NULL,  -- 'good', 'needs_work', 'off_rails'

  -- Serialized data
  drift TEXT NOT NULL DEFAULT '[]',        -- JSON array
  discoveries TEXT NOT NULL DEFAULT '[]',  -- JSON array
  issues TEXT NOT NULL DEFAULT '[]',       -- JSON array

  -- Ambiguity
  has_ambiguity INTEGER NOT NULL DEFAULT 0,
  ambiguity_data TEXT,  -- JSON if has_ambiguity

  -- Summary
  summary TEXT NOT NULL
);

CREATE INDEX idx_homr_observations_outcome ON homr_observations(outcome_id);
CREATE INDEX idx_homr_observations_task ON homr_observations(task_id);

-- HOMЯ Escalations
CREATE TABLE homr_escalations (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'answered', 'dismissed'

  -- Trigger
  trigger_type TEXT NOT NULL,
  trigger_task_id TEXT NOT NULL,
  trigger_evidence TEXT NOT NULL,  -- JSON array

  -- Question
  question_text TEXT NOT NULL,
  question_context TEXT NOT NULL,
  question_options TEXT NOT NULL,  -- JSON array

  -- Affected tasks (JSON array of task IDs)
  affected_tasks TEXT NOT NULL DEFAULT '[]',

  -- Resolution
  answer_option TEXT,
  answer_context TEXT,
  answered_at INTEGER
);

CREATE INDEX idx_homr_escalations_outcome ON homr_escalations(outcome_id);
CREATE INDEX idx_homr_escalations_status ON homr_escalations(status);

-- HOMЯ Activity Log
CREATE TABLE homr_activity_log (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  -- Activity type
  type TEXT NOT NULL,  -- 'observation', 'steering', 'escalation', 'resolution'

  -- Details (JSON)
  details TEXT NOT NULL,

  -- Human-readable summary
  summary TEXT NOT NULL
);

CREATE INDEX idx_homr_activity_outcome ON homr_activity_log(outcome_id);
CREATE INDEX idx_homr_activity_type ON homr_activity_log(type);
```

### TypeScript Schema Types

```typescript
// lib/db/schema.ts additions

export interface HomrContext {
  id: string;
  outcome_id: string;
  created_at: number;
  updated_at: number;
  discoveries: Discovery[];
  decisions: Decision[];
  constraints: Constraint[];
  injections: ContextInjection[];
  tasks_observed: number;
  discoveries_extracted: number;
  escalations_created: number;
  steering_actions: number;
}

export interface HomrObservation {
  id: string;
  outcome_id: string;
  task_id: string;
  created_at: number;
  on_track: boolean;
  alignment_score: number;
  quality: 'good' | 'needs_work' | 'off_rails';
  drift: DriftItem[];
  discoveries: Discovery[];
  issues: QualityIssue[];
  has_ambiguity: boolean;
  ambiguity_data?: AmbiguitySignal;
  summary: string;
}

export interface HomrEscalation {
  id: string;
  outcome_id: string;
  created_at: number;
  status: 'pending' | 'answered' | 'dismissed';
  trigger_type: string;
  trigger_task_id: string;
  trigger_evidence: string[];
  question_text: string;
  question_context: string;
  question_options: QuestionOption[];
  affected_tasks: string[];
  answer_option?: string;
  answer_context?: string;
  answered_at?: number;
}

export interface HomrActivityLog {
  id: string;
  outcome_id: string;
  created_at: number;
  type: 'observation' | 'steering' | 'escalation' | 'resolution';
  details: Record<string, unknown>;
  summary: string;
}
```

---

## Integration Points

### 1. Ralph Worker Integration

HOMЯ hooks into the task completion flow:

```typescript
// lib/ralph/worker.ts modifications

async function onTaskComplete(task: Task, result: TaskResult): Promise<void> {
  // Existing completion logic...
  completeTask(task.id);

  // NEW: Trigger HOMЯ observation
  if (isHomrEnabled(task.outcome_id)) {
    const observation = await homr.observe(task, result.fullOutput);

    // Handle observation results
    if (observation.ambiguity) {
      await homr.escalate(observation.ambiguity, task);
    } else {
      await homr.steer(observation);
    }
  }
}
```

### 2. Task Context Enhancement

Before a task starts, inject HOMЯ context:

```typescript
// lib/ralph/worker.ts modifications

function generateTaskInstructions(
  outcomeName: string,
  intent: Intent | null,
  task: Task,
  additionalSkillContext?: string
): string {
  // Existing instruction generation...

  // NEW: Add HOMЯ context
  const homrContext = homr.buildTaskContext(task.id, task.outcome_id);

  return `# Current Task

## Outcome: ${outcomeName}
${intentSummary}

${homrContext ? `---\n\n${homrContext}\n\n---\n` : ''}

## Your Current Task
...
`;
}
```

### 3. Outcome Page Integration

Show HOMЯ status on the outcome detail page:

```typescript
// app/api/outcomes/[id]/homr/route.ts

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const outcomeId = params.id;

  const context = getHomrContext(outcomeId);
  const recentObservations = getRecentObservations(outcomeId, 5);
  const pendingEscalations = getPendingEscalations(outcomeId);
  const recentActivity = getHomrActivity(outcomeId, 10);

  return NextResponse.json({
    enabled: isHomrEnabled(outcomeId),
    context: {
      discoveries: context.discoveries.length,
      decisions: context.decisions.length,
      constraints: context.constraints.length,
    },
    stats: {
      tasksObserved: context.tasks_observed,
      discoveriesExtracted: context.discoveries_extracted,
      escalationsCreated: context.escalations_created,
      steeringActions: context.steering_actions,
    },
    recentObservations,
    pendingEscalations,
    recentActivity,
  });
}
```

---

## API Design

### HOMЯ API Endpoints

```
GET  /api/outcomes/:id/homr           # Get HOMЯ status for outcome
POST /api/outcomes/:id/homr/enable    # Enable HOMЯ for outcome
POST /api/outcomes/:id/homr/disable   # Disable HOMЯ for outcome

GET  /api/outcomes/:id/homr/context   # Get full context store
GET  /api/outcomes/:id/homr/observations  # List observations
GET  /api/outcomes/:id/homr/activity  # Get activity log

GET  /api/outcomes/:id/homr/escalations           # List escalations
GET  /api/outcomes/:id/homr/escalations/:escId    # Get escalation details
POST /api/outcomes/:id/homr/escalations/:escId/answer  # Answer escalation
POST /api/outcomes/:id/homr/escalations/:escId/dismiss # Dismiss escalation
```

### Escalation Answer Request

```typescript
// POST /api/outcomes/:id/homr/escalations/:escId/answer

interface AnswerEscalationRequest {
  selectedOption: string;  // Option ID
  additionalContext?: string;  // Optional user notes
}

interface AnswerEscalationResponse {
  success: boolean;
  resumedTasks: string[];  // Task IDs that were unpaused
}
```

---

## UI Components

### 1. HOMЯ Status Card

```
┌─ HOMЯ PROTOCOL ─────────────────────────────────────────────────────┐
│                                                                      │
│  ● Active                                              [Configure]   │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │     12     │  │      8     │  │      3     │  │      1     │    │
│  │  Observed  │  │ Discoveries│  │  Steered   │  │  Escalated │    │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │
│                                                                      │
│  Latest: Injected rate limit discovery into Tasks #7, #8 (2m ago)   │
│                                                                      │
│  [View Activity Log]                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. Pending Escalation Alert

```
┌─ ⚠ HOMЯ NEEDS INPUT ────────────────────────────────────────────────┐
│                                                                      │
│  Database Schema Approach                                            │
│                                                                      │
│  While working on "Setup Database Models", HOMЯ detected multiple    │
│  valid approaches that require your preference.                      │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ ○ Option A: Normalized Schema                                  │ │
│  │   Traditional relational design with foreign keys               │ │
│  │   → More complex queries, better data integrity                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ ○ Option B: Denormalized/Document Style                        │ │
│  │   Embed related data, fewer joins                               │ │
│  │   → Faster reads, potential data duplication                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Additional context (optional):                                 │ │
│  │ ┌──────────────────────────────────────────────────────────┐  │ │
│  │ │                                                          │  │ │
│  │ └──────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Tasks paused: #4, #5, #6                                            │
│                                                                      │
│  [Submit Decision]                              [Dismiss & Continue] │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3. Activity Log Drawer

```
┌─ HOMЯ ACTIVITY LOG ─────────────────────────────────────────────────┐
│                                                                      │
│  Today                                                               │
│  ─────                                                               │
│                                                                      │
│  14:32  OBSERVATION  Task #8 "API Integration"                       │
│         ✓ On track (92% alignment)                                   │
│         Discovered: API has 100 req/min rate limit                   │
│                                                                      │
│  14:32  STEERING  Injected rate limit discovery                      │
│         → Task #9, #10, #11                                          │
│                                                                      │
│  14:28  OBSERVATION  Task #7 "User Authentication"                   │
│         ⚠ Drift detected: Using JWT instead of sessions              │
│         Created corrective task #12                                  │
│                                                                      │
│  14:15  ESCALATION RESOLVED                                          │
│         Database schema: User chose "Normalized"                     │
│         Resumed tasks #4, #5, #6                                     │
│                                                                      │
│  14:02  ESCALATION CREATED                                           │
│         Database schema approach - 2 options presented               │
│         Paused tasks #4, #5, #6                                      │
│                                                                      │
│  [Load More]                                                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Context Store + Basic Observation)

**Goal:** Get HOMЯ observing tasks and storing context.

**Deliverables:**
- [ ] Database schema for HOMЯ tables
- [ ] `lib/homr/context-store.ts` - CRUD operations
- [ ] `lib/homr/observer.ts` - Basic observation (alignment check only)
- [ ] Hook into Ralph task completion
- [ ] API endpoint: `GET /api/outcomes/:id/homr`

**Success Criteria:**
- Every completed task creates an observation record
- Context store accumulates discoveries
- Can see HOMЯ status via API

### Phase 2: Discovery Extraction + Context Injection

**Goal:** HOMЯ extracts learnings and shares them across tasks.

**Deliverables:**
- [ ] Enhanced observer with discovery extraction
- [ ] `lib/homr/steerer.ts` - Context injection
- [ ] Modify Ralph to include HOMЯ context in CLAUDE.md
- [ ] Context compaction logic

**Success Criteria:**
- Discoveries from Task A appear in Task B's context
- Context doesn't grow unboundedly
- Workers acknowledge HOMЯ context in their outputs

### Phase 3: Steering Actions

**Goal:** HOMЯ can modify tasks based on observations.

**Deliverables:**
- [ ] Task modification via Steerer
- [ ] Priority adjustment logic
- [ ] Corrective task creation
- [ ] Design doc suggestion system
- [ ] Activity log recording

**Success Criteria:**
- Drift detection creates corrective tasks
- Priority changes based on discovered dependencies
- All steering actions logged

### Phase 4: Escalation System

**Goal:** HOMЯ detects ambiguity and asks humans.

**Deliverables:**
- [ ] `lib/homr/escalator.ts` - Full implementation
- [ ] Ambiguity detection patterns
- [ ] Structured question generation
- [ ] Task pausing/resumption
- [ ] API endpoints for escalation management

**Success Criteria:**
- Ambiguous situations trigger escalations
- Questions have clear options with implications
- Affected tasks pause automatically
- Resolution resumes tasks with injected context

### Phase 5: UI Integration

**Goal:** Users can see and interact with HOMЯ.

**Deliverables:**
- [ ] `HomrStatusCard` component
- [ ] `EscalationAlert` component
- [ ] `ActivityLogDrawer` component
- [ ] Outcome page integration
- [ ] Notification for escalations

**Success Criteria:**
- HOMЯ status visible on outcome page
- Escalations prompt user for input
- Activity log shows full history
- Users report confidence in system coordination

---

## Configuration

### Outcome-Level Settings

```typescript
interface HomrConfig {
  enabled: boolean;

  // Observation settings
  observeAfterEveryTask: boolean;
  observationModel: 'haiku' | 'sonnet';  // Claude model for analysis

  // Steering settings
  autoCreateCorrectiveTasks: boolean;
  autoAdjustPriority: boolean;
  maxSteeringActionsPerTask: number;

  // Escalation settings
  autoEscalate: boolean;
  escalationThreshold: 'low' | 'medium' | 'high';  // How uncertain before escalating
  pauseOnEscalation: boolean;

  // Context settings
  maxDiscoveries: number;
  contextCompactionThreshold: number;
}

const DEFAULT_HOMR_CONFIG: HomrConfig = {
  enabled: true,
  observeAfterEveryTask: true,
  observationModel: 'haiku',
  autoCreateCorrectiveTasks: true,
  autoAdjustPriority: true,
  maxSteeringActionsPerTask: 5,
  autoEscalate: true,
  escalationThreshold: 'medium',
  pauseOnEscalation: true,
  maxDiscoveries: 50,
  contextCompactionThreshold: 100,
};
```

### Global Settings

```typescript
// In settings or environment

HOMR_ENABLED_BY_DEFAULT=true
HOMR_OBSERVATION_MODEL=haiku
HOMR_MAX_CONTEXT_SIZE=50000  // chars
```

---

## File Structure

```
lib/
├── homr/
│   ├── index.ts              # Main exports
│   ├── observer.ts           # Observation logic
│   ├── steerer.ts            # Steering actions
│   ├── escalator.ts          # Escalation management
│   ├── context-store.ts      # Context CRUD
│   ├── prompts.ts            # Claude prompts for analysis
│   └── types.ts              # Type definitions
│
├── db/
│   ├── homr-context.ts       # Context store DB operations
│   ├── homr-observations.ts  # Observations DB operations
│   ├── homr-escalations.ts   # Escalations DB operations
│   └── homr-activity.ts      # Activity log DB operations

app/
├── api/
│   └── outcomes/
│       └── [id]/
│           └── homr/
│               ├── route.ts              # GET status
│               ├── enable/route.ts       # POST enable
│               ├── disable/route.ts      # POST disable
│               ├── context/route.ts      # GET context
│               ├── observations/route.ts # GET observations
│               ├── activity/route.ts     # GET activity
│               └── escalations/
│                   ├── route.ts          # GET list
│                   └── [escId]/
│                       ├── route.ts      # GET details
│                       ├── answer/route.ts   # POST answer
│                       └── dismiss/route.ts  # POST dismiss
│
├── components/
│   └── homr/
│       ├── HomrStatusCard.tsx
│       ├── EscalationAlert.tsx
│       ├── ActivityLogDrawer.tsx
│       └── HomrConfigModal.tsx
```

---

## Implementation Status

> **Status: IMPLEMENTED** (2026-01-31)

All core components of the HOMЯ Protocol have been implemented and integrated.

### Implemented Components

| Component | File | Status |
|-----------|------|--------|
| Context Store | `lib/db/homr.ts` | Complete |
| Observer | `lib/homr/observer.ts` | Complete |
| Steerer | `lib/homr/steerer.ts` | Complete |
| Escalator | `lib/homr/escalator.ts` | Complete |
| Type Definitions | `lib/homr/types.ts` | Complete |
| Claude Prompts | `lib/homr/prompts.ts` | Complete |
| Main Module | `lib/homr/index.ts` | Complete |

### API Endpoints

| Endpoint | Status |
|----------|--------|
| `GET /api/outcomes/[id]/homr` | Complete |
| `GET /api/outcomes/[id]/homr/context` | Complete |
| `GET /api/outcomes/[id]/homr/observations` | Complete |
| `GET /api/outcomes/[id]/homr/activity` | Complete |
| `GET /api/outcomes/[id]/homr/escalations` | Complete |
| `POST /api/outcomes/[id]/homr/escalations/[escId]/answer` | Complete |

### UI Components

| Component | Status |
|-----------|--------|
| `HomrStatusCard` | Complete |
| `EscalationAlert` | Complete |
| `ActivityLogDrawer` | Complete |
| `HomrConfigModal` | Not implemented (future) |

### Integration Points

| Integration | Status |
|-------------|--------|
| Ralph worker task completion hook | Complete |
| HOMЯ context injection into CLAUDE.md | Complete |
| Outcome detail page integration | Complete |
| Failure pattern detection | Complete |
| Automatic worker pausing on failure patterns | Complete |

### Failure Pattern Detection

HOMЯ now detects when Ralph is stuck in a failure loop:

**Patterns Detected:**
- `consecutive_failures` - 3+ tasks fail in a row (default threshold)
- `declining_quality` - Quality scores trending downward
- `repeated_drift` - Same drift type occurring across multiple tasks

**Response:**
1. Creates an escalation with options: Pause, Continue with guidance, or Skip failing tasks
2. Automatically pauses all active workers for the outcome
3. Logs the pattern detection in activity log

**Configuration:**
```typescript
interface FailurePatternConfig {
  lookbackCount?: number;              // Default: 5 observations
  consecutiveFailureThreshold?: number; // Default: 3 failures
  healthyAlignmentThreshold?: number;   // Default: 50 alignment score
}
```

### Not Yet Implemented

- `HomrConfigModal` - Per-outcome HOMЯ settings UI
- Enable/disable API endpoints
- Telegram notifications for escalations
- Cross-outcome learning

---

## Change Log

| Date | Change | Rationale |
|------|--------|-----------|
| 2026-01-31 | Initial design document | Capture HOMЯ Protocol architecture |
| 2026-01-31 | Full implementation complete | Phases 1-4 implemented |
| 2026-01-31 | Failure pattern detection | Make HOMЯ detect stuck/failing loops and auto-pause workers |

---

*This document specifies the technical implementation of The HOMЯ Protocol. For vision and philosophy, see [VISION.md](./VISION.md).*
