/**
 * Intent Classifier Agent
 *
 * Classifies user messages into intents for the conversational API.
 * Maps natural language input to system actions like creating outcomes,
 * checking status, starting workers, answering escalations, etc.
 *
 * Uses Claude Code CLI (your existing subscription).
 */

import { complete } from '../claude/client';

// ============================================================================
// Types
// ============================================================================

export type IntentType =
  | 'create_outcome'      // User wants to create a new outcome/project
  | 'check_status'        // User wants to check overall system status
  | 'list_outcomes'       // User wants to see all outcomes
  | 'show_outcome'        // User wants details about a specific outcome
  | 'list_tasks'          // User wants to see tasks (for an outcome)
  | 'start_worker'        // User wants to start a worker
  | 'stop_worker'         // User wants to stop a worker
  | 'pause_worker'        // User wants to pause a worker
  | 'answer_escalation'   // User is answering an escalation question
  | 'show_escalations'    // User wants to see pending escalations
  | 'iterate'             // User wants to iterate/provide feedback on completed work
  | 'help'                // User wants help with the system
  | 'general_query';      // General question or conversation

export interface ExtractedEntities {
  outcome_id?: string;      // Extracted outcome ID (e.g., "out_abc123")
  outcome_name?: string;    // Outcome name/reference mentioned
  worker_id?: string;       // Extracted worker ID
  task_id?: string;         // Extracted task ID
  escalation_id?: string;   // Extracted escalation ID
  answer?: string;          // Answer to an escalation
  description?: string;     // Description for create/iterate
  query?: string;           // The actual query/question
}

export interface IntentClassification {
  type: IntentType;
  confidence: number;       // 0.0 - 1.0
  entities: ExtractedEntities;
  reasoning?: string;       // Why this classification was chosen
}

// ============================================================================
// Classification Prompt
// ============================================================================

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for a personal AI workforce management system called "Digital Twin".

The system manages "outcomes" (projects with tasks) executed by AI "workers".

Classify the user's message into ONE of these intents:

INTENTS:
1. create_outcome - User wants to create a new project/outcome (e.g., "build a landing page", "create a CLI tool")
2. check_status - User wants overall system status (e.g., "what's happening?", "status?", "how are things going?")
3. list_outcomes - User wants to see all outcomes (e.g., "show me my projects", "list outcomes", "what am I working on?")
4. show_outcome - User wants details about a specific outcome (e.g., "show outcome X", "what's the status of my landing page?")
5. list_tasks - User wants to see tasks (e.g., "show tasks for outcome X", "what tasks are pending?")
6. start_worker - User wants to start/run a worker (e.g., "start working on X", "run the worker", "begin execution")
7. stop_worker - User wants to stop a worker (e.g., "stop the worker", "halt work on X")
8. pause_worker - User wants to pause a worker (e.g., "pause work", "hold on")
9. answer_escalation - User is answering a question/escalation (e.g., "use React for the frontend", direct answers to questions)
10. show_escalations - User wants to see pending escalations (e.g., "any questions?", "what needs my input?", "show escalations")
11. iterate - User wants to provide feedback/changes on completed work (e.g., "the button should be blue", "add validation")
12. help - User wants help with the system (e.g., "help", "how do I use this?", "what can you do?")
13. general_query - General questions or conversation (e.g., "what time is it?", "explain X")

Extract any entities mentioned:
- outcome_id: IDs like "out_abc123" or outcome names
- worker_id: IDs like "worker_abc123"
- task_id: IDs like "task_abc123"
- escalation_id: IDs like "esc_abc123"
- answer: If answering an escalation, the actual answer
- description: Project description or iteration feedback
- query: The core question/query if general

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "type": "intent_type",
  "confidence": 0.0-1.0,
  "entities": {
    "outcome_id": "if mentioned",
    "outcome_name": "if mentioned",
    "worker_id": "if mentioned",
    "task_id": "if mentioned",
    "escalation_id": "if mentioned",
    "answer": "if answering something",
    "description": "if creating/iterating",
    "query": "if general query"
  },
  "reasoning": "brief explanation"
}

CONTEXT HINT: If the user seems to be responding to a previous question from the system, classify as "answer_escalation".

User message to classify:
`;

// ============================================================================
// Classification Function
// ============================================================================

/**
 * Classify a user message into an intent with extracted entities.
 *
 * @param message - The user's natural language message
 * @param context - Optional context about the current state (e.g., pending escalations)
 * @returns Classification result with intent type, confidence, and entities
 */
export async function classifyIntent(
  message: string,
  context?: {
    hasActiveOutcome?: boolean;
    activeOutcomeId?: string;
    hasPendingEscalations?: boolean;
    lastEscalationQuestion?: string;
  }
): Promise<IntentClassification> {
  // Build context hint if available
  let contextHint = '';
  if (context?.hasActiveOutcome && context.activeOutcomeId) {
    contextHint += `\nCONTEXT: Currently viewing outcome ${context.activeOutcomeId}`;
  }
  if (context?.hasPendingEscalations) {
    contextHint += `\nCONTEXT: There are pending escalations requiring user input.`;
    if (context.lastEscalationQuestion) {
      contextHint += `\nLast escalation question: "${context.lastEscalationQuestion}"`;
    }
  }

  const fullPrompt = `${INTENT_CLASSIFICATION_PROMPT}${contextHint}\n\n"${message}"`;

  const result = await complete({
    prompt: fullPrompt,
    timeout: 30000, // 30 seconds - classification should be fast
    maxTurns: 1,    // Single turn, no tools needed
    description: 'Intent classification',
  });

  if (!result.success) {
    // Fallback to heuristic classification
    return classifyIntentHeuristically(message);
  }

  try {
    // Parse JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the result
    return normalizeClassification(parsed, message);
  } catch (error) {
    console.error('[IntentClassifier] Failed to parse response:', error);
    // Fallback to heuristic classification
    return classifyIntentHeuristically(message);
  }
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize and validate the classification result from Claude.
 */
function normalizeClassification(
  parsed: Record<string, unknown>,
  originalMessage: string
): IntentClassification {
  const validTypes: IntentType[] = [
    'create_outcome', 'check_status', 'list_outcomes', 'show_outcome',
    'list_tasks', 'start_worker', 'stop_worker', 'pause_worker',
    'answer_escalation', 'show_escalations', 'iterate', 'help', 'general_query'
  ];

  // Validate type
  let type: IntentType = 'general_query';
  if (typeof parsed.type === 'string' && validTypes.includes(parsed.type as IntentType)) {
    type = parsed.type as IntentType;
  }

  // Validate confidence
  let confidence = 0.5;
  if (typeof parsed.confidence === 'number') {
    confidence = Math.min(1, Math.max(0, parsed.confidence));
  }

  // Extract entities
  const rawEntities = (parsed.entities || {}) as Record<string, unknown>;
  const entities: ExtractedEntities = {};

  if (typeof rawEntities.outcome_id === 'string' && rawEntities.outcome_id) {
    entities.outcome_id = rawEntities.outcome_id;
  }
  if (typeof rawEntities.outcome_name === 'string' && rawEntities.outcome_name) {
    entities.outcome_name = rawEntities.outcome_name;
  }
  if (typeof rawEntities.worker_id === 'string' && rawEntities.worker_id) {
    entities.worker_id = rawEntities.worker_id;
  }
  if (typeof rawEntities.task_id === 'string' && rawEntities.task_id) {
    entities.task_id = rawEntities.task_id;
  }
  if (typeof rawEntities.escalation_id === 'string' && rawEntities.escalation_id) {
    entities.escalation_id = rawEntities.escalation_id;
  }
  if (typeof rawEntities.answer === 'string' && rawEntities.answer) {
    entities.answer = rawEntities.answer;
  }
  if (typeof rawEntities.description === 'string' && rawEntities.description) {
    entities.description = rawEntities.description;
  }
  if (typeof rawEntities.query === 'string' && rawEntities.query) {
    entities.query = rawEntities.query;
  }

  // Extract reasoning if present
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;

  return {
    type,
    confidence,
    entities,
    reasoning,
  };
}

// ============================================================================
// Heuristic Fallback
// ============================================================================

/**
 * Fallback heuristic classification when Claude is unavailable.
 * Uses keyword matching and pattern recognition.
 */
function classifyIntentHeuristically(message: string): IntentClassification {
  const lower = message.toLowerCase().trim();
  const entities: ExtractedEntities = {};

  // Extract IDs using regex
  const outcomeIdMatch = message.match(/out_[a-zA-Z0-9]+/);
  if (outcomeIdMatch) entities.outcome_id = outcomeIdMatch[0];

  const workerIdMatch = message.match(/worker_[a-zA-Z0-9]+/);
  if (workerIdMatch) entities.worker_id = workerIdMatch[0];

  const taskIdMatch = message.match(/task_[a-zA-Z0-9]+/);
  if (taskIdMatch) entities.task_id = taskIdMatch[0];

  const escalationIdMatch = message.match(/esc_[a-zA-Z0-9]+/);
  if (escalationIdMatch) entities.escalation_id = escalationIdMatch[0];

  // Help intent
  if (lower === 'help' || lower === '?' || lower.startsWith('how do i') || lower.includes('what can you do')) {
    return { type: 'help', confidence: 0.9, entities };
  }

  // Status check
  if (lower === 'status' || lower === 'status?' || lower.includes("what's happening") ||
      lower.includes('how are things') || lower === 'overview') {
    return { type: 'check_status', confidence: 0.85, entities };
  }

  // List outcomes
  if (lower.includes('list outcomes') || lower.includes('show outcomes') ||
      lower.includes('my projects') || lower.includes('all outcomes') ||
      lower === 'outcomes' || lower === 'projects') {
    return { type: 'list_outcomes', confidence: 0.85, entities };
  }

  // Show escalations
  if (lower.includes('escalation') || lower.includes('any questions') ||
      lower.includes('what needs') || lower.includes('pending questions')) {
    return { type: 'show_escalations', confidence: 0.8, entities };
  }

  // Start worker
  if (lower.includes('start') && (lower.includes('worker') || lower.includes('work'))) {
    return { type: 'start_worker', confidence: 0.8, entities };
  }
  if (lower === 'go' || lower === 'run' || lower === 'execute' || lower === 'begin') {
    return { type: 'start_worker', confidence: 0.7, entities };
  }

  // Stop worker
  if (lower.includes('stop') && (lower.includes('worker') || lower.includes('work'))) {
    return { type: 'stop_worker', confidence: 0.8, entities };
  }
  if (lower === 'stop' || lower === 'halt' || lower === 'abort') {
    return { type: 'stop_worker', confidence: 0.7, entities };
  }

  // Pause worker
  if (lower.includes('pause') || lower.includes('hold on') || lower === 'wait') {
    return { type: 'pause_worker', confidence: 0.8, entities };
  }

  // Show specific outcome
  if ((lower.includes('show') || lower.includes('details') || lower.includes('about')) &&
      (lower.includes('outcome') || lower.includes('project') || entities.outcome_id)) {
    return { type: 'show_outcome', confidence: 0.75, entities };
  }

  // List tasks
  if (lower.includes('task') && (lower.includes('list') || lower.includes('show') || lower.includes('what'))) {
    return { type: 'list_tasks', confidence: 0.75, entities };
  }

  // Iterate - feedback patterns
  if (lower.includes('change') || lower.includes('update') || lower.includes('fix') ||
      lower.includes('should be') || lower.includes('instead') || lower.includes('also add')) {
    entities.description = message;
    return { type: 'iterate', confidence: 0.7, entities };
  }

  // Create outcome - imperative verb patterns
  const createPatterns = [
    /^(build|create|make|develop|implement|design|write|set up|setup)\s/i,
    /^i want (to |a )?/i,
    /^can you (build|create|make)/i,
  ];
  for (const pattern of createPatterns) {
    if (pattern.test(message)) {
      entities.description = message;
      return { type: 'create_outcome', confidence: 0.75, entities };
    }
  }

  // Default to general query
  entities.query = message;
  return {
    type: 'general_query',
    confidence: 0.5,
    entities,
    reasoning: 'Heuristic fallback - no specific intent pattern matched',
  };
}

// ============================================================================
// Batch Classification
// ============================================================================

/**
 * Classify multiple messages in batch (useful for testing or analysis).
 */
export async function classifyIntentBatch(
  messages: string[]
): Promise<IntentClassification[]> {
  const results: IntentClassification[] = [];

  // Process sequentially to avoid overwhelming the CLI
  for (const message of messages) {
    const classification = await classifyIntent(message);
    results.push(classification);
  }

  return results;
}

// ============================================================================
// Intent Validation Helpers
// ============================================================================

/**
 * Check if the classified intent requires an outcome context.
 */
export function requiresOutcomeContext(type: IntentType): boolean {
  return [
    'show_outcome',
    'list_tasks',
    'start_worker',
    'stop_worker',
    'pause_worker',
    'iterate',
  ].includes(type);
}

/**
 * Check if the classified intent requires worker context.
 */
export function requiresWorkerContext(type: IntentType): boolean {
  return [
    'stop_worker',
    'pause_worker',
  ].includes(type);
}

/**
 * Get a human-readable description of the intent.
 */
export function getIntentDescription(type: IntentType): string {
  const descriptions: Record<IntentType, string> = {
    create_outcome: 'Create a new outcome/project',
    check_status: 'Check overall system status',
    list_outcomes: 'List all outcomes',
    show_outcome: 'Show details of a specific outcome',
    list_tasks: 'List tasks for an outcome',
    start_worker: 'Start a worker to execute tasks',
    stop_worker: 'Stop a running worker',
    pause_worker: 'Pause a running worker',
    answer_escalation: 'Answer a pending escalation',
    show_escalations: 'Show pending escalations',
    iterate: 'Provide feedback on completed work',
    help: 'Get help with the system',
    general_query: 'General question or conversation',
  };
  return descriptions[type];
}
