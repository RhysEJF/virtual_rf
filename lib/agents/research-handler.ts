/**
 * Research Handler
 *
 * Handles research-type requests by creating a research outcome and tasks.
 * Research is lighter than "deep" work - focused on gathering information
 * and producing a report rather than building something.
 */

import { complete } from '../claude/client';
import { createOutcome } from '../db/outcomes';
import { createTask } from '../db/tasks';
import { logOutcomeCreated, logWorkerStarted } from '../db/activity';
import { startRalphWorker } from '../ralph/worker';

interface ResearchQuestion {
  id: string;
  question: string;
  priority: number;
  sources?: string[];
}

interface ResearchPlan {
  title: string;
  objective: string;
  questions: ResearchQuestion[];
  suggestedSources: string[];
  outputFormat: string;
  estimatedMinutes: number;
}

const RESEARCH_PLANNER_PROMPT = `You are a research planner. Transform this research request into a structured research plan.

Create a focused research plan with specific questions to answer.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "title": "Short research title",
  "objective": "What we're trying to learn or understand",
  "questions": [
    {
      "id": "1",
      "question": "Specific question to answer",
      "priority": 1,
      "sources": ["Where to look for answers"]
    }
  ],
  "suggestedSources": ["General sources to check"],
  "outputFormat": "How the research should be presented (e.g., 'summary report', 'comparison table', 'list of findings')",
  "estimatedMinutes": 20
}

Guidelines:
- Break down into 3-6 specific, answerable questions
- Order questions by importance (priority 1 = most important)
- Suggest practical sources (web search, documentation, repos, etc.)
- Keep scope manageable for a single research session

Research request:
`;

/**
 * Plan research tasks from a user request
 */
export async function planResearch(request: string): Promise<ResearchPlan | null> {
  const result = await complete({
    prompt: `${RESEARCH_PLANNER_PROMPT}"${request}"`,
    timeout: 120000,
  });

  if (!result.success) {
    console.error('[Research] Failed to plan research:', result.error);
    return null;
  }

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Research] No JSON found in response. Response was:', result.text.substring(0, 200));
      // Fall back to creating a simple plan from the request
      return createFallbackPlan(request);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize the plan
    const plan: ResearchPlan = {
      title: parsed.title || 'Research Task',
      objective: parsed.objective || request,
      questions: normalizeQuestions(parsed.questions),
      suggestedSources: Array.isArray(parsed.suggestedSources) ? parsed.suggestedSources : [],
      outputFormat: parsed.outputFormat || 'summary report',
      estimatedMinutes: typeof parsed.estimatedMinutes === 'number' ? parsed.estimatedMinutes : 20,
    };

    return plan;
  } catch (error) {
    console.error('[Research] Failed to parse research plan:', error);
    console.error('[Research] Response was:', result.text.substring(0, 200));
    // Fall back to creating a simple plan from the request
    return createFallbackPlan(request);
  }
}

function normalizeQuestions(questions: unknown): ResearchQuestion[] {
  if (!Array.isArray(questions)) return [];

  return questions.map((q, index) => ({
    id: String(q?.id || index + 1),
    question: String(q?.question || `Question ${index + 1}`),
    priority: typeof q?.priority === 'number' ? q.priority : index + 1,
    sources: Array.isArray(q?.sources) ? q.sources : undefined,
  }));
}

/**
 * Create a simple fallback plan when Claude doesn't return proper JSON
 */
function createFallbackPlan(request: string): ResearchPlan {
  // Extract a simple title from the request
  const words = request.split(' ').slice(0, 5).join(' ');
  const title = words.length > 40 ? words.substring(0, 40) + '...' : words;

  return {
    title: `Research: ${title}`,
    objective: request,
    questions: [
      {
        id: '1',
        question: `What are the key facts about: ${request}?`,
        priority: 1,
        sources: ['web search'],
      },
      {
        id: '2',
        question: 'What are the main findings and insights?',
        priority: 2,
        sources: ['analysis'],
      },
      {
        id: '3',
        question: 'What conclusions can be drawn?',
        priority: 3,
        sources: ['synthesis'],
      },
    ],
    suggestedSources: ['Web search', 'Documentation', 'Existing files'],
    outputFormat: 'summary report',
    estimatedMinutes: 15,
  };
}

/**
 * Execute a research request
 * Creates an outcome with research tasks and optionally starts a worker
 */
export async function executeResearch(request: string, autoStart: boolean = true): Promise<{
  success: boolean;
  outcomeId?: string;
  plan?: ResearchPlan;
  workerStarted?: boolean;
  error?: string;
}> {
  // Plan the research
  const plan = await planResearch(request);

  if (!plan) {
    return {
      success: false,
      error: 'Failed to plan research',
    };
  }

  // Create outcome for research
  const outcome = createOutcome({
    name: plan.title,
    brief: request,
    intent: JSON.stringify({
      summary: plan.objective,
      type: 'research',
      questions: plan.questions,
      outputFormat: plan.outputFormat,
      suggestedSources: plan.suggestedSources,
    }),
  });

  const outcomeId = outcome.id;

  // Log activity
  logOutcomeCreated(outcomeId, plan.title);

  // Create tasks for each research question
  for (const question of plan.questions) {
    createTask({
      outcome_id: outcomeId,
      title: `Research: ${question.question}`,
      description: `Find the answer to: ${question.question}\n\nSuggested sources: ${question.sources?.join(', ') || 'Web search, documentation'}`,
      prd_context: JSON.stringify({
        type: 'research_question',
        question: question.question,
        sources: question.sources,
      }),
      priority: question.priority * 10,
    });
  }

  // Create a final synthesis task
  createTask({
    outcome_id: outcomeId,
    title: `Compile research findings into ${plan.outputFormat}`,
    description: `Synthesize all research findings into the requested format: ${plan.outputFormat}\n\nObjective: ${plan.objective}`,
    prd_context: JSON.stringify({
      type: 'research_synthesis',
      outputFormat: plan.outputFormat,
    }),
    priority: 100, // Lower priority = do last
  });

  let workerStarted = false;

  // Optionally start the research worker
  if (autoStart) {
    try {
      const workerResult = await startRalphWorker({
        outcomeId,
      });

      if (workerResult.started) {
        logWorkerStarted(outcomeId, plan.title, `Ralph Worker ${workerResult.workerId?.slice(-12)}`, workerResult.workerId || '');
        workerStarted = true;
      }
    } catch (err) {
      console.error('[Research] Failed to start worker:', err);
    }
  }

  return {
    success: true,
    outcomeId,
    plan,
    workerStarted,
  };
}

/**
 * Format research plan for display
 */
export function formatResearchPlan(plan: ResearchPlan): string {
  const questionsList = plan.questions
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join('\n');

  return `**Research: ${plan.title}**

**Objective:** ${plan.objective}

**Questions to answer:**
${questionsList}

**Suggested sources:** ${plan.suggestedSources.join(', ')}

**Output format:** ${plan.outputFormat}

**Estimated time:** ~${plan.estimatedMinutes} minutes`;
}
