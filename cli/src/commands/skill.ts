/**
 * Skill Command (singular)
 *
 * Manage individual skills: show content, create new skills.
 *
 * Usage:
 *   flow skill <name-or-id>     Show skill content
 *   flow skill new <name>       Create a new skill
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Skill } from '../api.js';

interface SkillShowOptions {
  json?: boolean;
  quiet?: boolean;
}

interface SkillNewOptions {
  category?: string;
  description?: string;
  outcome?: string;
  json?: boolean;
}

interface SkillResponse {
  skill: Skill;
  content: string;
}

interface CreateCapabilityResponse {
  success: boolean;
  path?: string;
  taskId?: string;
  message: string;
  type?: string;
  error?: string;
}

const command = new Command('skill')
  .description('Show or create skills');

// Subcommand: flow skill new <name>
command
  .command('new <name>')
  .description('Create a new skill')
  .option('-c, --category <category>', 'Category for the skill (e.g., research, analysis)', 'general')
  .option('-d, --description <description>', 'Description of what the skill does')
  .option('-o, --outcome <id>', 'Create skill for a specific outcome (outcome-specific)')
  .option('--json', 'Output as JSON')
  .action(async (name: string, options: SkillNewOptions) => {
    try {
      const response = await api.post<CreateCapabilityResponse>('/capabilities/create', {
        type: 'skill',
        name,
        category: options.category || 'general',
        description: options.description,
        outcome_id: options.outcome,
        create_file: true, // Direct file creation for CLI
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
      console.log(chalk.green('✓'), `Created skill: ${chalk.bold(name)}`);
      if (response.path) {
        console.log(`  Path: ${chalk.cyan(response.path)}`);
      }
      console.log();
      console.log(chalk.gray('Edit the file to add instructions.'));
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

// Default action: flow skill <name-or-id>
command
  .argument('[name-or-id]', 'Skill name or ID to show')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Output path only')
  .action(async (nameOrId: string | undefined, options: SkillShowOptions) => {
    // If no argument provided, show help
    if (!nameOrId) {
      command.help();
      return;
    }

    try {
      // First, try to get the skill by ID directly
      let skillData: SkillResponse | null = null;

      try {
        skillData = await api.get<SkillResponse>(`/skills/${nameOrId}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // If not found by ID, try to find by name
          const allSkills = await api.skills.list();
          const matchedSkill = allSkills.skills.find(
            s => s.name.toLowerCase() === nameOrId.toLowerCase() ||
                 s.name.toLowerCase().includes(nameOrId.toLowerCase())
          );

          if (matchedSkill) {
            skillData = await api.get<SkillResponse>(`/skills/${matchedSkill.id}`);
          }
        } else {
          throw error;
        }
      }

      if (!skillData) {
        console.error(chalk.red('Error:'), `Skill "${nameOrId}" not found`);
        process.exit(1);
      }

      const { skill, content } = skillData;

      // Handle JSON output
      if (options.json) {
        console.log(JSON.stringify({ skill, content }, null, 2));
        return;
      }

      // Handle quiet output (path only)
      if (options.quiet) {
        console.log(skill.path);
        return;
      }

      // Print formatted output
      console.log();
      console.log(chalk.bold(`Skill: ${skill.name}`));
      console.log(`Path: ${chalk.gray(skill.path)}`);
      if (skill.category) {
        console.log(`Category: ${chalk.cyan(skill.category)}`);
      }
      if (skill.description) {
        console.log(`Description: ${skill.description}`);
      }
      console.log();
      console.log(chalk.gray('─'.repeat(40)));
      console.log(content);
      console.log(chalk.gray('─'.repeat(40)));
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

export const skillCommand = command;
export default skillCommand;
