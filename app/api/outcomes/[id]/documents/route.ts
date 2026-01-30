/**
 * Documents API Route
 *
 * GET /api/outcomes/[id]/documents - List all documents
 * POST /api/outcomes/[id]/documents - Upload or create document
 * DELETE /api/outcomes/[id]/documents?filename=xxx - Delete document
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getWorkspacePath, ensureWorkspaceExists } from '@/lib/workspace/detector';
import fs from 'fs';
import path from 'path';

interface DocumentInfo {
  name: string;
  filename: string;
  size: number;
  type: string;
  modified: string;
  path: string;
}

function getDocsPath(outcomeId: string): string {
  const workspacePath = getWorkspacePath(outcomeId);
  return path.join(workspacePath, 'docs');
}

function ensureDocsDir(outcomeId: string): string {
  ensureWorkspaceExists(outcomeId);
  const docsPath = getDocsPath(outcomeId);
  if (!fs.existsSync(docsPath)) {
    fs.mkdirSync(docsPath, { recursive: true });
  }
  return docsPath;
}

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * GET - List all documents for an outcome
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;

    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const docsPath = getDocsPath(outcomeId);

    if (!fs.existsSync(docsPath)) {
      return NextResponse.json({ documents: [], count: 0 });
    }

    const files = fs.readdirSync(docsPath);
    const documents: DocumentInfo[] = [];

    for (const filename of files) {
      const filePath = path.join(docsPath, filename);
      const stats = fs.statSync(filePath);

      if (!stats.isFile()) continue;

      const name = filename
        .replace(/\.[^/.]+$/, '')
        .replace(/-/g, ' ')
        .replace(/_/g, ' ');

      documents.push({
        name,
        filename,
        size: stats.size,
        type: getFileType(filename),
        modified: stats.mtime.toISOString(),
        path: `docs/${filename}`,
      });
    }

    // Sort by modified date, newest first
    documents.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return NextResponse.json({
      documents,
      count: documents.length,
    });
  } catch (error) {
    console.error('Error listing documents:', error);
    return NextResponse.json({ error: 'Failed to list documents' }, { status: 500 });
  }
}

/**
 * POST - Upload or create a document
 *
 * Supports two modes:
 * 1. File upload (multipart/form-data)
 * 2. Paste content (application/json with { name, content })
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;

    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const docsPath = ensureDocsDir(outcomeId);
    const contentType = request.headers.get('content-type') || '';

    // Mode 1: JSON body (paste content)
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const { name, content } = body;

      if (!name || !content) {
        return NextResponse.json(
          { error: 'Name and content are required' },
          { status: 400 }
        );
      }

      // Sanitize filename
      const sanitizedName = name
        .replace(/[^a-zA-Z0-9-_\s]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
      const filename = `${sanitizedName}.md`;
      const filePath = path.join(docsPath, filename);

      // Check for existing file
      if (fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: 'A document with this name already exists' },
          { status: 409 }
        );
      }

      fs.writeFileSync(filePath, content, 'utf-8');

      return NextResponse.json({
        success: true,
        document: {
          name: sanitizedName,
          filename,
          size: Buffer.byteLength(content, 'utf-8'),
          type: 'markdown',
          path: `docs/${filename}`,
        },
      });
    }

    // Mode 2: File upload (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      // Sanitize filename
      const originalName = file.name;
      const ext = path.extname(originalName);
      const baseName = path.basename(originalName, ext)
        .replace(/[^a-zA-Z0-9-_\s]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
      const filename = `${baseName}${ext.toLowerCase()}`;
      const filePath = path.join(docsPath, filename);

      // Check for existing file
      if (fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: 'A document with this name already exists' },
          { status: 409 }
        );
      }

      // Write file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filePath, buffer);

      return NextResponse.json({
        success: true,
        document: {
          name: baseName,
          filename,
          size: buffer.length,
          type: getFileType(filename),
          path: `docs/${filename}`,
        },
      });
    }

    return NextResponse.json(
      { error: 'Unsupported content type' },
      { status: 415 }
    );
  } catch (error) {
    console.error('Error uploading document:', error);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}

/**
 * DELETE - Remove a document
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: outcomeId } = await params;
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    const outcome = getOutcomeById(outcomeId);
    if (!outcome) {
      return NextResponse.json({ error: 'Outcome not found' }, { status: 404 });
    }

    const docsPath = getDocsPath(outcomeId);
    const filePath = path.join(docsPath, filename);

    // Prevent path traversal
    if (!filePath.startsWith(docsPath)) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    fs.unlinkSync(filePath);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
