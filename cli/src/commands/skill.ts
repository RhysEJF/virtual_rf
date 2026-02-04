/**
 * Skill Command (singular)
 *
 * Shows the content of a specific skill by name or ID.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError, NetworkError, Skill } from '../api.js';

interface SkillShowOptions {
  json?: boolean;
  quiet?: boolean;
}

interface SkillResponse {
  skill: Skill;
  content: string;
}

const command = new Command('skill')
  .description('Show skill content')
  .argument('<name-or-id>', 'Skill name or ID')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Output path only');

export const skillCommand = command
  .action(async (nameOrId: string, options: SkillShowOptions) => {
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

export default skillCommand;
