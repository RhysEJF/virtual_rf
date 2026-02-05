/**
 * Capability Creation Service
 *
 * Handles creating new capabilities (skills and tools) either as:
 * 1. Capability tasks for workers to build
 * 2. Direct file creation with templates
 *
 * Used by UI, Conversational API, and CLI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createTask, getTasksByOutcome } from '../db/tasks';
import { getOutcomeById, updateOutcome } from '../db/outcomes';
import { getWorkspacePath } from '../workspace/detector';
import { syncSkillsToDatabase, createSkillTemplate } from '../agents/skill-manager';
import type { Task, CapabilityType } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface CreateCapabilityInput {
  type: 'skill' | 'tool';
  name: string;
  description?: string;
  specification?: string;
}

export interface CreateCapabilityResult {
  success: boolean;
  taskId?: string;
  filePath?: string;
  message: string;
  error?: string;
}

export interface CreateSkillFileInput {
  category: string;
  name: string;
  description?: string;
}

export interface CreateSkillFileResult {
  success: boolean;
  path?: string;
  message: string;
  error?: string;
}

export interface CreateToolFileInput {
  outcomeId: string;
  name: string;
  description?: string;
}

export interface CreateToolFileResult {
  success: boolean;
  path?: string;
  message: string;
  error?: string;
}

// ============================================================================
// Capability Task Creation
// ============================================================================

/**
 * Create a capability task for workers to build.
 * This creates a task in the capability phase that workers will pick up.
 */
export function createCapabilityTask(
  outcomeId: string,
  input: CreateCapabilityInput
): CreateCapabilityResult {
  // Validate outcome exists
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      success: false,
      message: `Outcome ${outcomeId} not found`,
      error: `Outcome ${outcomeId} not found`,
    };
  }

  // Check for duplicate capability tasks
  const existingTasks = getTasksByOutcome(outcomeId);
  const isDuplicate = existingTasks.some(
    (task) =>
      task.phase === 'capability' &&
      task.capability_type === input.type &&
      task.title.toLowerCase().includes(input.name.toLowerCase())
  );

  if (isDuplicate) {
    return {
      success: false,
      message: `A ${input.type} task for "${input.name}" already exists`,
      error: `Duplicate capability task`,
    };
  }

  // Get workspace path for output
  const workspacePath = getWorkspacePath(outcomeId);
  const capabilityPath =
    input.type === 'skill'
      ? `skills/${toPathName(input.name)}.md`
      : `tools/${toPathName(input.name)}.ts`;
  const outputPath = path.join(workspacePath, capabilityPath);

  // Build task description
  const description = buildTaskDescription(input, outputPath);

  // Find next available priority (capability tasks use 1-10)
  const capabilityTasks = existingTasks.filter((t) => t.phase === 'capability');
  const maxPriority = capabilityTasks.reduce(
    (max, t) => Math.max(max, t.priority),
    0
  );
  const priority = Math.min(maxPriority + 1, 10);

  // Create the task
  try {
    const task = createTask({
      outcome_id: outcomeId,
      title: `[Capability] Build ${input.type}: ${input.name}`,
      description,
      prd_context: JSON.stringify({
        type: 'capability',
        capability_type: input.type,
        path: capabilityPath,
      }),
      priority,
      phase: 'capability',
      capability_type: input.type as CapabilityType,
    });

    // Update outcome capability_ready status if needed
    if (outcome.capability_ready === 2) {
      updateOutcome(outcomeId, { capability_ready: 0 });
    }

    return {
      success: true,
      taskId: task.id,
      message: `Created capability task for ${input.type}: ${input.name}`,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to create capability task',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Build description for capability task
 */
function buildTaskDescription(
  input: CreateCapabilityInput,
  outputPath: string
): string {
  const parts = [
    input.description || `Build ${input.type}: ${input.name}`,
    '',
    `**Output path:** ${outputPath}`,
    '',
  ];

  if (input.specification) {
    parts.push('**Specification:**');
    parts.push(input.specification);
    parts.push('');
  }

  if (input.type === 'skill') {
    parts.push('**Skill Requirements:**');
    parts.push('- Must have YAML frontmatter with name and triggers');
    parts.push('- Must include Purpose, Methodology sections');
    parts.push('- Should include When to Use, Output Template sections');
    parts.push('- Minimum 500 characters of content');
  } else {
    parts.push('**Tool Requirements:**');
    parts.push('- Must be a TypeScript CLI tool');
    parts.push('- Should accept input via command line arguments');
    parts.push('- Must output results to stdout');
    parts.push('- Should include error handling');
  }

  return parts.join('\n');
}

// ============================================================================
// Direct File Creation
// ============================================================================

/**
 * Create a global skill file directly (not via task).
 * Uses the existing skill-manager infrastructure.
 */
export function createSkillFile(input: CreateSkillFileInput): CreateSkillFileResult {
  try {
    const filePath = createSkillTemplate(
      input.category,
      input.name,
      input.description || ''
    );

    // Sync to database
    syncSkillsToDatabase();

    return {
      success: true,
      path: filePath,
      message: `Created skill template at ${filePath}. Edit the file to add instructions.`,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to create skill file',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create an outcome-specific tool file directly.
 */
export function createToolFile(input: CreateToolFileInput): CreateToolFileResult {
  // Validate outcome exists
  const outcome = getOutcomeById(input.outcomeId);
  if (!outcome) {
    return {
      success: false,
      message: `Outcome ${input.outcomeId} not found`,
      error: `Outcome ${input.outcomeId} not found`,
    };
  }

  const workspacePath = getWorkspacePath(input.outcomeId);
  const toolsDir = path.join(workspacePath, 'tools');
  const toolFileName = `${toPathName(input.name)}.ts`;
  const toolPath = path.join(toolsDir, toolFileName);

  try {
    // Ensure tools directory exists
    if (!fs.existsSync(toolsDir)) {
      fs.mkdirSync(toolsDir, { recursive: true });
    }

    // Create tool template
    const content = generateToolTemplate(input.name, input.description);
    fs.writeFileSync(toolPath, content, 'utf-8');

    return {
      success: true,
      path: toolPath,
      message: `Created tool template at ${toolPath}. Edit the file to implement the tool.`,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to create tool file',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create an outcome-specific skill file directly.
 */
export function createOutcomeSkillFile(
  outcomeId: string,
  name: string,
  description?: string
): CreateSkillFileResult {
  // Validate outcome exists
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return {
      success: false,
      message: `Outcome ${outcomeId} not found`,
      error: `Outcome ${outcomeId} not found`,
    };
  }

  const workspacePath = getWorkspacePath(outcomeId);
  const skillsDir = path.join(workspacePath, 'skills');
  const skillFileName = `${toPathName(name)}.md`;
  const skillPath = path.join(skillsDir, skillFileName);

  try {
    // Ensure skills directory exists
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    // Create skill template
    const content = generateSkillTemplate(name, description);
    fs.writeFileSync(skillPath, content, 'utf-8');

    return {
      success: true,
      path: skillPath,
      message: `Created skill template at ${skillPath}. Edit the file to add instructions.`,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to create skill file',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Template Generation
// ============================================================================

/**
 * Generate a skill template
 */
function generateSkillTemplate(name: string, description?: string): string {
  return `---
name: ${name}
triggers: []
---

# ${name}

## Purpose
${description || 'Describe the purpose of this skill.'}

## When to Use
Describe when this skill should be applied.

## Methodology
1. Step one
2. Step two
3. Step three

## Tools & Resources
- List any tools or resources needed

## Output Template
Describe the expected output format.

## Quality Checklist
- [ ] Check 1
- [ ] Check 2
- [ ] Check 3

## Examples
Add examples of using this skill.
`;
}

/**
 * Generate a tool template
 */
function generateToolTemplate(name: string, description?: string): string {
  const camelName = toCamelCase(name);
  return `#!/usr/bin/env npx ts-node
/**
 * ${name} Tool
 *
 * ${description || 'Describe what this tool does.'}
 *
 * Usage:
 *   npx ts-node ${toPathName(name)}.ts [options]
 */

import { parseArgs } from 'util';

// Parse command line arguments
const { values, positionals } = parseArgs({
  options: {
    help: {
      type: 'boolean',
      short: 'h',
    },
    output: {
      type: 'string',
      short: 'o',
      default: 'json',
    },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(\`
${name} Tool

${description || 'Describe what this tool does.'}

Usage:
  npx ts-node ${toPathName(name)}.ts [options] <input>

Options:
  -h, --help     Show this help message
  -o, --output   Output format (json, text) [default: json]
\`);
  process.exit(0);
}

async function ${camelName}(input: string): Promise<unknown> {
  // TODO: Implement the tool logic
  return {
    input,
    result: 'Not implemented',
  };
}

async function main(): Promise<void> {
  const input = positionals[0];

  if (!input) {
    console.error('Error: Input is required');
    process.exit(1);
  }

  try {
    const result = await ${camelName}(input);

    if (values.output === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
`;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert a name to a path-friendly format
 */
function toPathName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Convert a name to camelCase
 */
function toCamelCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^./, (char) => char.toLowerCase());
}
