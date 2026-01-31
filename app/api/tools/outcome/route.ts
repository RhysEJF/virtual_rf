/**
 * Outcome Tools API Route
 *
 * GET /api/tools/outcome - List all tools across all outcomes
 * GET /api/tools/outcome?outcomeId=xxx - List tools for specific outcome
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllOutcomes } from '@/lib/db/outcomes';
import { getWorkspacePath } from '@/lib/workspace/detector';
import fs from 'fs';
import path from 'path';

interface ToolInfo {
  name: string;
  type: string;
  description?: string;
  fileName: string;
}

/**
 * Load tools from an outcome's workspace
 */
function loadToolsFromWorkspace(outcomeId: string): ToolInfo[] {
  const workspacePath = getWorkspacePath(outcomeId);
  const toolsPath = path.join(workspacePath, 'tools');

  if (!fs.existsSync(toolsPath)) {
    return [];
  }

  const tools: ToolInfo[] = [];

  try {
    const files = fs.readdirSync(toolsPath);
    // Include .ts, .js, .py, .sh files
    const toolFiles = files.filter(f =>
      f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.sh')
    );

    for (const file of toolFiles) {
      const filePath = path.join(toolsPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(file);

      // Extract name from filename
      let name = file.replace(ext, '').split('-').map(w =>
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ');

      // Determine type
      const type = ext === '.ts' || ext === '.js' ? 'typescript'
        : ext === '.py' ? 'python'
        : ext === '.sh' ? 'shell'
        : 'unknown';

      // Try to extract description from comment header
      let description: string | undefined;
      const jsDocMatch = content.match(/\/\*\*\n\s*\*\s*(.+)\n/);
      const hashCommentMatch = content.match(/^#\s*(.+)\n/m);
      const tsCommentMatch = content.match(/^\/\/\s*(.+)\n/m);

      if (jsDocMatch) {
        description = jsDocMatch[1].trim();
      } else if (hashCommentMatch) {
        description = hashCommentMatch[1].trim();
      } else if (tsCommentMatch) {
        description = tsCommentMatch[1].trim();
      }

      tools.push({ name, type, description, fileName: file });
    }
  } catch (error) {
    console.error('[Tools API] Error loading tools:', error);
  }

  return tools;
}

interface OutcomeTool {
  id: string;
  name: string;
  type: string;
  outcomeId: string;
  outcomeName: string;
  description?: string;
  path: string;
  content?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const outcomeId = searchParams.get('outcomeId');
    const includeContent = searchParams.get('includeContent') === 'true';

    const allTools: OutcomeTool[] = [];

    if (outcomeId) {
      // Get tools for specific outcome
      const tools = loadToolsFromWorkspace(outcomeId);
      const outcome = getAllOutcomes().find(o => o.id === outcomeId);

      for (const tool of tools) {
        const toolData: OutcomeTool = {
          id: `${outcomeId}:${tool.fileName}`,
          name: tool.name,
          type: tool.type,
          outcomeId,
          outcomeName: outcome?.name || outcomeId,
          description: tool.description,
          path: `workspaces/${outcomeId}/tools/${tool.fileName}`,
        };

        if (includeContent) {
          const workspacePath = getWorkspacePath(outcomeId);
          const toolPath = path.join(workspacePath, 'tools', tool.fileName);
          try {
            toolData.content = fs.readFileSync(toolPath, 'utf-8');
          } catch {
            toolData.content = undefined;
          }
        }

        allTools.push(toolData);
      }
    } else {
      // Get tools from all outcomes
      const outcomes = getAllOutcomes();
      const workspacesPath = path.join(process.cwd(), 'workspaces');

      if (fs.existsSync(workspacesPath)) {
        const dirs = fs.readdirSync(workspacesPath);

        for (const dir of dirs) {
          if (dir.startsWith('out_')) {
            const tools = loadToolsFromWorkspace(dir);
            const outcome = outcomes.find(o => o.id === dir);

            for (const tool of tools) {
              const toolData: OutcomeTool = {
                id: `${dir}:${tool.fileName}`,
                name: tool.name,
                type: tool.type,
                outcomeId: dir,
                outcomeName: outcome?.name || dir,
                description: tool.description,
                path: `workspaces/${dir}/tools/${tool.fileName}`,
              };

              if (includeContent) {
                const workspacePath = getWorkspacePath(dir);
                const toolPath = path.join(workspacePath, 'tools', tool.fileName);
                try {
                  toolData.content = fs.readFileSync(toolPath, 'utf-8');
                } catch {
                  toolData.content = undefined;
                }
              }

              allTools.push(toolData);
            }
          }
        }
      }
    }

    // Group by outcome
    const byOutcome: Record<string, OutcomeTool[]> = {};
    for (const tool of allTools) {
      if (!byOutcome[tool.outcomeName]) {
        byOutcome[tool.outcomeName] = [];
      }
      byOutcome[tool.outcomeName].push(tool);
    }

    return NextResponse.json({
      tools: allTools,
      byOutcome,
      total: allTools.length,
    });
  } catch (error) {
    console.error('Error fetching outcome tools:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outcome tools' },
      { status: 500 }
    );
  }
}
