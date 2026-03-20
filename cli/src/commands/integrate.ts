/**
 * Integration Management Commands
 *
 * flow integrate <name>                          Scaffold a new integration
 * flow integrate <name> --source <path>          Link to a local tool's commands
 * flow integrate <name> --analyze <url-or-path>  AI-powered: read repo, generate plan, approve
 * flow integrate <name> --disable                Disable an integration
 * flow integrate <name> --enable                 Re-enable an integration
 * flow integrations                              List all integrations
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

// ============================================================================
// Paths
// ============================================================================

const INTEGRATIONS_DIR = join(homedir(), 'flow-data', 'integrations');

function ensureIntegrationsDir(): void {
  mkdirSync(INTEGRATIONS_DIR, { recursive: true });
}

// ============================================================================
// Helpers
// ============================================================================

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getExistingCommands(): Map<string, string> {
  const commands = new Map<string, string>();

  if (!existsSync(INTEGRATIONS_DIR)) return commands;

  for (const dir of readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (existsSync(join(INTEGRATIONS_DIR, dir.name, '.disabled'))) continue;

    const intPath = join(INTEGRATIONS_DIR, dir.name);

    // Check commands/ dir
    const cmdsDir = join(intPath, 'commands');
    if (existsSync(cmdsDir)) {
      for (const f of readdirSync(cmdsDir).filter(f => f.endsWith('.md'))) {
        commands.set(f.replace(/\.md$/, ''), dir.name);
      }
    }

    // Check commands_source frontmatter
    const skillPath = join(intPath, 'skill.md');
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, 'utf-8');
      const match = content.match(/commands_source:\s*(.+)/);
      if (match) {
        const source = match[1].trim().replace(/^~/, homedir());
        for (const checkDir of [join(source, '.claude', 'commands'), join(source, 'commands')]) {
          if (existsSync(checkDir)) {
            for (const f of readdirSync(checkDir).filter(f => f.endsWith('.md'))) {
              commands.set(f.replace(/\.md$/, ''), dir.name);
            }
          }
        }
      }
    }
  }

  return commands;
}

// ============================================================================
// Scaffold
// ============================================================================

function scaffoldIntegration(name: string, options?: { source?: string }): void {
  ensureIntegrationsDir();
  const intPath = join(INTEGRATIONS_DIR, name);

  if (existsSync(intPath)) {
    console.error(chalk.red('Error:'), `Integration "${name}" already exists at ${intPath}`);
    process.exit(1);
  }

  mkdirSync(intPath, { recursive: true });

  const commandsSource = options?.source
    ? `\ncommands_source: ${options.source.replace(homedir(), '~')}`
    : '';

  writeFileSync(join(intPath, 'skill.md'), `---
name: ${name}
description: TODO — describe what this integration does
worker_access: grant${commandsSource}
---

# ${name}

TODO: Document the commands and capabilities this integration provides.
`, 'utf-8');

  writeFileSync(join(intPath, 'permissions.json'), JSON.stringify([], null, 2) + '\n', 'utf-8');

  console.log();
  console.log(chalk.green('  ✓'), `Created integration: ${chalk.bold(name)}`);
  console.log();
  console.log('  Next steps:');
  console.log(`    1. Edit the skill:    ${chalk.cyan(`~/flow-data/integrations/${name}/skill.md`)}`);
  console.log(`    2. Add permissions:   ${chalk.cyan(`~/flow-data/integrations/${name}/permissions.json`)}`);
  console.log(`    3. Launch ${chalk.bold('flow')} to use it`);
  console.log();
}

// ============================================================================
// Analyze & Interactive Setup
// ============================================================================

interface AnalysisPlan {
  displayName: string;
  description: string;
  skillContent: string;
  permissions: string[];
  commands: Array<{ name: string; description: string }>;
  prerequisites: string[];
  workerAccess: string;
  mcpConfig?: {
    mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };
}

async function analyzeAndCreate(name: string, target: string): Promise<void> {
  ensureIntegrationsDir();
  const intPath = join(INTEGRATIONS_DIR, name);

  if (existsSync(intPath)) {
    console.error(chalk.red('Error:'), `Integration "${name}" already exists`);
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold('  ✦ Analyzing'), chalk.cyan(target), '...');
  console.log();

  // Build the analysis prompt
  const existingCommands = getExistingCommands();
  const existingList = Array.from(existingCommands.entries())
    .map(([cmd, owner]) => `/${cmd} (from ${owner})`)
    .join(', ') || 'none';

  const analysisPrompt = `Analyze this repository/tool for integration with Flow (an AI workforce management system).

Target: ${target}

If this is a URL, fetch and read the README. If it's a local path, read the key files.

Existing slash commands in the system: ${existingList}

Return a JSON object (and ONLY the JSON, no markdown fences) with this exact structure:
{
  "displayName": "Human-readable name",
  "description": "One-line description of what this integration provides",
  "skillContent": "Full markdown skill content teaching Claude how to use this tool. Include key commands, patterns, examples. Be thorough but concise.",
  "permissions": ["Bash(toolname *)", "Read"],
  "commands": [{"name": "command-name", "description": "What it does"}],
  "prerequisites": ["brew install something", "tool auth setup"],
  "workerAccess": "grant",
  "mcpConfig": null
}

IMPORTANT rules for the JSON:
- prerequisites MUST be actual runnable shell commands (e.g., "brew install foo", "npm install -g bar"). Never include prose like "Install X (see website)". If something can't be expressed as a command, omit it.
- commands: only include high-value frequently-used operations, not every subcommand.
- permissions: list Bash patterns needed (e.g., "Bash(gws *)" for a tool called gws).
- skillContent: write actual skill documentation teaching Claude the tool's commands and best practices.
- mcpConfig: if this is an MCP server (uses @modelcontextprotocol/sdk, stdio transport, etc.), provide the config to connect. Format: {"mcpServers":{"name":{"command":"npx","args":["-y","package-name"],"env":{"TOKEN":"YOUR_TOKEN_HERE"}}}}. Use placeholder strings for secrets. Set to null if this is a CLI tool, not an MCP server.`;

  // Spawn claude for analysis
  let analysisJson: string;
  try {
    analysisJson = execSync(
      `claude -p ${JSON.stringify(analysisPrompt)} --output-format text --dangerously-skip-permissions`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, CLAUDECODE: undefined },
      }
    ).toString().trim();
  } catch (error) {
    const err = error as { stderr?: Buffer; stdout?: Buffer; status?: number; signal?: string; message?: string };
    const stderr = err.stderr?.toString()?.trim() || '';
    const stdout = err.stdout?.toString()?.trim() || '';
    const signal = err.signal || '';

    if (signal === 'SIGTERM') {
      console.error(chalk.red('  Error:'), 'Analysis timed out (120s). Try a simpler repo or increase timeout.');
    } else if (stderr.includes('rate limit') || stdout.includes('rate limit')) {
      console.error(chalk.red('  Error:'), 'Hit Claude rate limit. Wait a moment and try again.');
    } else {
      console.error(chalk.red('  Error:'), 'Analysis failed.');
      if (stderr) console.error(chalk.gray(`  stderr: ${stderr.slice(0, 300)}`));
      if (stdout) console.error(chalk.gray(`  stdout: ${stdout.slice(0, 300)}`));
      if (!stderr && !stdout) console.error(chalk.gray(`  ${err.message || 'Unknown error'}`));
    }
    process.exit(1);
  }

  // Parse the JSON response
  let plan: AnalysisPlan;
  try {
    // Strip markdown fences if present
    const cleaned = analysisJson
      .replace(/^```json\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    plan = JSON.parse(cleaned);
  } catch {
    console.error(chalk.red('  Error:'), 'Could not parse analysis result.');
    console.error(chalk.gray('  Raw output (first 500 chars):'));
    console.error(chalk.gray(`  ${analysisJson.slice(0, 500)}`));
    process.exit(1);
  }

  // ── Display the plan ──────────────────────────────────────────────────

  console.log(chalk.bold(`  Integration Plan: ${plan.displayName}`));
  console.log(chalk.gray(`  ${plan.description}`));
  console.log();

  // Skill preview
  const skillLines = plan.skillContent.split('\n').slice(0, 8);
  console.log(chalk.bold('  Skill preview:'));
  for (const line of skillLines) {
    console.log(chalk.gray(`    ${line}`));
  }
  if (plan.skillContent.split('\n').length > 8) {
    console.log(chalk.gray('    ...'));
  }
  console.log();

  // Commands with conflict detection
  if (plan.commands.length > 0) {
    console.log(chalk.bold(`  Commands to sync (${plan.commands.length}):`));
    const commandDecisions: Array<{ name: string; action: 'include' | 'skip' | 'rename'; newName?: string }> = [];

    for (const cmd of plan.commands) {
      const conflict = existingCommands.get(cmd.name);
      if (conflict) {
        console.log(`    ${chalk.yellow('⚠')} /${cmd.name}  ${chalk.gray(cmd.description)}`);
        console.log(chalk.yellow(`      CONFLICTS with ${conflict}`));
        console.log(`      ${chalk.cyan('[1]')} Skip    ${chalk.cyan('[2]')} Rename    ${chalk.cyan('[3]')} Replace`);

        const choice = await prompt('      Choice: ');

        if (choice === '2') {
          const newName = await prompt(`      New name (without /): `);
          if (newName) {
            commandDecisions.push({ name: cmd.name, action: 'rename', newName });
            console.log(chalk.green(`      ✓ /${cmd.name} → /${newName}`));
          } else {
            commandDecisions.push({ name: cmd.name, action: 'skip' });
            console.log(chalk.gray(`      ✓ Skipped`));
          }
        } else if (choice === '3') {
          commandDecisions.push({ name: cmd.name, action: 'include' });
          console.log(chalk.green(`      ✓ Replacing ${conflict} version`));
        } else {
          commandDecisions.push({ name: cmd.name, action: 'skip' });
          console.log(chalk.gray(`      ✓ Skipped`));
        }
      } else {
        console.log(`    ${chalk.green('✓')} /${cmd.name}  ${chalk.gray(cmd.description)}`);
        commandDecisions.push({ name: cmd.name, action: 'include' });
      }
    }
    console.log();

    // Store decisions for later
    (plan as AnalysisPlan & { commandDecisions: typeof commandDecisions }).commandDecisions = commandDecisions;
  }

  // Permissions
  if (plan.permissions.length > 0) {
    console.log(chalk.bold('  Permissions:'));
    for (const p of plan.permissions) {
      console.log(`    ${chalk.green('+')} ${p}`);
    }
    console.log();
  }

  // Prerequisites
  if (plan.prerequisites.length > 0) {
    console.log(chalk.bold('  Prerequisites (you run these after):'));
    for (const p of plan.prerequisites) {
      console.log(`    ${chalk.cyan(p)}`);
    }
    console.log();
  }

  // ── MCP Safety Scan ──────────────────────────────────────────────────

  if (plan.mcpConfig) {
    console.log(chalk.bold('  MCP Server Detected'));
    console.log();

    // Check if mcp_safety_scan is available
    let hasSafetyScanner = false;
    try {
      execSync('which mcp_safety_scan', { stdio: 'pipe' });
      hasSafetyScanner = true;
    } catch {
      // not installed
    }

    if (hasSafetyScanner && process.env.OPENAI_API_KEY) {
      const runScan = await prompt(`  ${chalk.yellow('⚠')} Run safety scan before installing? ${chalk.cyan('[y/n]')}: `);

      if (runScan.toLowerCase() === 'y') {
        console.log();
        console.log(chalk.yellow('  Scanning MCP server for vulnerabilities...'));
        console.log();

        // Write temp config for the scanner
        const tmpConfig = join(homedir(), '.flow-mcp-scan-tmp.json');
        try {
          writeFileSync(tmpConfig, JSON.stringify(plan.mcpConfig, null, 2), 'utf-8');

          const scanOutput = execSync(`mcp_safety_scan --config ${tmpConfig}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120000,
            env: { ...process.env },
          }).toString().trim();

          // Display scan results
          console.log(chalk.bold('  Safety Scan Results:'));
          console.log();
          for (const line of scanOutput.split('\n').slice(0, 30)) {
            console.log(`  ${line}`);
          }
          if (scanOutput.split('\n').length > 30) {
            console.log(chalk.gray('  ... (truncated)'));
          }
          console.log();
        } catch (scanError) {
          const err = scanError as { stdout?: Buffer; stderr?: Buffer };
          const stdout = err.stdout?.toString()?.trim() || '';
          const stderr = err.stderr?.toString()?.trim() || '';
          if (stdout) {
            console.log(chalk.bold('  Safety Scan Results:'));
            console.log();
            for (const line of stdout.split('\n').slice(0, 30)) {
              console.log(`  ${line}`);
            }
            console.log();
          } else {
            console.log(chalk.yellow('  Safety scan encountered an error.'));
            if (stderr) console.log(chalk.gray(`  ${stderr.slice(0, 200)}`));
            console.log();
          }
        } finally {
          try { unlinkSync(tmpConfig); } catch { /* */ }
        }
      }
    } else if (hasSafetyScanner) {
      console.log(chalk.gray('  Safety scan available but OPENAI_API_KEY not set. Skipping.'));
      console.log();
    } else {
      console.log(chalk.gray('  Tip: Install mcp_safety_scan for automatic security scanning.'));
      console.log(chalk.gray('  pipx install -e ~/mcpSafetyScanner'));
      console.log();
    }
  }

  // ── Approval ──────────────────────────────────────────────────────────

  console.log(chalk.gray('  ─'.repeat(30)));
  console.log();
  console.log(`  This will create ${chalk.cyan(`~/flow-data/integrations/${name}/`)}`);
  console.log();
  const approval = await prompt(`  ${chalk.green('[y]')} Create  ${chalk.red('[n]')} Cancel: `);

  if (approval.toLowerCase() !== 'y') {
    console.log();
    console.log(chalk.gray('  Cancelled.'));
    console.log();
    return;
  }

  // ── Create the integration ────────────────────────────────────────────

  mkdirSync(intPath, { recursive: true });

  // Write skill.md
  const skillMd = `---
name: ${plan.displayName}
description: ${plan.description}
worker_access: ${plan.workerAccess || 'grant'}
---

${plan.skillContent}
`;
  writeFileSync(join(intPath, 'skill.md'), skillMd, 'utf-8');

  // Write permissions.json
  writeFileSync(join(intPath, 'permissions.json'), JSON.stringify(plan.permissions, null, 2) + '\n', 'utf-8');

  // Write mcp.json if this is an MCP integration
  if (plan.mcpConfig) {
    writeFileSync(join(intPath, 'mcp.json'), JSON.stringify(plan.mcpConfig, null, 2) + '\n', 'utf-8');
  }

  // Write commands if any
  const decisions = (plan as AnalysisPlan & { commandDecisions?: Array<{ name: string; action: string; newName?: string }> }).commandDecisions;
  if (decisions && decisions.length > 0) {
    const cmdsDir = join(intPath, 'commands');
    mkdirSync(cmdsDir, { recursive: true });

    const excluded: string[] = [];

    for (const decision of decisions) {
      if (decision.action === 'skip') {
        excluded.push(decision.name);
        continue;
      }

      const cmdName = decision.action === 'rename' && decision.newName ? decision.newName : decision.name;
      const cmdDesc = plan.commands.find(c => c.name === decision.name)?.description || '';

      // Generate a simple command .md file
      writeFileSync(join(cmdsDir, `${cmdName}.md`), `# /${cmdName}

${cmdDesc}

Run the appropriate command for this integration.
`, 'utf-8');
    }

    // Write commands.json if there are exclusions
    if (excluded.length > 0) {
      writeFileSync(join(intPath, 'commands.json'), JSON.stringify({ exclude: excluded }, null, 2) + '\n', 'utf-8');
    }
  }

  console.log();
  console.log(chalk.green('  ✓'), `Integration created: ${chalk.bold(plan.displayName)}`);
  console.log();

  if (plan.prerequisites.length > 0) {
    console.log('  Now run:');
    for (const p of plan.prerequisites) {
      console.log(`    ${chalk.cyan(p)}`);
    }
    console.log();
  }

  console.log(`  Then launch ${chalk.bold('flow')} — the integration will be active.`);
  console.log();
}

// ============================================================================
// List
// ============================================================================

function listIntegrations(): void {
  ensureIntegrationsDir();

  const entries = readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory());

  if (entries.length === 0) {
    console.log();
    console.log(chalk.gray('  No integrations found.'));
    console.log(chalk.gray(`  Run ${chalk.white('flow integrate <name>')} to create one.`));
    console.log();
    return;
  }

  console.log();
  console.log(chalk.bold('  Integrations'));
  console.log();

  for (const entry of entries) {
    const intPath = join(INTEGRATIONS_DIR, entry.name);
    const disabled = existsSync(join(intPath, '.disabled'));
    const skillPath = join(intPath, 'skill.md');

    let displayName = entry.name;
    let description = '';
    let commandCount = 0;

    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, 'utf-8');
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const descMatch = content.match(/^description:\s*(.+)$/m);
      if (nameMatch) displayName = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();

      // Count commands
      const cmdsDir = join(intPath, 'commands');
      if (existsSync(cmdsDir)) {
        commandCount = readdirSync(cmdsDir).filter(f => f.endsWith('.md')).length;
      }
      const sourceMatch = content.match(/commands_source:\s*(.+)/);
      if (sourceMatch) {
        const source = sourceMatch[1].trim().replace(/^~/, homedir());
        for (const checkDir of [join(source, '.claude', 'commands'), join(source, 'commands')]) {
          if (existsSync(checkDir)) {
            commandCount += readdirSync(checkDir).filter(f => f.endsWith('.md')).length;
          }
        }
      }
    }

    let permCount = 0;
    const permPath = join(intPath, 'permissions.json');
    if (existsSync(permPath)) {
      try {
        const perms = JSON.parse(readFileSync(permPath, 'utf-8'));
        permCount = Array.isArray(perms) ? perms.length : 0;
      } catch { /* */ }
    }

    const status = disabled
      ? chalk.gray('○ disabled')
      : chalk.green('● active');
    const meta: string[] = [];
    if (permCount > 0) meta.push(`${permCount} perms`);
    if (commandCount > 0) meta.push(chalk.yellow(`${commandCount} cmds`));

    console.log(`  ${status}  ${chalk.bold(displayName)}${meta.length > 0 ? chalk.gray(`  (${meta.join(', ')})`) : ''}`);
    if (description) {
      console.log(`         ${chalk.gray(description)}`);
    }
  }

  console.log();
}

// ============================================================================
// Commands
// ============================================================================

export const integrateCommand = new Command('integrate')
  .description('Create or manage an integration')
  .argument('<name>', 'Integration name')
  .option('--analyze <target>', 'AI-analyze a repo/URL and generate the integration')
  .option('--source <path>', 'Link to a local tool\'s commands directory')
  .option('--disable', 'Disable this integration')
  .option('--enable', 'Re-enable this integration')
  .action(async (name: string, options: { analyze?: string; source?: string; disable?: boolean; enable?: boolean }) => {
    if (options.disable) {
      const intPath = join(INTEGRATIONS_DIR, name);
      if (!existsSync(intPath)) {
        console.error(chalk.red('Error:'), `Integration "${name}" not found`);
        process.exit(1);
      }
      writeFileSync(join(intPath, '.disabled'), '', 'utf-8');
      console.log(chalk.gray('  ○'), `Disabled: ${name}`);
      return;
    }

    if (options.enable) {
      const disabledPath = join(INTEGRATIONS_DIR, name, '.disabled');
      if (!existsSync(disabledPath)) {
        console.log(chalk.gray(`  "${name}" is already enabled or not found`));
        return;
      }
      unlinkSync(disabledPath);
      console.log(chalk.green('  ●'), `Enabled: ${name}`);
      return;
    }

    if (options.analyze) {
      await analyzeAndCreate(name, options.analyze);
      return;
    }

    // Simple scaffold
    scaffoldIntegration(name, { source: options.source });
  });

export const integrationsCommand = new Command('integrations')
  .description('List all integrations')
  .action(() => {
    listIntegrations();
  });
