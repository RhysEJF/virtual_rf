/**
 * Converse Agent Tool Registry
 *
 * Defines all tools available to the conversational agent.
 * Each tool has a name, description, and parameter schema.
 */

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  items?: { type: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

/**
 * All tools available to the converse agent.
 * Organized by category for clarity.
 */
export const converseTools: ToolDefinition[] = [
  // =========================================================================
  // Status Tools
  // =========================================================================
  {
    name: 'getSystemStatus',
    description:
      'Get overall system health including worker counts, active outcomes, pending escalations, and alerts. Use when the user asks "what\'s running?", "status", or "what\'s happening?"',
    parameters: {},
  },
  {
    name: 'getActiveOutcomes',
    description:
      'Get all outcomes with status="active" along with their task/worker counts. Use when user asks for "active outcomes", "what\'s being worked on", or "show active projects".',
    parameters: {},
  },
  {
    name: 'getAllOutcomes',
    description:
      'Get all outcomes with optional status filter. Use for "show all outcomes", "list projects", "my outcomes". Can filter by status.',
    parameters: {
      status: {
        type: 'string',
        description: 'Optional status filter',
        required: false,
        enum: ['active', 'dormant', 'achieved', 'archived'],
      },
    },
  },

  // =========================================================================
  // Outcome Tools
  // =========================================================================
  {
    name: 'getOutcome',
    description:
      'Get details of a specific outcome by ID or name (fuzzy match). Use when user refers to a specific outcome like "show me the landing page project" or "details of out_xxx".',
    parameters: {
      identifier: {
        type: 'string',
        description: 'Outcome ID (out_xxx) or name to search for',
        required: true,
      },
    },
  },
  {
    name: 'getOutcomeTasks',
    description:
      'Get tasks for an outcome with optional status filter. Use for "show tasks", "what tasks are pending", "task list for X".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID',
        required: true,
      },
      status: {
        type: 'string',
        description: 'Optional status filter',
        required: false,
        enum: ['pending', 'claimed', 'running', 'completed', 'failed'],
      },
    },
  },
  {
    name: 'getOutcomeWorkers',
    description:
      'Get workers for an outcome. Use for "show workers", "who is working on X", "worker status for outcome".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID',
        required: true,
      },
    },
  },
  {
    name: 'createOutcome',
    description:
      'Create a new outcome from a description. Use when user wants to start something new like "create a landing page", "build a todo app", "I need a dashboard".',
    parameters: {
      description: {
        type: 'string',
        description: 'Description of what the user wants to achieve',
        required: true,
      },
    },
  },
  {
    name: 'iterateOnOutcome',
    description:
      'Add feedback or change requests to an outcome, creating new tasks. Use for "the button should be blue", "add validation", "fix the header".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID to iterate on',
        required: true,
      },
      feedback: {
        type: 'string',
        description: 'The feedback or change request',
        required: true,
      },
      start_worker: {
        type: 'boolean',
        description: 'Whether to start a worker after creating tasks',
        required: false,
      },
    },
  },

  // =========================================================================
  // Worker Tools
  // =========================================================================
  {
    name: 'getActiveWorkers',
    description:
      'Get all currently running workers across all outcomes. Use for "what workers are running", "active workers", "who is working".',
    parameters: {},
  },
  {
    name: 'startWorker',
    description:
      'Start a worker for an outcome. Use for "start working", "begin", "run worker", "execute tasks".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID to start a worker for',
        required: true,
      },
    },
  },
  {
    name: 'stopWorker',
    description:
      'Stop a worker by worker ID or all workers for an outcome. Use for "stop", "halt", "pause work", "stop the worker".',
    parameters: {
      worker_id: {
        type: 'string',
        description: 'Specific worker ID to stop',
        required: false,
      },
      outcome_id: {
        type: 'string',
        description: 'Outcome ID to stop all workers for',
        required: false,
      },
    },
  },

  // =========================================================================
  // Escalation Tools
  // =========================================================================
  {
    name: 'getPendingEscalations',
    description:
      'Get pending escalations (questions) that need human answers. Use for "any questions?", "pending escalations", "what needs my attention".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Optional outcome ID to filter by',
        required: false,
      },
    },
  },
  {
    name: 'answerEscalation',
    description:
      'Answer a pending escalation by selecting an option. Use when user provides an answer to a question.',
    parameters: {
      escalation_id: {
        type: 'string',
        description: 'The escalation ID to answer',
        required: true,
      },
      selected_option: {
        type: 'string',
        description: 'The selected option ID from the escalation options',
        required: true,
      },
      additional_context: {
        type: 'string',
        description: 'Optional additional context from the user',
        required: false,
      },
    },
  },

  // =========================================================================
  // Task Tools
  // =========================================================================
  {
    name: 'getTask',
    description:
      'Get details of a specific task by ID. Use for "show task X", "task details", "what is task_xxx".',
    parameters: {
      task_id: {
        type: 'string',
        description: 'Task ID',
        required: true,
      },
    },
  },
  {
    name: 'addTask',
    description:
      'Create a new task for an outcome. Use for "add a task to...", "create task", "new task for X".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID to add the task to',
        required: true,
      },
      title: {
        type: 'string',
        description: 'Task title',
        required: true,
      },
      description: {
        type: 'string',
        description: 'Task description',
        required: false,
      },
      priority: {
        type: 'number',
        description: 'Priority (lower = higher priority, default 100)',
        required: false,
      },
    },
  },
  {
    name: 'updateTask',
    description:
      'Update a task with additional context or details. Use for "optimize task", "add context to task", "update task with PRD", "enrich task".',
    parameters: {
      task_id: {
        type: 'string',
        description: 'Task ID to update',
        required: true,
      },
      prd_context: {
        type: 'string',
        description: 'PRD context - the WHAT: product goals, user needs, success criteria',
        required: false,
      },
      design_context: {
        type: 'string',
        description: 'Design context - the HOW: technical approach, patterns, file structure',
        required: false,
      },
      task_intent: {
        type: 'string',
        description: 'Clarified intent of what the task should accomplish',
        required: false,
      },
      task_approach: {
        type: 'string',
        description: 'Specific approach or steps to complete the task',
        required: false,
      },
      title: {
        type: 'string',
        description: 'Updated task title',
        required: false,
      },
      description: {
        type: 'string',
        description: 'Updated task description',
        required: false,
      },
      priority: {
        type: 'number',
        description: 'Updated priority (lower = higher priority)',
        required: false,
      },
    },
  },
  {
    name: 'findTask',
    description:
      'Search for tasks by title or description. Returns all matching tasks with full context. Use when user refers to a task by name/description rather than ID, like "show me the sharing task" or "find the task about validation".',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query to match against task title and description',
        required: true,
      },
      outcome_id: {
        type: 'string',
        description: 'Optional outcome ID to limit search scope',
        required: false,
      },
    },
  },

  // =========================================================================
  // Worker Details Tools
  // =========================================================================
  {
    name: 'getWorkerDetails',
    description:
      'Get detailed information about a specific worker including current task, progress, and status. Use for "what is worker X doing?", "worker details", "show me worker wrk_xxx".',
    parameters: {
      worker_id: {
        type: 'string',
        description: 'Worker ID (wrk_xxx)',
        required: true,
      },
    },
  },
  {
    name: 'getWorkerProgress',
    description:
      'Get recent progress/log entries for a worker showing what it has been doing. Use for "worker logs", "what has the worker done?", "show progress for worker".',
    parameters: {
      worker_id: {
        type: 'string',
        description: 'Worker ID (wrk_xxx)',
        required: true,
      },
    },
  },

  // =========================================================================
  // HOMR Tools (Intelligent Orchestration)
  // =========================================================================
  {
    name: 'getHomrStatus',
    description:
      'Get HOMR status for an outcome including observations, escalations count, and auto-resolve settings. Use for "show homr", "homr status", "display homr for X".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID',
        required: true,
      },
    },
  },
  {
    name: 'getHomrDashboard',
    description:
      'Get a combined HOMR dashboard view with pending escalations, recent observations, and summary stats. Use for "homr dashboard", "show me the homr view".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID',
        required: true,
      },
    },
  },
  {
    name: 'runAutoResolve',
    description:
      'Run auto-resolve on pending escalations for an outcome. The AI will try to answer questions automatically. Use for "enable auto-resolve", "auto answer escalations", "yolo mode".',
    parameters: {
      outcome_id: {
        type: 'string',
        description: 'Outcome ID',
        required: true,
      },
    },
  },
];

/**
 * Get tool names as an array for Claude CLI --allowedTools
 */
export function getToolNames(): string[] {
  return converseTools.map((t) => t.name);
}

/**
 * Get a specific tool definition by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return converseTools.find((t) => t.name === name);
}

/**
 * Format tools for Claude system prompt
 */
export function formatToolsForPrompt(): string {
  return converseTools
    .map((tool) => {
      const params = Object.entries(tool.parameters)
        .map(([name, param]) => {
          const required = param.required ? ' (required)' : '';
          const enumVals = param.enum ? ` [${param.enum.join(', ')}]` : '';
          return `    - ${name}: ${param.type}${required}${enumVals} - ${param.description}`;
        })
        .join('\n');

      return `## ${tool.name}\n${tool.description}\n${params ? `Parameters:\n${params}` : 'No parameters'}`;
    })
    .join('\n\n');
}
