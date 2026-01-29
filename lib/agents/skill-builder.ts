/**
 * Skill Builder
 *
 * Generates CLAUDE.md instructions optimized for skill creation
 * and validates built skills.
 */

import fs from 'fs';
import path from 'path';
import { getWorkspacePath } from '../workspace/detector';

// ============================================================================
// Types
// ============================================================================

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SkillMetadata {
  name: string;
  triggers: string[];
  description?: string;
}

// ============================================================================
// CLAUDE.md Generation for Skill Building
// ============================================================================

/**
 * Generate CLAUDE.md instructions for building a skill document
 */
export function generateSkillBuildInstructions(
  skillName: string,
  skillPath: string,
  specification: string,
  outcomeContext: string,
  outcomeId: string
): string {
  const workspacePath = getWorkspacePath(outcomeId);
  const fullSkillPath = path.join(workspacePath, skillPath);

  return `# Build Skill: ${skillName}

## Outcome Context
${outcomeContext}

## Your Task
Create a skill document that can be used by AI agents to perform "${skillName}" consistently and effectively.

## Skill Specification
${specification}

## Output Location
Create: ${fullSkillPath}

## Skill Document Template

Your skill document MUST follow this structure:

\`\`\`markdown
---
name: ${skillName}
triggers:
  - keyword1
  - keyword2
  - keyword3
---

# ${skillName}

## Purpose
Explain why this skill exists and what problem it solves.

## When to Use
- Situation 1 where this skill applies
- Situation 2 where this skill applies

## Methodology
Step-by-step approach that an AI agent can follow:

### Step 1: [Name]
Detailed instructions for this step...

### Step 2: [Name]
Detailed instructions for this step...

### Step 3: [Name]
Detailed instructions for this step...

## Tools Available

For each tool this skill uses, document it with this structure:

### [tool-name]
**Purpose:** What this tool does
**Path:** \`../tools/tool-name.ts\`
**Run:** \`npx ts-node ../tools/tool-name.ts [args]\`
**Key Options:**
- \`--option1\`: Description
- \`--option2\`: Description

**Example Usage:**
\`\`\`bash
npx ts-node ../tools/tool-name.ts https://example.com --json
\`\`\`

**When to Use:** Specific situations in the methodology where this tool applies

---

IMPORTANT: If tools exist in ../tools/, check their --help output and document:
1. The exact path to run them
2. Required and optional arguments
3. Example commands for common use cases
4. Which methodology steps use this tool

## Output Template
Define the expected format for deliverables:

\`\`\`
[Template structure here]
\`\`\`

## Quality Checklist
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Examples
Brief example of applying this methodology...
\`\`\`

## Requirements
1. The skill document must have valid YAML frontmatter with name and triggers
2. Include all required sections: Purpose, When to Use, Methodology, Tools Available, Output Template
3. The methodology must be actionable and step-by-step
4. Include specific examples where helpful
5. The skill should be self-contained and usable without additional context
6. **Tools section must include executable instructions** - path, run command, args, examples
7. Cross-reference tools in methodology steps (e.g., "Use web-scraper tool to fetch...")

## Validation
After creating the skill document, verify:
1. YAML frontmatter is valid and has name + triggers
2. All required sections are present
3. Methodology is clear and actionable
4. Output template is specific

## Instructions
1. Read the specification carefully
2. Check if any tools exist in \`../tools/\` that are relevant to this skill
3. If tools exist, run \`npx ts-node ../tools/[name].ts --help\` to get their CLI interface
4. Research best practices for this type of skill if needed
5. Create the skill document following the template
6. Document all relevant tools with executable instructions (path, command, args, examples)
7. Cross-reference tools in the methodology steps
8. Ensure the methodology is detailed enough for an AI to follow
9. Write the file to the output location
10. Write DONE to progress.txt when complete
`;
}

// ============================================================================
// Skill Validation
// ============================================================================

/**
 * Validate a built skill document
 */
export async function validateSkill(skillPath: string): Promise<SkillValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if file exists
  if (!fs.existsSync(skillPath)) {
    return {
      valid: false,
      errors: [`Skill file not found: ${skillPath}`],
      warnings: [],
    };
  }

  const content = fs.readFileSync(skillPath, 'utf-8');

  // Check for YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    errors.push('Missing YAML frontmatter (should start with --- and end with ---)');
  } else {
    const frontmatter = frontmatterMatch[1];

    // Check for required frontmatter fields
    if (!frontmatter.includes('name:')) {
      errors.push('Missing "name" in frontmatter');
    }
    if (!frontmatter.includes('triggers:')) {
      warnings.push('Missing "triggers" in frontmatter (optional but recommended)');
    }
  }

  // Check for required sections
  const requiredSections = ['Purpose', 'Methodology'];
  for (const section of requiredSections) {
    const sectionPattern = new RegExp(`^##\\s+${section}`, 'mi');
    if (!sectionPattern.test(content)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // Check for recommended sections
  const recommendedSections = ['When to Use', 'Output Template', 'Tools & Resources'];
  for (const section of recommendedSections) {
    const sectionPattern = new RegExp(`^##\\s+${section}`, 'mi');
    if (!sectionPattern.test(content)) {
      warnings.push(`Missing recommended section: ${section}`);
    }
  }

  // Check minimum content length
  if (content.length < 500) {
    warnings.push('Skill document seems too short (less than 500 characters)');
  }

  // Check for step-by-step methodology
  if (!content.includes('Step') && !content.includes('step')) {
    warnings.push('Methodology should include numbered steps');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parse skill metadata from a skill document
 */
export function parseSkillMetadata(skillPath: string): SkillMetadata | null {
  if (!fs.existsSync(skillPath)) {
    return null;
  }

  const content = fs.readFileSync(skillPath, 'utf-8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];

  // Parse name
  const nameMatch = frontmatter.match(/name:\s*(.+)/);
  const name = nameMatch ? nameMatch[1].trim() : path.basename(skillPath, '.md');

  // Parse triggers
  const triggers: string[] = [];
  const triggersMatch = frontmatter.match(/triggers:\n((?:\s+-\s+.+\n?)*)/);
  if (triggersMatch) {
    const triggerLines = triggersMatch[1].split('\n');
    for (const line of triggerLines) {
      const triggerMatch = line.match(/^\s+-\s+(.+)/);
      if (triggerMatch) {
        triggers.push(triggerMatch[1].trim());
      }
    }
  }

  // Parse description if present
  const descMatch = frontmatter.match(/description:\s*(.+)/);
  const description = descMatch ? descMatch[1].trim() : undefined;

  return {
    name,
    triggers,
    description,
  };
}

/**
 * Load all skills from an outcome's workspace
 */
export function loadOutcomeSkills(outcomeId: string): SkillMetadata[] {
  const workspacePath = getWorkspacePath(outcomeId);
  const skillsPath = path.join(workspacePath, 'skills');

  if (!fs.existsSync(skillsPath)) {
    return [];
  }

  const skills: SkillMetadata[] = [];

  try {
    const files = fs.readdirSync(skillsPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const filePath = path.join(skillsPath, file);
      const metadata = parseSkillMetadata(filePath);
      if (metadata) {
        skills.push(metadata);
      }
    }
  } catch (error) {
    console.error('[Skill Builder] Error loading skills:', error);
  }

  return skills;
}

/**
 * Get the full content of a skill document
 */
export function getSkillContent(outcomeId: string, skillName: string): string | null {
  const workspacePath = getWorkspacePath(outcomeId);
  const skillPath = path.join(workspacePath, 'skills', `${skillName}.md`);

  if (!fs.existsSync(skillPath)) {
    // Try with kebab-case
    const kebabName = skillName.toLowerCase().replace(/\s+/g, '-');
    const altPath = path.join(workspacePath, 'skills', `${kebabName}.md`);
    if (fs.existsSync(altPath)) {
      return fs.readFileSync(altPath, 'utf-8');
    }
    return null;
  }

  return fs.readFileSync(skillPath, 'utf-8');
}
