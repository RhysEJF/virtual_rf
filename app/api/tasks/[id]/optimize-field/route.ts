/**
 * Task Field Optimization API
 *
 * POST /api/tasks/[id]/optimize-field
 * Optimizes a single field (intent or approach) content
 * Also detects skill references and updates required_skills
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, updateTask } from '@/lib/db/tasks';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getAllSkills } from '@/lib/db/skills';
import { complete } from '@/lib/claude/client';

const OPTIMIZE_INTENT_PROMPT = `You are helping structure the "WHAT" (intent) for a task.

The user has written their thoughts about what this task should achieve. Polish and structure it into clear, actionable requirements. Keep it concise but complete.

TASK: {title}
CONTEXT: {outcomeContext}

USER'S INPUT:
{content}

---

Return ONLY the optimized text (no JSON, no explanation, just the polished content). Keep it under 200 words.`;

const OPTIMIZE_APPROACH_PROMPT = `You are helping structure the "HOW" (approach) for a task.

The user has written their thoughts about how this task should be done. Polish and structure it into clear methodology, tools, patterns, or constraints. Keep it concise but actionable.

TASK: {title}
CONTEXT: {outcomeContext}

USER'S INPUT:
{content}

---

Return ONLY the optimized text (no JSON, no explanation, just the polished content). Keep it under 200 words.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const { field, content } = body;

    if (!field || !['intent', 'approach'].includes(field)) {
      return NextResponse.json(
        { error: 'Field must be "intent" or "approach"' },
        { status: 400 }
      );
    }

    if (!content?.trim()) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    // Get task
    const task = getTaskById(id);
    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Get outcome for context
    const outcome = getOutcomeById(task.outcome_id);
    const outcomeContext = outcome
      ? `${outcome.name}: ${outcome.brief || 'No description'}`
      : 'No outcome context';

    // Build prompt based on field
    const promptTemplate = field === 'intent'
      ? OPTIMIZE_INTENT_PROMPT
      : OPTIMIZE_APPROACH_PROMPT;

    const prompt = promptTemplate
      .replace('{title}', task.title)
      .replace('{outcomeContext}', outcomeContext)
      .replace('{content}', content);

    // Run Claude
    const result = await complete({
      prompt,
      description: `Optimize task ${field} for: ${task.title}`,
    });

    if (!result.success || !result.text) {
      return NextResponse.json(
        { error: result.error || 'Failed to optimize' },
        { status: 500 }
      );
    }

    const optimizedText = result.text.trim();

    // Detect skill references in the optimized content
    const detectedSkills = detectSkillReferences(optimizedText, content);

    // If skills were detected, update the task's required_skills
    if (detectedSkills.length > 0) {
      // Get existing skills
      let existingSkills: string[] = [];
      if (task.required_skills) {
        try {
          existingSkills = JSON.parse(task.required_skills);
        } catch {
          existingSkills = [];
        }
      }

      // Merge with detected skills (deduplicate)
      const allSkills = Array.from(new Set([...existingSkills, ...detectedSkills]));

      // Update the task
      updateTask(id, {
        required_skills: JSON.stringify(allSkills),
      });
    }

    // Return the optimized text
    return NextResponse.json({
      success: true,
      optimized: optimizedText,
      detectedSkills: detectedSkills.length > 0 ? detectedSkills : undefined,
    });
  } catch (error) {
    console.error('Error optimizing task field:', error);
    return NextResponse.json(
      { error: 'Failed to optimize task field' },
      { status: 500 }
    );
  }
}

/**
 * Detect skill references in text
 * Looks for mentions of existing skills and common skill patterns
 */
function detectSkillReferences(optimizedText: string, originalText: string): string[] {
  const combinedText = `${optimizedText} ${originalText}`.toLowerCase();
  const detectedSkills: string[] = [];

  // Get all existing skills
  const allSkills = getAllSkills();

  // Check for mentions of existing skills
  for (const skill of allSkills) {
    const skillNameLower = skill.name.toLowerCase();
    // Check if skill name appears in text
    if (combinedText.includes(skillNameLower)) {
      detectedSkills.push(skill.name);
      continue;
    }

    // Check for partial matches (e.g., "perplexity" for "Perplexity API")
    const words = skillNameLower.split(/[\s-_]+/);
    for (const word of words) {
      if (word.length > 4 && combinedText.includes(word)) {
        detectedSkills.push(skill.name);
        break;
      }
    }
  }

  // Detect common tool/API patterns that might need skills
  const toolPatterns = [
    { pattern: /\b(perplexity|perplexity\s*api)\b/i, skill: 'Perplexity API' },
    { pattern: /\b(tavily|tavily\s*api)\b/i, skill: 'Tavily Search' },
    { pattern: /\b(firecrawl)\b/i, skill: 'Firecrawl' },
    { pattern: /\b(exa|exa\s*api)\b/i, skill: 'Exa Search' },
    { pattern: /\b(serp|serp\s*api|serpapi)\b/i, skill: 'SerpAPI' },
    { pattern: /\b(browserbase)\b/i, skill: 'Browserbase' },
    { pattern: /\b(github\s*api|octokit)\b/i, skill: 'GitHub API' },
    { pattern: /\b(web\s*scraping|scrape)\b/i, skill: 'Web Scraping' },
    { pattern: /\b(research|deep\s*research)\b/i, skill: 'Research' },
  ];

  for (const { pattern, skill } of toolPatterns) {
    if (pattern.test(combinedText) && !detectedSkills.includes(skill)) {
      // Only add if an existing skill with similar name exists, or mark as potential new skill
      const existingSkill = allSkills.find(
        s => s.name.toLowerCase().includes(skill.toLowerCase().split(' ')[0])
      );
      if (existingSkill) {
        detectedSkills.push(existingSkill.name);
      } else {
        // Add as a potential skill to be built
        detectedSkills.push(skill);
      }
    }
  }

  return Array.from(new Set(detectedSkills));
}
