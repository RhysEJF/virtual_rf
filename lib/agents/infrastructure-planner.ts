/**
 * Infrastructure Planner
 *
 * Analyzes an outcome's approach to detect required skills and tools,
 * then creates infrastructure tasks to build them before execution.
 */

import { claudeComplete } from '../claude/client';
import { createTask } from '../db/tasks';
import { updateOutcome } from '../db/outcomes';
import type { Task, Intent, InfraType } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface InfrastructureNeed {
  type: InfraType;
  name: string;
  path: string;              // e.g., 'skills/market-sizing.md' or 'tools/web-scraper.ts'
  description: string;
  specification: string;     // Detailed spec from approach
}

export interface InfrastructurePlan {
  needs: InfrastructureNeed[];
  parallel: boolean;
  hasInfrastructure: boolean;
}

// ============================================================================
// Approach Analysis
// ============================================================================

/**
 * Analyze an approach document for infrastructure requirements.
 * Uses pattern matching and optionally Claude for complex cases.
 */
export async function analyzeApproachForInfrastructure(
  approach: string,
  intent: Intent | null,
  outcomeId: string
): Promise<InfrastructurePlan> {
  const needs: InfrastructureNeed[] = [];

  // Pattern 1: Explicit skills/ directory mentioned
  const skillsMatch = approach.match(/skills\/[\w-]+\.md/gi);
  if (skillsMatch) {
    for (const match of skillsMatch) {
      const name = match.replace('skills/', '').replace('.md', '');
      const spec = extractSpecification(approach, name, 'skill');
      needs.push({
        type: 'skill',
        name: formatName(name),
        path: match,
        description: `Build skill: ${formatName(name)}`,
        specification: spec,
      });
    }
  }

  // Pattern 2: Explicit tools/ directory mentioned
  const toolsMatch = approach.match(/tools\/[\w-]+\.(ts|js)/gi);
  if (toolsMatch) {
    for (const match of toolsMatch) {
      const name = match.replace('tools/', '').replace(/\.(ts|js)$/, '');
      const spec = extractSpecification(approach, name, 'tool');
      needs.push({
        type: 'tool',
        name: formatName(name),
        path: match,
        description: `Build tool: ${formatName(name)}`,
        specification: spec,
      });
    }
  }

  // Pattern 3: Skill document structure mentioned
  const skillDocPattern = /skill[- ]?(?:document|file|md)s?.*?:\s*([\w\s,-]+\.md)/gi;
  let skillDocMatch;
  while ((skillDocMatch = skillDocPattern.exec(approach)) !== null) {
    const files = skillDocMatch[1].split(',').map(f => f.trim());
    for (const file of files) {
      if (file.endsWith('.md') && !needs.some(n => n.path.includes(file))) {
        const name = file.replace('.md', '');
        needs.push({
          type: 'skill',
          name: formatName(name),
          path: `skills/${file}`,
          description: `Build skill: ${formatName(name)}`,
          specification: extractSpecification(approach, name, 'skill'),
        });
      }
    }
  }

  // Pattern 4: Architecture section with skills/tools list
  const archSection = approach.match(/```[\s\S]*?(skills\/|tools\/)[\s\S]*?```/gi);
  if (archSection) {
    for (const section of archSection) {
      const lines = section.split('\n');
      for (const line of lines) {
        if (line.includes('skills/') && line.endsWith('.md')) {
          const match = line.match(/(skills\/[\w-]+\.md)/);
          if (match && !needs.some(n => n.path === match[1])) {
            const name = match[1].replace('skills/', '').replace('.md', '');
            needs.push({
              type: 'skill',
              name: formatName(name),
              path: match[1],
              description: `Build skill: ${formatName(name)}`,
              specification: extractSpecification(approach, name, 'skill'),
            });
          }
        }
        if (line.includes('tools/') && line.match(/\.(ts|js)$/)) {
          const match = line.match(/(tools\/[\w-]+\.(ts|js))/);
          if (match && !needs.some(n => n.path === match[1])) {
            const name = match[1].replace('tools/', '').replace(/\.(ts|js)$/, '');
            needs.push({
              type: 'tool',
              name: formatName(name),
              path: match[1],
              description: `Build tool: ${formatName(name)}`,
              specification: extractSpecification(approach, name, 'tool'),
            });
          }
        }
      }
    }
  }

  // Pattern 5: Natural skill mentions like "**Market Intelligence Skill**" or "1. **Persona Research Skill**:"
  // This catches common ways people write about skills in approaches
  const naturalSkillPatterns = [
    // "**Market Intelligence Skill**" - bold skill names
    /\*\*([\w\s]+)\s+Skill\*\*/gi,
    // "1. **Persona Research Skill**:" - numbered lists with bold
    /^\s*[\d\-\*\.]+\s*\*\*([\w\s]+)\s+Skill\*\*\s*:/gim,
    // "Market Intelligence Skill:" - plain text with colon
    /^\s*[\d\-\*\.]+\s*([\w\s]+)\s+Skill\s*:/gim,
  ];

  for (const pattern of naturalSkillPatterns) {
    let match;
    while ((match = pattern.exec(approach)) !== null) {
      const skillName = match[1].trim();
      // Convert to path format: "Market Intelligence" -> "market-intelligence"
      const pathName = skillName.toLowerCase().replace(/\s+/g, '-');
      const path = `skills/${pathName}.md`;

      // Avoid duplicates
      if (!needs.some(n => n.path === path)) {
        needs.push({
          type: 'skill',
          name: skillName + ' Skill',
          path,
          description: `Build skill: ${skillName} Skill`,
          specification: extractSpecification(approach, skillName, 'skill'),
        });
      }
    }
  }

  // Pattern 6: Keywords indicating skill-based approach (fallback to Claude extraction)
  const skillKeywords = [
    'skill-based',
    'skill-driven',
    'skills-first',
    'skill documents',
    'methodology files',
    'skill files',
  ];
  const hasSkillKeywords = skillKeywords.some(kw =>
    approach.toLowerCase().includes(kw.toLowerCase())
  );

  // If approach mentions skills but we haven't found specific ones, use Claude to extract
  if (hasSkillKeywords && needs.length === 0) {
    const claudeNeeds = await extractNeedsWithClaude(approach, intent);
    needs.push(...claudeNeeds);
  }

  // Deduplicate
  const uniqueNeeds = deduplicateNeeds(needs);

  return {
    needs: uniqueNeeds,
    parallel: true, // Skills/tools can generally be built in parallel
    hasInfrastructure: uniqueNeeds.length > 0,
  };
}

/**
 * Extract detailed specification for a skill or tool from the approach
 */
function extractSpecification(approach: string, name: string, type: 'skill' | 'tool'): string {
  const nameLower = name.toLowerCase().replace(/-/g, ' ').replace(/_/g, ' ');
  const lines = approach.split('\n');
  const relevantLines: string[] = [];
  let inRelevantSection = false;
  let sectionDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    // Check if this line mentions our skill/tool
    if (lineLower.includes(nameLower) || lineLower.includes(name.toLowerCase())) {
      // Include surrounding context
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 10);
      for (let j = start; j < end; j++) {
        if (!relevantLines.includes(lines[j])) {
          relevantLines.push(lines[j]);
        }
      }
    }

    // Track sections that might contain specs
    if (line.startsWith('#') || line.startsWith('**')) {
      if (lineLower.includes(nameLower) || lineLower.includes(type)) {
        inRelevantSection = true;
        sectionDepth = line.match(/^#+/)?.[0].length || 0;
      } else if (inRelevantSection) {
        const currentDepth = line.match(/^#+/)?.[0].length || 0;
        if (currentDepth > 0 && currentDepth <= sectionDepth) {
          inRelevantSection = false;
        }
      }
    }

    if (inRelevantSection) {
      relevantLines.push(line);
    }
  }

  return relevantLines.join('\n').trim() || `Build ${type}: ${name}`;
}

/**
 * Use Claude to extract infrastructure needs when pattern matching isn't enough
 */
async function extractNeedsWithClaude(
  approach: string,
  intent: Intent | null
): Promise<InfrastructureNeed[]> {
  const prompt = `Analyze this project approach and extract any skills or tools that need to be built before the main work can begin.

APPROACH:
${approach}

${intent ? `INTENT SUMMARY: ${intent.summary}` : ''}

Look for:
1. Skill documents/methodology files that should be created
2. Custom tools/scripts that should be built
3. Configuration files that need to be set up

For each one found, output in this format:
SKILL: name | path | description
TOOL: name | path | description

If no infrastructure needs are found, output: NO_INFRASTRUCTURE

Be specific about file paths (e.g., skills/market-research.md or tools/web-scraper.ts)`;

  try {
    const result = await claudeComplete({
      prompt,
      maxTurns: 1,
      timeout: 30000,
    });

    if (!result.success || !result.text || result.text.includes('NO_INFRASTRUCTURE')) {
      return [];
    }

    const needs: InfrastructureNeed[] = [];
    const lines = result.text.split('\n');

    for (const line of lines) {
      if (line.startsWith('SKILL:')) {
        const parts = line.replace('SKILL:', '').split('|').map(p => p.trim());
        if (parts.length >= 2) {
          needs.push({
            type: 'skill',
            name: parts[0],
            path: parts[1] || `skills/${parts[0].toLowerCase().replace(/\s+/g, '-')}.md`,
            description: parts[2] || `Build skill: ${parts[0]}`,
            specification: extractSpecification(approach, parts[0], 'skill'),
          });
        }
      } else if (line.startsWith('TOOL:')) {
        const parts = line.replace('TOOL:', '').split('|').map(p => p.trim());
        if (parts.length >= 2) {
          needs.push({
            type: 'tool',
            name: parts[0],
            path: parts[1] || `tools/${parts[0].toLowerCase().replace(/\s+/g, '-')}.ts`,
            description: parts[2] || `Build tool: ${parts[0]}`,
            specification: extractSpecification(approach, parts[0], 'tool'),
          });
        }
      }
    }

    return needs;
  } catch (error) {
    console.error('[Infrastructure Planner] Claude extraction failed:', error);
    return [];
  }
}

// ============================================================================
// Task Creation
// ============================================================================

/**
 * Create infrastructure tasks for each need
 */
export function createInfrastructureTasks(
  outcomeId: string,
  plan: InfrastructurePlan
): Task[] {
  const tasks: Task[] = [];

  for (let i = 0; i < plan.needs.length; i++) {
    const need = plan.needs[i];

    // Infrastructure tasks get low priority numbers (0-10) so they run first
    const priority = i + 1;

    const task = createTask({
      outcome_id: outcomeId,
      title: `[Infrastructure] Build ${need.type}: ${need.name}`,
      description: `${need.description}\n\nOutput path: ${need.path}\n\nSpecification:\n${need.specification}`,
      prd_context: JSON.stringify({
        type: 'infrastructure',
        infra_type: need.type,
        path: need.path,
      }),
      priority,
      phase: 'infrastructure',
      infra_type: need.type,
    });

    tasks.push(task);
  }

  // Mark outcome as needing infrastructure
  if (tasks.length > 0) {
    updateOutcome(outcomeId, { infrastructure_ready: 0 });
  }

  return tasks;
}

/**
 * Check if an outcome has pending infrastructure
 */
export function hasInfrastructureNeeds(approach: string): boolean {
  const patterns = [
    /skills\/[\w-]+\.md/i,
    /tools\/[\w-]+\.(ts|js)/i,
    /skill[- ]?based/i,
    /skill[- ]?driven/i,
    /skills[- ]?first/i,
    /methodology files/i,
    // Natural skill mentions: "**Market Intelligence Skill**" or "1. **Persona Research Skill**:"
    /\*\*[\w\s]+Skill\*\*/i,
    // Numbered skill lists: "1. Market Intelligence Skill:" or "- Campaign Planning Skill:"
    /^[\d\-\*\.]+\s*\*?\*?[\w\s]+Skill\*?\*?\s*:/im,
  ];

  return patterns.some(p => p.test(approach));
}

// ============================================================================
// Utilities
// ============================================================================

function formatName(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function deduplicateNeeds(needs: InfrastructureNeed[]): InfrastructureNeed[] {
  const seen = new Set<string>();
  return needs.filter(need => {
    const key = `${need.type}:${need.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
