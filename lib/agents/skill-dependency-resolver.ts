/**
 * Skill Dependency Resolver
 *
 * Analyzes tasks for skill requirements and creates infrastructure tasks
 * to build missing skills before execution can proceed.
 */

import { getTasksByOutcome, createTask, getTasksWithMissingSkills } from '../db/tasks';
import { getSkillByName, getAllSkills } from '../db/skills';
import type { Task } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

export interface SkillGap {
  skillName: string;
  requiredBy: string[];  // Task IDs that need this skill
}

export interface ResolutionResult {
  gapsFound: number;
  tasksCreated: number;
  gaps: SkillGap[];
}

export interface DependencyCheckResult {
  allMet: boolean;
  missingSkills: string[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check if all skill dependencies are satisfied for an outcome
 */
export function areSkillDependenciesMet(outcomeId: string): DependencyCheckResult {
  const tasksWithMissing = getTasksWithMissingSkills(outcomeId);

  if (tasksWithMissing.length === 0) {
    return { allMet: true, missingSkills: [] };
  }

  // Collect unique missing skills
  const missingSkills = new Set<string>();
  for (const { missingSkills: missing } of tasksWithMissing) {
    for (const skill of missing) {
      missingSkills.add(skill);
    }
  }

  return {
    allMet: false,
    missingSkills: Array.from(missingSkills),
  };
}

/**
 * Resolve skill dependencies by creating infrastructure tasks for missing skills
 *
 * This function:
 * 1. Scans execution tasks for required_skills
 * 2. Finds skills that don't exist in the database
 * 3. Creates infrastructure tasks (phase: 'infrastructure', infra_type: 'skill')
 *    to build the missing skills
 */
export function resolveSkillDependencies(outcomeId: string): ResolutionResult {
  const tasks = getTasksByOutcome(outcomeId);
  const allSkills = getAllSkills();
  const skillNames = new Set(allSkills.map(s => s.name.toLowerCase()));

  // Map: skillName -> task IDs that need it
  const skillRequirements = new Map<string, string[]>();

  // Scan execution tasks for required_skills
  for (const task of tasks) {
    if (task.phase !== 'execution' || !task.required_skills) {
      continue;
    }

    try {
      const requiredSkills = JSON.parse(task.required_skills) as string[];
      for (const skillName of requiredSkills) {
        // Check if skill exists (case-insensitive)
        if (!skillNames.has(skillName.toLowerCase())) {
          const existing = skillRequirements.get(skillName) || [];
          existing.push(task.id);
          skillRequirements.set(skillName, existing);
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // Check if infrastructure tasks already exist for these skills
  const existingInfraTasks = tasks.filter(
    t => t.phase === 'infrastructure' && t.infra_type === 'skill'
  );
  const existingSkillTasks = new Set(
    existingInfraTasks.map(t => t.title.replace(/^Build skill:\s*/i, '').toLowerCase())
  );

  // Create infrastructure tasks for missing skills
  const gaps: SkillGap[] = [];
  let tasksCreated = 0;

  skillRequirements.forEach((requiredBy, skillName) => {
    // Skip if task already exists
    if (existingSkillTasks.has(skillName.toLowerCase())) {
      return;
    }

    gaps.push({ skillName, requiredBy });

    // Create infrastructure task
    createTask({
      outcome_id: outcomeId,
      title: `Build skill: ${skillName}`,
      description: `Create a new skill called "${skillName}" that is required by ${requiredBy.length} task(s).

This skill needs to be created in the skills/ directory with proper YAML frontmatter.

Required by tasks:
${requiredBy.map((id: string) => `- ${id}`).join('\n')}

Instructions:
1. Analyze the tasks that require this skill to understand its purpose
2. Create a skill file at skills/<category>/<skill-name>/SKILL.md
3. Include proper YAML frontmatter with name, description, triggers
4. Add comprehensive instructions for using this skill`,
      phase: 'infrastructure',
      infra_type: 'skill',
      priority: 50,  // High priority for infrastructure
    });

    tasksCreated++;
  });

  if (tasksCreated > 0) {
    console.log(`[SkillDependencyResolver] Created ${tasksCreated} infrastructure tasks for missing skills`);
  }

  return {
    gapsFound: gaps.length,
    tasksCreated,
    gaps,
  };
}

/**
 * Get detailed information about skill gaps for an outcome
 */
export function analyzeSkillGaps(outcomeId: string): {
  totalTasks: number;
  tasksWithDependencies: number;
  satisfiedTasks: number;
  blockedTasks: number;
  gaps: SkillGap[];
} {
  const tasks = getTasksByOutcome(outcomeId);
  const allSkills = getAllSkills();
  const skillNames = new Set(allSkills.map(s => s.name.toLowerCase()));

  let tasksWithDependencies = 0;
  let satisfiedTasks = 0;
  let blockedTasks = 0;
  const gapMap = new Map<string, string[]>();

  for (const task of tasks) {
    if (!task.required_skills) {
      continue;
    }

    tasksWithDependencies++;

    try {
      const requiredSkills = JSON.parse(task.required_skills) as string[];
      const missingForTask: string[] = [];

      for (const skillName of requiredSkills) {
        if (!skillNames.has(skillName.toLowerCase())) {
          missingForTask.push(skillName);
          const existing = gapMap.get(skillName) || [];
          existing.push(task.id);
          gapMap.set(skillName, existing);
        }
      }

      if (missingForTask.length === 0) {
        satisfiedTasks++;
      } else {
        blockedTasks++;
      }
    } catch {
      // Invalid JSON, count as satisfied (no valid dependencies)
      satisfiedTasks++;
    }
  }

  const gaps: SkillGap[] = Array.from(gapMap.entries()).map(([skillName, requiredBy]) => ({
    skillName,
    requiredBy,
  }));

  return {
    totalTasks: tasks.length,
    tasksWithDependencies,
    satisfiedTasks,
    blockedTasks,
    gaps,
  };
}
