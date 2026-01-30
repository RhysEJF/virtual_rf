/**
 * Outcome Skills API Route
 *
 * GET /api/skills/outcome - List all skills across all outcomes
 * GET /api/skills/outcome?outcomeId=xxx - List skills for specific outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSkillContent } from '@/lib/agents/skill-builder';
import { getAllOutcomes } from '@/lib/db/outcomes';
import { getWorkspacePath } from '@/lib/workspace/detector';
import fs from 'fs';
import path from 'path';

interface SkillInfo {
  name: string;
  triggers: string[];
  description?: string;
  fileName: string;
}

/**
 * Load skills from an outcome's workspace, handling files with or without frontmatter
 */
function loadSkillsFromWorkspace(outcomeId: string): SkillInfo[] {
  const workspacePath = getWorkspacePath(outcomeId);
  const skillsPath = path.join(workspacePath, 'skills');

  if (!fs.existsSync(skillsPath)) {
    return [];
  }

  const skills: SkillInfo[] = [];

  try {
    const files = fs.readdirSync(skillsPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const filePath = path.join(skillsPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Try to parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let name = file.replace('.md', '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      let triggers: string[] = [];
      let description: string | undefined;

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];

        // Parse name
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        if (nameMatch) name = nameMatch[1].trim();

        // Parse triggers
        const triggersMatch = frontmatter.match(/triggers:\n((?:\s+-\s+.+\n?)*)/);
        if (triggersMatch) {
          const triggerLines = triggersMatch[1].split('\n');
          for (const line of triggerLines) {
            const triggerMatch = line.match(/^\s+-\s+(.+)/);
            if (triggerMatch) triggers.push(triggerMatch[1].trim());
          }
        }

        // Parse description
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        if (descMatch) description = descMatch[1].trim();
      } else {
        // No frontmatter - extract name from first heading
        const headingMatch = content.match(/^#\s+(.+)/m);
        if (headingMatch) {
          name = headingMatch[1].trim();
        }

        // Extract description from Purpose section
        const purposeMatch = content.match(/## Purpose\n\n([^\n]+)/);
        if (purposeMatch) {
          description = purposeMatch[1].trim().substring(0, 200);
          if (description.length === 200) description += '...';
        }

        // Generate triggers from name
        const words = name.toLowerCase().split(/\s+/);
        triggers = words.filter(w => w.length > 3 && !['skill', 'the', 'and', 'for'].includes(w));
      }

      skills.push({ name, triggers, description, fileName: file });
    }
  } catch (error) {
    console.error('[Skills API] Error loading skills:', error);
  }

  return skills;
}

interface OutcomeSkill {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  triggers: string[];
  description?: string;
  path: string;
  content?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const outcomeId = searchParams.get('outcomeId');
    const includeContent = searchParams.get('includeContent') === 'true';

    const allSkills: OutcomeSkill[] = [];

    if (outcomeId) {
      // Get skills for specific outcome
      const skills = loadSkillsFromWorkspace(outcomeId);
      const outcome = getAllOutcomes().find(o => o.id === outcomeId);

      for (const skill of skills) {
        const skillData: OutcomeSkill = {
          id: `${outcomeId}:${skill.fileName.replace('.md', '')}`,
          name: skill.name,
          outcomeId,
          outcomeName: outcome?.name || outcomeId,
          triggers: skill.triggers,
          description: skill.description,
          path: `workspaces/${outcomeId}/skills/${skill.fileName}`,
        };

        if (includeContent) {
          skillData.content = getSkillContent(outcomeId, skill.name) || undefined;
        }

        allSkills.push(skillData);
      }
    } else {
      // Get skills from all outcomes
      const outcomes = getAllOutcomes();
      const workspacesPath = path.join(process.cwd(), 'workspaces');

      if (fs.existsSync(workspacesPath)) {
        const dirs = fs.readdirSync(workspacesPath);

        for (const dir of dirs) {
          if (dir.startsWith('out_')) {
            const skills = loadSkillsFromWorkspace(dir);
            const outcome = outcomes.find(o => o.id === dir);

            for (const skill of skills) {
              const skillData: OutcomeSkill = {
                id: `${dir}:${skill.fileName.replace('.md', '')}`,
                name: skill.name,
                outcomeId: dir,
                outcomeName: outcome?.name || dir,
                triggers: skill.triggers,
                description: skill.description,
                path: `workspaces/${dir}/skills/${skill.fileName}`,
              };

              if (includeContent) {
                skillData.content = getSkillContent(dir, skill.name) || undefined;
              }

              allSkills.push(skillData);
            }
          }
        }
      }
    }

    // Group by outcome
    const byOutcome: Record<string, OutcomeSkill[]> = {};
    for (const skill of allSkills) {
      if (!byOutcome[skill.outcomeName]) {
        byOutcome[skill.outcomeName] = [];
      }
      byOutcome[skill.outcomeName].push(skill);
    }

    return NextResponse.json({
      skills: allSkills,
      byOutcome,
      total: allSkills.length,
    });
  } catch (error) {
    console.error('Error fetching outcome skills:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outcome skills' },
      { status: 500 }
    );
  }
}
