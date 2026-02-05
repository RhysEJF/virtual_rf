/**
 * Capability Command
 *
 * Unified capability management: detect, create, and list capabilities (skills/tools).
 *
 * Usage:
 *   flow capability detect <outcome-id>                 Detect capabilities from outcome approach
 *   flow capability create <type> <name> --outcome <id> Create a capability task
 *   flow capability list [--outcome <id>]               List all capabilities
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError } from '../api.js';

// ============================================================================
// Types
// ============================================================================

interface DetectedCapability {
  type: 'skill' | 'tool';
  name: string;
  path: string;
  description: string;
  source: 'explicit' | 'pattern' | 'natural';
}

interface ExistingCapability {
  type: 'skill' | 'tool';
  name: string;
  path: string;
  id?: string;
}

interface DetectResponse {
  success: boolean;
  suggested: DetectedCapability[];
  existing: ExistingCapability[];
  skillReferences: string[];
  summary: {
    suggestedCount: number;
    existingCount: number;
    referencesCount: number;
  };
}

interface GlobalSkill {
  id: string;
  name: string;
  category: string;
  description: string | null;
  path: string;
  usageCount: number;
}

interface ListResponse {
  success: boolean;
  globalSkills: GlobalSkill[];
  outcomeSkills: Array<{ name: string; path: string }>;
  outcomeTools: Array<{ name: string; path: string }>;
  summary: {
    globalSkillsCount: number;
    outcomeSkillsCount: number;
    outcomeToolsCount: number;
    totalCount: number;
  };
}

interface CreateResponse {
  success: boolean;
  taskId?: string;
  path?: string;
  message: string;
  type?: string;
  error?: string;
}

interface DesignDoc {
  id: string;
  outcome_id: string;
  version: number;
  approach: string;
  created_at: number;
  updated_at: number;
}

interface OutcomeResponse {
  outcome: {
    id: string;
    name: string;
    design_doc?: DesignDoc | null;
  };
}

interface DetectOptions {
  text?: string;
  json?: boolean;
}

interface ListOptions {
  outcome?: string;
  json?: boolean;
}

interface CreateOptions {
  outcome: string;
  description?: string;
  file?: boolean;
  json?: boolean;
}

// ============================================================================
// Command Definition
// ============================================================================

const command = new Command('capability')
  .alias('cap')
  .description('Manage capabilities (skills and tools)');

// ============================================================================
// Subcommand: detect
// ============================================================================

command
  .command('detect <outcome-id>')
  .description('Detect capabilities from an outcome\'s approach or custom text')
  .option('-t, --text <text>', 'Custom text to analyze (instead of outcome approach)')
  .option('--json', 'Output as JSON')
  .action(async (outcomeId: string, options: DetectOptions) => {
    try {
      let textToAnalyze = options.text;

      // If no custom text, fetch the outcome's approach
      if (!textToAnalyze) {
        try {
          const outcome = await api.get<OutcomeResponse>(`/outcomes/${outcomeId}`);
          const designDoc = outcome.outcome.design_doc;

          if (!designDoc || !designDoc.approach) {
            console.error(chalk.yellow('Warning:'), 'Outcome has no approach/design doc to analyze');
            console.error(chalk.gray('Optimize the approach first or provide custom text with --text'));
            process.exit(1);
          }
          textToAnalyze = designDoc.approach;
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            console.error(chalk.red('Error:'), `Outcome "${outcomeId}" not found`);
            process.exit(1);
          }
          throw error;
        }
      }

      const response = await api.post<DetectResponse>('/capabilities/detect', {
        text: textToAnalyze,
        outcome_id: outcomeId,
      });

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      // Format output
      console.log();
      console.log(chalk.bold('Capability Detection Results'));
      console.log(chalk.gray('─'.repeat(40)));

      if (response.suggested.length === 0) {
        console.log(chalk.gray('No new capabilities detected.'));
      } else {
        console.log();
        console.log(chalk.bold(`Suggested Capabilities (${response.suggested.length}):`));
        for (const cap of response.suggested) {
          const typeIcon = cap.type === 'skill' ? '📚' : '🔧';
          console.log(`  ${typeIcon} ${chalk.cyan(cap.name)}`);
          console.log(`     Path: ${chalk.gray(cap.path)}`);
          console.log(`     Source: ${chalk.gray(cap.source)}`);
        }
      }

      if (response.skillReferences.length > 0) {
        console.log();
        console.log(chalk.bold(`Existing Skill References (${response.skillReferences.length}):`));
        for (const ref of response.skillReferences) {
          console.log(`  ✓ ${chalk.green(ref)}`);
        }
      }

      console.log();
      console.log(chalk.gray('Summary:'));
      console.log(`  Suggested: ${response.summary.suggestedCount}`);
      console.log(`  Existing: ${response.summary.existingCount}`);
      console.log(`  References: ${response.summary.referencesCount}`);
      console.log();

      if (response.suggested.length > 0) {
        console.log(chalk.gray('To create these capabilities, use:'));
        console.log(chalk.gray(`  flow capability create skill <name> --outcome ${outcomeId}`));
        console.log();
      }
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });

// ============================================================================
// Subcommand: list
// ============================================================================

command
  .command('list')
  .description('List all available capabilities')
  .option('-o, --outcome <id>', 'Include outcome-specific capabilities')
  .option('--json', 'Output as JSON')
  .action(async (options: ListOptions) => {
    try {
      const params = options.outcome ? `?outcome_id=${options.outcome}` : '';
      const response = await api.get<ListResponse>(`/capabilities/list${params}`);

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold('Available Capabilities'));
      console.log(chalk.gray('─'.repeat(40)));

      // Global skills
      if (response.globalSkills.length > 0) {
        console.log();
        console.log(chalk.bold(`Global Skills (${response.globalSkills.length}):`));

        // Group by category
        const byCategory = new Map<string, GlobalSkill[]>();
        for (const skill of response.globalSkills) {
          const cat = skill.category || 'uncategorized';
          if (!byCategory.has(cat)) {
            byCategory.set(cat, []);
          }
          byCategory.get(cat)!.push(skill);
        }

        for (const entry of Array.from(byCategory.entries())) {
          const [category, skills] = entry;
          console.log(`  ${chalk.cyan(category)}:`);
          for (const skill of skills) {
            const usage = skill.usageCount > 0 ? chalk.gray(` (used ${skill.usageCount}x)`) : '';
            console.log(`    📚 ${skill.name}${usage}`);
          }
        }
      }

      // Outcome skills
      if (response.outcomeSkills.length > 0) {
        console.log();
        console.log(chalk.bold(`Outcome Skills (${response.outcomeSkills.length}):`));
        for (const skill of response.outcomeSkills) {
          console.log(`  📚 ${chalk.cyan(skill.name)}`);
          console.log(`     ${chalk.gray(skill.path)}`);
        }
      }

      // Outcome tools
      if (response.outcomeTools.length > 0) {
        console.log();
        console.log(chalk.bold(`Outcome Tools (${response.outcomeTools.length}):`));
        for (const tool of response.outcomeTools) {
          console.log(`  🔧 ${chalk.cyan(tool.name)}`);
          console.log(`     ${chalk.gray(tool.path)}`);
        }
      }

      console.log();
      console.log(chalk.gray(`Total: ${response.summary.totalCount} capabilities`));
      console.log();
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });

// ============================================================================
// Subcommand: create
// ============================================================================

command
  .command('create <type> <name>')
  .description('Create a capability (skill or tool)')
  .requiredOption('-o, --outcome <id>', 'Outcome ID')
  .option('-d, --description <description>', 'Description of the capability')
  .option('--file', 'Create template file directly instead of capability task')
  .option('--json', 'Output as JSON')
  .action(async (type: string, name: string, options: CreateOptions) => {
    try {
      // Validate type
      if (!['skill', 'tool'].includes(type)) {
        console.error(chalk.red('Error:'), 'Type must be "skill" or "tool"');
        process.exit(1);
      }

      const response = await api.post<CreateResponse>('/capabilities/create', {
        type,
        name,
        outcome_id: options.outcome,
        description: options.description,
        create_file: options.file,
      });

      if (!response.success) {
        console.error(chalk.red('Error:'), response.error || response.message);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log();
      if (response.taskId) {
        console.log(chalk.green('✓'), `Created capability task: ${chalk.bold(name)}`);
        console.log(`  Task ID: ${chalk.cyan(response.taskId)}`);
        console.log();
        console.log(chalk.gray('Start a worker to build this capability:'));
        console.log(chalk.gray(`  flow start ${options.outcome}`));
      } else if (response.path) {
        console.log(chalk.green('✓'), `Created ${type} template: ${chalk.bold(name)}`);
        console.log(`  Path: ${chalk.cyan(response.path)}`);
        console.log();
        console.log(chalk.gray('Edit the file to add content.'));
      } else {
        console.log(chalk.green('✓'), response.message);
      }
      console.log();
    } catch (error) {
      if (error instanceof NetworkError) {
        console.error(chalk.red('Error:'), 'Could not connect to Digital Twin API');
        console.error(chalk.gray('Make sure the server is running (npm run dev)'));
        process.exit(1);
      }
      if (error instanceof ApiError) {
        console.error(chalk.red('API Error:'), error.message);
        process.exit(1);
      }
      throw error;
    }
  });

// ============================================================================
// Default action: show help
// ============================================================================

command.action(() => {
  command.help();
});

export const capabilityCommand = command;
export default capabilityCommand;
