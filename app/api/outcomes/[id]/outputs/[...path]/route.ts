/**
 * Output File API Route
 *
 * GET /api/outcomes/[id]/outputs/[...path] - Get content of a specific output file
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getWorkspacePath } from '@/lib/workspace/detector';

// MIME types for common file extensions
const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
): Promise<NextResponse> {
  try {
    const { id, path: pathSegments } = await params;

    // Verify outcome exists
    const outcome = getOutcomeById(id);
    if (!outcome) {
      return NextResponse.json(
        { error: 'Outcome not found' },
        { status: 404 }
      );
    }

    // Construct file path
    const relativePath = pathSegments.join('/');
    const workspacePath = getWorkspacePath(id);
    const filePath = path.join(workspacePath, relativePath);

    // Security: ensure the path is within the workspace
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(workspacePath)) {
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 403 }
      );
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return NextResponse.json(
        { error: 'Not a file' },
        { status: 400 }
      );
    }

    // Get MIME type
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    // Check query params for format preference
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    // For text files, return content as JSON with metadata
    if (format === 'json' || (mimeType.startsWith('text/') || mimeType === 'application/json')) {
      const content = fs.readFileSync(filePath, 'utf-8');

      return NextResponse.json({
        path: relativePath,
        name: path.basename(filePath),
        mimeType,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        content,
      });
    }

    // For binary files, return the raw file
    const content = fs.readFileSync(filePath);
    return new NextResponse(content, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
      },
    });
  } catch (error) {
    console.error('Error reading output file:', error);
    return NextResponse.json(
      { error: 'Failed to read file' },
      { status: 500 }
    );
  }
}
