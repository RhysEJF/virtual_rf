/**
 * Briefer Agent
 *
 * Transforms a user request into an actionable project brief and PRD.
 * Uses Claude Code CLI (your existing subscription).
 */

import { complete } from '../claude/client';
import { createProject } from '../db/projects';
import { generateProjectId } from '../utils/id';

export interface PRDItem {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: number; // 1 = highest
}

export interface Brief {
  id: string;
  title: string;
  objective: string;
  scope: string[];
  outOfScope: string[];
  deliverables: string[];
  prd: PRDItem[];
  estimatedMinutes: number;
}

const BRIEFER_PROMPT = `You are a project briefer. Transform this request into an actionable project brief.

Create a focused, minimal scope that can be completed in a single work session.
Break down the work into small, concrete tasks (PRD items).

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "title": "Short project title",
  "objective": "One sentence describing the goal",
  "scope": ["What IS included - be specific"],
  "outOfScope": ["What is NOT included - set boundaries"],
  "deliverables": ["Concrete outputs that will be created"],
  "prd": [
    {
      "id": "1",
      "title": "Task title",
      "description": "What to do",
      "status": "pending",
      "priority": 1
    }
  ],
  "estimatedMinutes": 30
}

Guidelines:
- Keep scope SMALL and achievable
- PRD items should be concrete actions (create file, implement function, etc.)
- Each PRD item should be completable in 5-15 minutes
- Order PRD items by dependency (what must come first)
- Aim for 3-8 PRD items total

Request to brief:
`;

/**
 * Generate a project brief from a user request
 */
export async function generateBrief(request: string): Promise<Brief | null> {
  const result = await complete({
    prompt: `${BRIEFER_PROMPT}"${request}"`,
    timeout: 180000, // 3 minutes - briefing takes longer
  });

  if (!result.success) {
    console.error('[Briefer] Failed to generate brief:', result.error);
    return null;
  }

  try {
    // Parse JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the brief
    const brief: Brief = {
      id: generateProjectId(),
      title: parsed.title || 'Untitled Project',
      objective: parsed.objective || request,
      scope: Array.isArray(parsed.scope) ? parsed.scope : [],
      outOfScope: Array.isArray(parsed.outOfScope) ? parsed.outOfScope : [],
      deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
      prd: normalizePRD(parsed.prd),
      estimatedMinutes: typeof parsed.estimatedMinutes === 'number' ? parsed.estimatedMinutes : 30,
    };

    return brief;
  } catch (error) {
    console.error('[Briefer] Failed to parse brief:', error);
    return null;
  }
}

/**
 * Normalize PRD items to ensure valid structure
 */
function normalizePRD(prd: unknown): PRDItem[] {
  if (!Array.isArray(prd)) return [];

  return prd.map((item, index) => ({
    id: String(item?.id || index + 1),
    title: String(item?.title || `Task ${index + 1}`),
    description: String(item?.description || ''),
    status: 'pending' as const,
    priority: typeof item?.priority === 'number' ? item.priority : index + 1,
  }));
}

/**
 * Create a project from a brief and save to database
 */
export function createProjectFromBrief(brief: Brief): string {
  // Use the existing createProject which auto-generates ID
  // Note: PRD is stored as JSON string, so our simple format works
  const project = createProject({
    name: brief.title,
    brief: brief.objective,
    prd: brief.prd as unknown as import('../db/schema').PRD, // Cast for type compat
  });

  // Update the brief's ID to match the created project
  brief.id = project.id;

  return project.id;
}

/**
 * Full briefing flow: generate brief and create project
 */
export async function briefAndCreateProject(request: string): Promise<{
  success: boolean;
  brief?: Brief;
  projectId?: string;
  error?: string;
}> {
  // Generate the brief
  const brief = await generateBrief(request);

  if (!brief) {
    return {
      success: false,
      error: 'Failed to generate project brief',
    };
  }

  // Create project in database
  try {
    const projectId = await createProjectFromBrief(brief);

    return {
      success: true,
      brief,
      projectId,
    };
  } catch (error) {
    return {
      success: false,
      brief,
      error: error instanceof Error ? error.message : 'Failed to create project',
    };
  }
}
