/**
 * Evolve Recipe Parser
 *
 * Parses structured markdown eval recipes into typed EvolveRecipe objects.
 * Recipes define what to optimize and how to judge improvements.
 */

// ============================================================================
// Types
// ============================================================================

export interface EvolveRecipe {
  name: string;
  artifact: { file: string; description: string };
  scoring: {
    mode: 'judge' | 'command';
    command?: string;
    direction: 'higher' | 'lower';
    budget: number;
    samples: number;
  };
  criteria: Array<{ name: string; weight: number; description: string }>;
  examples: Array<{ label: string; score: number; reasoning: string }>;
  context: string;
  prerequisites: Array<{ file: string; description: string }>;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a structured markdown recipe into an EvolveRecipe object.
 * Returns either a valid recipe or an error message.
 */
export function parseRecipe(markdown: string): EvolveRecipe | { error: string } {
  try {
    const name = parseName(markdown);
    if (!name) {
      return { error: 'Missing recipe name. Expected: # Evolve Recipe: <name>' };
    }

    const artifact = parseArtifact(markdown);
    if (!artifact) {
      return { error: 'Missing or invalid ## Artifact section. Expected file: and description: lines.' };
    }

    const scoring = parseScoring(markdown);
    if (!scoring) {
      return { error: 'Missing or invalid ## Scoring section. Expected mode:, direction:, budget: lines.' };
    }

    const criteria = parseCriteria(markdown);
    const examples = parseExamples(markdown);
    const context = parseContext(markdown);
    const prerequisites = parsePrerequisites(markdown);

    return {
      name,
      artifact,
      scoring,
      criteria,
      examples,
      context,
      prerequisites,
    };
  } catch (err) {
    return { error: `Parse error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ============================================================================
// Section Parsers
// ============================================================================

function getSection(markdown: string, heading: string): string | null {
  // Match ## Heading (case-insensitive) and capture until next ## or end
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?!\\n))`, 'mi');
  const match = markdown.match(regex);
  return match ? match[1].trim() : null;
}

function parseName(markdown: string): string | null {
  const match = markdown.match(/^#\s+Evolve Recipe:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function parseArtifact(markdown: string): { file: string; description: string } | null {
  const section = getSection(markdown, 'Artifact');
  if (!section) return null;

  const file = extractField(section, 'file');
  const description = extractField(section, 'description');

  if (!file) return null;

  return { file, description: description || '' };
}

function parseScoring(markdown: string): EvolveRecipe['scoring'] | null {
  const section = getSection(markdown, 'Scoring');
  if (!section) return null;

  const modeStr = extractField(section, 'mode');
  const mode = modeStr === 'command' ? 'command' : 'judge';

  const command = extractField(section, 'command') || undefined;
  const directionStr = extractField(section, 'direction');
  const direction = directionStr === 'lower' ? 'lower' : 'higher';

  const budgetStr = extractField(section, 'budget');
  const budget = budgetStr ? parseInt(budgetStr, 10) : 5;

  const samplesStr = extractField(section, 'samples');
  const samples = samplesStr ? parseInt(samplesStr, 10) : 1;

  return { mode, command, direction, budget: isNaN(budget) ? 5 : budget, samples: isNaN(samples) ? 1 : samples };
}

function parseCriteria(markdown: string): EvolveRecipe['criteria'] {
  const section = getSection(markdown, 'Criteria');
  if (!section) return [];

  const criteria: EvolveRecipe['criteria'] = [];
  // Match: - Name (weight): Description
  const lines = section.split('\n');
  for (const line of lines) {
    const match = line.match(/^[-*]\s+(.+?)\s*\((\d+(?:\.\d+)?)\)\s*:\s*(.+)$/);
    if (match) {
      criteria.push({
        name: match[1].trim(),
        weight: parseFloat(match[2]),
        description: match[3].trim(),
      });
    }
  }
  return criteria;
}

function parseExamples(markdown: string): EvolveRecipe['examples'] {
  const section = getSection(markdown, 'Examples');
  if (!section) return [];

  const examples: EvolveRecipe['examples'] = [];
  // Match: ### "Label" → score  (with reasoning in body)
  const parts = section.split(/^###\s+/m).filter(Boolean);
  for (const part of parts) {
    // First line: "Label" → score  OR  Label → score
    const headerMatch = part.match(/^[""]?(.+?)[""]?\s*[→\->]+\s*(\d+(?:\.\d+)?)\s*$/m);
    if (headerMatch) {
      const label = headerMatch[1].trim();
      const score = parseFloat(headerMatch[2]);
      // Everything after the first line is reasoning
      const lines = part.split('\n').slice(1);
      const reasoning = lines.join('\n').trim();
      examples.push({ label, score: isNaN(score) ? 0 : score, reasoning });
    }
  }
  return examples;
}

function parseContext(markdown: string): string {
  const section = getSection(markdown, 'Context');
  return section || '';
}

function parsePrerequisites(markdown: string): EvolveRecipe['prerequisites'] {
  const section = getSection(markdown, 'Prerequisites');
  if (!section) return [];

  const prerequisites: EvolveRecipe['prerequisites'] = [];
  const lines = section.split('\n');
  for (const line of lines) {
    // Match: - file: description  OR  - `file`: description
    const match = line.match(/^[-*]\s+`?([^`:]+?)`?\s*:\s*(.+)$/);
    if (match) {
      prerequisites.push({
        file: match[1].trim(),
        description: match[2].trim(),
      });
    }
  }
  return prerequisites;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract a key: value field from a section body.
 * Supports both inline (`key: value`) and code-fenced values.
 */
function extractField(section: string, key: string): string | null {
  const regex = new RegExp(`^[-*]?\\s*\\**${key}\\**\\s*:\\s*(.+)$`, 'mi');
  const match = section.match(regex);
  if (match) {
    // Strip backticks and quotes
    return match[1].trim().replace(/^[`"']|[`"']$/g, '');
  }
  return null;
}
