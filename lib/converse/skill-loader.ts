/**
 * Skill Loader
 *
 * Loads and parses the converse-agent skill file into structured sections.
 * Uses HTML comment delimiters to identify sections.
 * Includes caching to avoid re-reading on every request.
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface LoadedSkill {
  /** Role and communication style section - used in Pass 1 system prompt */
  role: string;
  /** Available tools section - used in Pass 1 system prompt */
  toolSection: string;
  /** Formatting guidelines section - used in Pass 2 prompt */
  formatGuidelines: string;
  /** Full skill content for debugging */
  fullContent: string;
}

interface SkillCache {
  skill: LoadedSkill;
  loadedAt: number;
  filePath: string;
  mtime: number;
}

// ============================================================================
// Constants
// ============================================================================

const SKILL_FILE_PATH = path.join(process.cwd(), 'skills', 'converse-agent.md');
const CACHE_TTL_MS = 60000; // 1 minute cache

// Section delimiters
const SECTION_START_PATTERN = /<!--\s*SECTION:\s*(\w+)\s*-->/g;
const SECTION_END_PATTERN = /<!--\s*END SECTION:\s*(\w+)\s*-->/g;

// ============================================================================
// Module State
// ============================================================================

let skillCache: SkillCache | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Load the converse-agent skill file and parse it into sections.
 * Uses caching to avoid re-reading the file on every request.
 *
 * @throws Error if skill file is missing or malformed
 */
export function loadConverseSkill(): LoadedSkill {
  // Check if cache is valid
  if (skillCache && isCacheValid(skillCache)) {
    return skillCache.skill;
  }

  // Load and parse the skill file
  const skill = loadAndParseSkillFile();

  // Update cache
  const stats = fs.statSync(SKILL_FILE_PATH);
  skillCache = {
    skill,
    loadedAt: Date.now(),
    filePath: SKILL_FILE_PATH,
    mtime: stats.mtimeMs,
  };

  return skill;
}

/**
 * Clear the skill cache. Useful for testing or when the skill file is updated.
 */
export function clearSkillCache(): void {
  skillCache = null;
}

/**
 * Get the path to the skill file. Useful for debugging.
 */
export function getSkillFilePath(): string {
  return SKILL_FILE_PATH;
}

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Check if the cache is still valid
 */
function isCacheValid(cache: SkillCache): boolean {
  // Check TTL
  if (Date.now() - cache.loadedAt > CACHE_TTL_MS) {
    return false;
  }

  // Check if file has been modified
  try {
    const stats = fs.statSync(cache.filePath);
    return stats.mtimeMs === cache.mtime;
  } catch {
    return false;
  }
}

/**
 * Load and parse the skill file into sections
 */
function loadAndParseSkillFile(): LoadedSkill {
  // Check if file exists
  if (!fs.existsSync(SKILL_FILE_PATH)) {
    throw new Error(
      `Skill file not found: ${SKILL_FILE_PATH}. ` +
        'Please ensure skills/converse-agent.md exists.'
    );
  }

  // Read file content
  const content = fs.readFileSync(SKILL_FILE_PATH, 'utf-8');

  // Parse sections
  const sections = parseSections(content);

  // Validate required sections exist
  const requiredSections = ['ROLE', 'TOOLS', 'FORMAT_GUIDELINES'];
  for (const section of requiredSections) {
    if (!sections[section]) {
      throw new Error(
        `Missing required section in skill file: ${section}. ` +
          `Add <!-- SECTION: ${section} --> and <!-- END SECTION: ${section} --> markers.`
      );
    }
  }

  return {
    role: sections['ROLE'].trim(),
    toolSection: sections['TOOLS'].trim(),
    formatGuidelines: sections['FORMAT_GUIDELINES'].trim(),
    fullContent: content,
  };
}

/**
 * Parse the skill file content into named sections
 */
function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};

  // Find all section markers
  const startMatches: Array<{ name: string; index: number; length: number }> = [];
  const endMatches: Array<{ name: string; index: number }> = [];

  let match;

  // Reset regex state
  SECTION_START_PATTERN.lastIndex = 0;
  while ((match = SECTION_START_PATTERN.exec(content)) !== null) {
    startMatches.push({
      name: match[1],
      index: match.index,
      length: match[0].length,
    });
  }

  SECTION_END_PATTERN.lastIndex = 0;
  while ((match = SECTION_END_PATTERN.exec(content)) !== null) {
    endMatches.push({
      name: match[1],
      index: match.index,
    });
  }

  // Match start and end markers
  for (const start of startMatches) {
    const end = endMatches.find(
      (e) => e.name === start.name && e.index > start.index
    );

    if (end) {
      // Extract content between markers (excluding the markers themselves)
      const sectionContent = content.slice(
        start.index + start.length,
        end.index
      );
      sections[start.name] = sectionContent;
    } else {
      // No end marker found - use rest of content
      console.warn(
        `Warning: No end marker found for section ${start.name}. ` +
          `Add <!-- END SECTION: ${start.name} --> marker.`
      );
      sections[start.name] = content.slice(start.index + start.length);
    }
  }

  return sections;
}
