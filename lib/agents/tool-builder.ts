/**
 * Tool Builder
 *
 * Generates CLAUDE.md instructions optimized for tool creation
 * and tests/validates built tools.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getWorkspacePath } from '../workspace/detector';

// ============================================================================
// Types
// ============================================================================

export interface ToolTestResult {
  works: boolean;
  output: string;
  error?: string;
}

export interface ToolMetadata {
  name: string;
  path: string;
  type: 'typescript' | 'javascript';
  hasTests: boolean;
}

// ============================================================================
// CLAUDE.md Generation for Tool Building
// ============================================================================

/**
 * Generate CLAUDE.md instructions for building a tool
 */
export function generateToolBuildInstructions(
  toolName: string,
  toolPath: string,
  specification: string,
  outcomeId: string
): string {
  const workspacePath = getWorkspacePath(outcomeId);
  const fullToolPath = path.join(workspacePath, toolPath);
  const ext = path.extname(toolPath);
  const isTypeScript = ext === '.ts';

  return `# Build Tool: ${toolName}

## Your Task
Create a reusable tool that can be used by AI agents and other parts of the system.

## Tool Specification
${specification}

## Output Location
Create: ${fullToolPath}

## Tool Template

Your tool MUST follow this structure:

\`\`\`${isTypeScript ? 'typescript' : 'javascript'}
/**
 * ${toolName}
 *
 * ${specification.split('\n')[0] || 'Tool description here'}
 */

${isTypeScript ? `
// Types
export interface ${toPascalCase(toolName)}Options {
  // Configuration options
}

export interface ${toPascalCase(toolName)}Result {
  success: boolean;
  data?: unknown;
  error?: string;
}
` : ''}

/**
 * Main tool function
 */
export async function ${toCamelCase(toolName)}(
  input: ${isTypeScript ? `${toPascalCase(toolName)}Options` : 'object'}
)${isTypeScript ? `: Promise<${toPascalCase(toolName)}Result>` : ''} {
  try {
    // Implementation here

    return {
      success: true,
      data: null, // Replace with actual result
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// CLI interface for testing
if (require.main === module) {
  const args = process.argv.slice(2);
  console.log('Running ${toolName} with args:', args);

  // Example usage
  ${toCamelCase(toolName)}({})
    .then(result => {
      console.log('Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
\`\`\`

## Requirements
1. The tool must export a main function that can be imported
2. Include proper error handling with try/catch
3. Return structured results with success/error information
4. Include a CLI interface for testing (if run directly)
5. Add JSDoc comments explaining the function
6. Handle edge cases gracefully

## Testing
After creating the tool, verify it works:
1. The file should parse without syntax errors
2. The exported function should be callable
3. Error cases should return structured error objects

## Instructions
1. Read the specification carefully
2. Design the tool interface (inputs/outputs)
3. Implement the core functionality
4. Add error handling
5. Create a simple CLI test interface
6. Write the file to the output location
7. Write DONE to progress.txt when complete
`;
}

// ============================================================================
// Tool Testing
// ============================================================================

/**
 * Test a built tool by attempting to load and run it
 */
export async function testTool(toolPath: string): Promise<ToolTestResult> {
  // Check if file exists
  if (!fs.existsSync(toolPath)) {
    return {
      works: false,
      output: '',
      error: `Tool file not found: ${toolPath}`,
    };
  }

  const ext = path.extname(toolPath);
  const isTypeScript = ext === '.ts';

  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';

    // Use ts-node for TypeScript, node for JavaScript
    const command = isTypeScript ? 'npx' : 'node';
    const args = isTypeScript ? ['ts-node', toolPath] : [toolPath];

    const proc = spawn(command, args, {
      cwd: path.dirname(toolPath),
      timeout: 30000,
      env: { ...process.env, NODE_ENV: 'test' },
    });

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          works: true,
          output: output.trim(),
        });
      } else {
        resolve({
          works: false,
          output: output.trim(),
          error: errorOutput.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        works: false,
        output: '',
        error: `Failed to spawn process: ${err.message}`,
      });
    });
  });
}

/**
 * Validate tool syntax without running it
 */
export function validateToolSyntax(toolPath: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fs.existsSync(toolPath)) {
    return { valid: false, errors: [`File not found: ${toolPath}`] };
  }

  const content = fs.readFileSync(toolPath, 'utf-8');

  // Basic syntax checks
  try {
    // Check for balanced braces
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`);
    }

    // Check for export
    if (!content.includes('export')) {
      errors.push('No exports found - tool should export at least one function');
    }

    // Check for async function
    if (!content.includes('async') && !content.includes('function')) {
      errors.push('No functions found in tool');
    }

    // Check minimum length
    if (content.length < 100) {
      errors.push('Tool file seems too short (less than 100 characters)');
    }
  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Load tool metadata from the workspace
 */
export function loadOutcomeTools(outcomeId: string): ToolMetadata[] {
  const workspacePath = getWorkspacePath(outcomeId);
  const toolsPath = path.join(workspacePath, 'tools');

  if (!fs.existsSync(toolsPath)) {
    return [];
  }

  const tools: ToolMetadata[] = [];

  try {
    const files = fs.readdirSync(toolsPath);
    const codeFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.js'));

    for (const file of codeFiles) {
      const filePath = path.join(toolsPath, file);
      const ext = path.extname(file);
      const name = file.replace(/\.(ts|js)$/, '');

      // Check for corresponding test file
      const testPath1 = path.join(toolsPath, `${name}.test${ext}`);
      const testPath2 = path.join(toolsPath, `${name}.spec${ext}`);
      const hasTests = fs.existsSync(testPath1) || fs.existsSync(testPath2);

      tools.push({
        name,
        path: filePath,
        type: ext === '.ts' ? 'typescript' : 'javascript',
        hasTests,
      });
    }
  } catch (error) {
    console.error('[Tool Builder] Error loading tools:', error);
  }

  return tools;
}

// ============================================================================
// Utilities
// ============================================================================

function toPascalCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
