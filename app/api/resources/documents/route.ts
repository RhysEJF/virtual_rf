/**
 * Resources API - Documents
 *
 * GET /api/resources/documents - Get all documents across all outcomes
 */

import { NextResponse } from 'next/server';
import { getAllOutcomes } from '@/lib/db/outcomes';
import { getWorkspacePath } from '@/lib/workspace/detector';
import fs from 'fs';
import path from 'path';

function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    '.md': 'markdown',
    '.txt': 'text',
    '.pdf': 'pdf',
    '.doc': 'word',
    '.docx': 'word',
    '.json': 'json',
    '.csv': 'csv',
    '.html': 'html',
  };
  return types[ext] || 'unknown';
}

export async function GET(): Promise<NextResponse> {
  try {
    const outcomes = getAllOutcomes();

    const byOutcome: Record<string, Array<{
      id: string;
      name: string;
      outcomeId: string;
      outcomeName: string;
      path: string;
      type: string;
      size: number;
      createdAt: number;
    }>> = {};

    let total = 0;

    for (const outcome of outcomes) {
      const workspacePath = getWorkspacePath(outcome.id);
      const docsPath = path.join(workspacePath, 'docs');

      if (!fs.existsSync(docsPath)) continue;

      const files = fs.readdirSync(docsPath);
      const documents: Array<{
        id: string;
        name: string;
        outcomeId: string;
        outcomeName: string;
        path: string;
        type: string;
        size: number;
        createdAt: number;
      }> = [];

      for (const filename of files) {
        const filePath = path.join(docsPath, filename);
        try {
          const stats = fs.statSync(filePath);
          if (!stats.isFile()) continue;

          const name = filename
            .replace(/\.[^/.]+$/, '')
            .replace(/-/g, ' ')
            .replace(/_/g, ' ');

          documents.push({
            id: `${outcome.id}-${filename}`,
            name,
            outcomeId: outcome.id,
            outcomeName: outcome.name,
            path: filePath,
            type: getFileType(filename),
            size: stats.size,
            createdAt: Math.floor(stats.birthtimeMs),
          });
        } catch {
          // Skip files that can't be read
        }
      }

      if (documents.length > 0) {
        byOutcome[outcome.name] = documents;
        total += documents.length;
      }
    }

    return NextResponse.json({
      byOutcome,
      total,
    });
  } catch (error) {
    console.error('[Resources API] Failed to fetch documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}
