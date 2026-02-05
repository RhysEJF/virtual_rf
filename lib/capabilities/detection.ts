/**
 * Capability Detection Service
 *
 * Consolidated capability detection for finding skill and tool needs
 * in text content. Used by UI, Conversational API, and CLI.
 */

import { getAllSkills, searchSkills } from '../db/skills';
import { getTasksByOutcome } from '../db/tasks';
import { getOutcomeById } from '../db/outcomes';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspacePath } from '../workspace/detector';
import type { Skill } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface DetectedCapability {
  type: 'skill' | 'tool';
  name: string;
  path: string;
  description: string;
  source: 'explicit' | 'pattern' | 'natural';
}

export interface ExistingCapability {
  type: 'skill' | 'tool';
  name: string;
  path: string;
  id?: string;
}

export interface DetectionResult {
  suggested: DetectedCapability[];
  existing: ExistingCapability[];
  skillReferences: string[];
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect capabilities mentioned in text, returning both suggested new
 * capabilities and references to existing ones.
 *
 * @param text - The text to analyze (approach, task description, user message)
 * @param outcomeId - Optional outcome ID for context-specific detection
 * @returns Detection result with suggested and existing capabilities
 */
export function detectCapabilities(
  text: string,
  outcomeId?: string
): DetectionResult {
  // Get existing capabilities to compare against
  const existingCapabilities = getExistingCapabilities(outcomeId);

  // Detect new capability needs
  const suggestedCapabilities = detectNewCapabilities(text, existingCapabilities);

  // Detect references to existing skills
  const skillReferences = detectSkillReferences(text);

  // Match suggested against existing to prevent duplicates
  const filtered = filterExistingSuggestions(
    suggestedCapabilities,
    existingCapabilities
  );

  return {
    suggested: filtered,
    existing: existingCapabilities,
    skillReferences,
  };
}

// ============================================================================
// Existing Capability Detection
// ============================================================================

/**
 * Get all existing capabilities (global skills + outcome-specific skills/tools)
 */
export function getExistingCapabilities(outcomeId?: string): ExistingCapability[] {
  const existing: ExistingCapability[] = [];

  // Add global skills from database
  const globalSkills = getAllSkills();
  for (const skill of globalSkills) {
    existing.push({
      type: 'skill',
      name: skill.name,
      path: skill.path,
      id: skill.id,
    });
  }

  // If outcomeId provided, also check workspace for outcome-specific capabilities
  if (outcomeId) {
    const workspacePath = getWorkspacePath(outcomeId);

    // Check outcome skills
    const skillsDir = path.join(workspacePath, 'skills');
    if (fs.existsSync(skillsDir)) {
      try {
        const files = fs.readdirSync(skillsDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const name = file.replace('.md', '').replace(/-/g, ' ');
            existing.push({
              type: 'skill',
              name: formatName(name),
              path: `skills/${file}`,
            });
          }
        }
      } catch {
        // Directory might not be readable
      }
    }

    // Check outcome tools
    const toolsDir = path.join(workspacePath, 'tools');
    if (fs.existsSync(toolsDir)) {
      try {
        const files = fs.readdirSync(toolsDir);
        for (const file of files) {
          if (file.endsWith('.ts') || file.endsWith('.js')) {
            const name = file.replace(/\.(ts|js)$/, '').replace(/-/g, ' ');
            existing.push({
              type: 'tool',
              name: formatName(name),
              path: `tools/${file}`,
            });
          }
        }
      } catch {
        // Directory might not be readable
      }
    }

    // Also check capability tasks that have been created
    const tasks = getTasksByOutcome(outcomeId);
    for (const task of tasks) {
      if (task.phase === 'capability' && task.capability_type) {
        // Extract capability info from task title
        const match = task.title.match(/\[Capability\] Build (skill|tool): (.+)/);
        if (match) {
          const [, type, name] = match;
          existing.push({
            type: type as 'skill' | 'tool',
            name,
            path: type === 'skill'
              ? `skills/${name.toLowerCase().replace(/\s+/g, '-')}.md`
              : `tools/${name.toLowerCase().replace(/\s+/g, '-')}.ts`,
          });
        }
      }
    }
  }

  return deduplicateExisting(existing);
}

// ============================================================================
// New Capability Detection (Pattern Matching)
// ============================================================================

/**
 * Detect new capability needs from text using pattern matching.
 * Adapted from capability-planner.ts
 */
function detectNewCapabilities(
  text: string,
  existingCapabilities: ExistingCapability[]
): DetectedCapability[] {
  const detected: DetectedCapability[] = [];

  // Create lookup sets for existing capabilities
  const existingPaths = new Set(
    existingCapabilities.map((cap) => cap.path.toLowerCase())
  );
  const existingNames = new Set(
    existingCapabilities.map((cap) =>
      cap.name.toLowerCase().replace(/\s+/g, '-')
    )
  );

  const isAlreadyKnown = (capPath: string, name: string): boolean => {
    const normalizedPath = capPath.toLowerCase();
    const normalizedName = name.toLowerCase().replace(/\s+/g, '-');
    return existingPaths.has(normalizedPath) || existingNames.has(normalizedName);
  };

  // Pattern 1: Explicit skills/ directory mentioned
  const skillsMatch = text.match(/skills\/[\w-]+\.md/gi);
  if (skillsMatch) {
    for (const match of skillsMatch) {
      const name = match.replace('skills/', '').replace('.md', '');
      if (!isAlreadyKnown(match, name)) {
        detected.push({
          type: 'skill',
          name: formatName(name),
          path: match,
          description: `Build skill: ${formatName(name)}`,
          source: 'explicit',
        });
      }
    }
  }

  // Pattern 2: Explicit tools/ directory mentioned
  const toolsMatch = text.match(/tools\/[\w-]+\.(ts|js)/gi);
  if (toolsMatch) {
    for (const match of toolsMatch) {
      const name = match.replace('tools/', '').replace(/\.(ts|js)$/, '');
      if (!isAlreadyKnown(match, name)) {
        detected.push({
          type: 'tool',
          name: formatName(name),
          path: match,
          description: `Build tool: ${formatName(name)}`,
          source: 'explicit',
        });
      }
    }
  }

  // Pattern 3: Skill document structure mentioned
  const skillDocPattern =
    /skill[- ]?(?:document|file|md)s?.*?:\s*([\w\s,-]+\.md)/gi;
  let skillDocMatch;
  while ((skillDocMatch = skillDocPattern.exec(text)) !== null) {
    const files = skillDocMatch[1].split(',').map((f) => f.trim());
    for (const file of files) {
      if (file.endsWith('.md')) {
        const name = file.replace('.md', '');
        const capPath = `skills/${file}`;
        if (
          !isAlreadyKnown(capPath, name) &&
          !detected.some((d) => d.path === capPath)
        ) {
          detected.push({
            type: 'skill',
            name: formatName(name),
            path: capPath,
            description: `Build skill: ${formatName(name)}`,
            source: 'pattern',
          });
        }
      }
    }
  }

  // Pattern 4: Architecture section with skills/tools list
  const archSection = text.match(
    /```[\s\S]*?(skills\/|tools\/)[\s\S]*?```/gi
  );
  if (archSection) {
    for (const section of archSection) {
      const lines = section.split('\n');
      for (const line of lines) {
        if (line.includes('skills/') && line.endsWith('.md')) {
          const match = line.match(/(skills\/[\w-]+\.md)/);
          if (match) {
            const name = match[1].replace('skills/', '').replace('.md', '');
            if (
              !isAlreadyKnown(match[1], name) &&
              !detected.some((d) => d.path === match[1])
            ) {
              detected.push({
                type: 'skill',
                name: formatName(name),
                path: match[1],
                description: `Build skill: ${formatName(name)}`,
                source: 'pattern',
              });
            }
          }
        }
        if (line.includes('tools/') && line.match(/\.(ts|js)$/)) {
          const match = line.match(/(tools\/[\w-]+\.(ts|js))/);
          if (match) {
            const name = match[1]
              .replace('tools/', '')
              .replace(/\.(ts|js)$/, '');
            if (
              !isAlreadyKnown(match[1], name) &&
              !detected.some((d) => d.path === match[1])
            ) {
              detected.push({
                type: 'tool',
                name: formatName(name),
                path: match[1],
                description: `Build tool: ${formatName(name)}`,
                source: 'pattern',
              });
            }
          }
        }
      }
    }
  }

  // Pattern 5: Natural skill mentions like "**Market Intelligence Skill**"
  const naturalSkillPatterns = [
    /\*\*([\w\s]+)\s+Skill\*\*/gi,
    /^\s*[\d\-\*\.]+\s*\*\*([\w\s]+)\s+Skill\*\*\s*:/gim,
    /^\s*[\d\-\*\.]+\s*([\w\s]+)\s+Skill\s*:/gim,
  ];

  for (const pattern of naturalSkillPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const skillName = match[1].trim();
      const pathName = skillName.toLowerCase().replace(/\s+/g, '-');
      const capPath = `skills/${pathName}.md`;

      if (
        !isAlreadyKnown(capPath, skillName) &&
        !detected.some((d) => d.path === capPath)
      ) {
        detected.push({
          type: 'skill',
          name: skillName + ' Skill',
          path: capPath,
          description: `Build skill: ${skillName} Skill`,
          source: 'natural',
        });
      }
    }
  }

  // Pattern 6: "we need a skill for X" or "create a skill for X"
  const needSkillPatterns = [
    /(?:we\s+)?need\s+(?:a\s+)?skill\s+(?:for\s+)?([\w\s]+)/gi,
    /create\s+(?:a\s+)?skill\s+(?:for\s+)?([\w\s]+)/gi,
    /(?:we\s+)?need\s+(?:a\s+)?tool\s+(?:for\s+)?([\w\s]+)/gi,
    /create\s+(?:a\s+)?tool\s+(?:for\s+)?([\w\s]+)/gi,
  ];

  for (let i = 0; i < needSkillPatterns.length; i++) {
    const pattern = needSkillPatterns[i];
    const isToolPattern = i >= 2;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      // Skip if it's too short or just generic words
      if (name.length < 3 || /^(this|that|it|the)$/i.test(name)) {
        continue;
      }
      const pathName = name.toLowerCase().replace(/\s+/g, '-');
      const capPath = isToolPattern
        ? `tools/${pathName}.ts`
        : `skills/${pathName}.md`;

      if (
        !isAlreadyKnown(capPath, name) &&
        !detected.some((d) => d.path === capPath)
      ) {
        detected.push({
          type: isToolPattern ? 'tool' : 'skill',
          name: formatName(name),
          path: capPath,
          description: `Build ${isToolPattern ? 'tool' : 'skill'}: ${formatName(name)}`,
          source: 'natural',
        });
      }
    }
  }

  return deduplicateDetected(detected);
}

// ============================================================================
// Skill Reference Detection
// ============================================================================

/**
 * Detect references to existing skills in text.
 * Returns array of skill names that are referenced.
 */
function detectSkillReferences(text: string): string[] {
  const references: string[] = [];
  const textLower = text.toLowerCase();

  // Get all global skills
  const allSkills = getAllSkills();

  for (const skill of allSkills) {
    const skillNameLower = skill.name.toLowerCase();

    // Check exact name match
    if (textLower.includes(skillNameLower)) {
      references.push(skill.name);
      continue;
    }

    // Check partial matches by splitting skill name into words
    const skillWords = skillNameLower.split(/[\s-]+/);
    if (skillWords.length > 1) {
      // For compound skill names, check if all significant words appear
      const significantWords = skillWords.filter((w) => w.length > 3);
      if (
        significantWords.length > 0 &&
        significantWords.every((word) => textLower.includes(word))
      ) {
        references.push(skill.name);
      }
    }
  }

  // Also check for common API/tool patterns
  const commonPatterns = [
    { pattern: /perplexity/i, name: 'Perplexity API' },
    { pattern: /tavily/i, name: 'Tavily API' },
    { pattern: /firecrawl/i, name: 'Firecrawl' },
    { pattern: /exa\s+(?:search|api)/i, name: 'Exa Search' },
    { pattern: /serpapi/i, name: 'SerpAPI' },
    { pattern: /browserbase/i, name: 'Browserbase' },
    { pattern: /github\s+api/i, name: 'GitHub API' },
    { pattern: /web\s+scrap(?:ing|er)/i, name: 'Web Scraping' },
  ];

  for (const { pattern, name } of commonPatterns) {
    if (pattern.test(text) && !references.includes(name)) {
      references.push(name);
    }
  }

  return Array.from(new Set(references));
}

// ============================================================================
// List Capabilities
// ============================================================================

export interface ListCapabilitiesResult {
  globalSkills: Skill[];
  outcomeSkills: Array<{ name: string; path: string }>;
  outcomeTools: Array<{ name: string; path: string }>;
}

/**
 * List all capabilities available for an outcome
 */
export function listCapabilities(outcomeId?: string): ListCapabilitiesResult {
  const result: ListCapabilitiesResult = {
    globalSkills: getAllSkills(),
    outcomeSkills: [],
    outcomeTools: [],
  };

  if (outcomeId) {
    const workspacePath = getWorkspacePath(outcomeId);

    // List outcome skills
    const skillsDir = path.join(workspacePath, 'skills');
    if (fs.existsSync(skillsDir)) {
      try {
        const files = fs.readdirSync(skillsDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            result.outcomeSkills.push({
              name: formatName(file.replace('.md', '')),
              path: path.join(skillsDir, file),
            });
          }
        }
      } catch {
        // Directory might not be readable
      }
    }

    // List outcome tools
    const toolsDir = path.join(workspacePath, 'tools');
    if (fs.existsSync(toolsDir)) {
      try {
        const files = fs.readdirSync(toolsDir);
        for (const file of files) {
          if (file.endsWith('.ts') || file.endsWith('.js')) {
            result.outcomeTools.push({
              name: formatName(file.replace(/\.(ts|js)$/, '')),
              path: path.join(toolsDir, file),
            });
          }
        }
      } catch {
        // Directory might not be readable
      }
    }
  }

  return result;
}

// ============================================================================
// Utilities
// ============================================================================

function formatName(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function deduplicateDetected(
  capabilities: DetectedCapability[]
): DetectedCapability[] {
  const seen = new Set<string>();
  return capabilities.filter((cap) => {
    const key = `${cap.type}:${cap.path.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateExisting(
  capabilities: ExistingCapability[]
): ExistingCapability[] {
  const seen = new Set<string>();
  return capabilities.filter((cap) => {
    const key = `${cap.type}:${cap.path.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterExistingSuggestions(
  suggested: DetectedCapability[],
  existing: ExistingCapability[]
): DetectedCapability[] {
  const existingPaths = new Set(existing.map((e) => e.path.toLowerCase()));
  const existingNames = new Set(
    existing.map((e) => e.name.toLowerCase().replace(/\s+/g, '-'))
  );

  return suggested.filter((s) => {
    const pathLower = s.path.toLowerCase();
    const nameLower = s.name.toLowerCase().replace(/\s+/g, '-');
    return !existingPaths.has(pathLower) && !existingNames.has(nameLower);
  });
}
