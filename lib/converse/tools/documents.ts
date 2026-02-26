/**
 * Document Tools
 *
 * Tools for managing documents attached to outcomes.
 * Documents are stored in ~/flow-data/workspaces/{outcomeId}/docs/
 */

import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { getOutcomeById } from '../../db/outcomes';
import { paths } from '../../config/paths';

interface DocumentInfo {
  name: string;
  filename: string;
  size: number;
  type: string;
  modified: string;
}

function getDocsPath(outcomeId: string): string {
  return join(paths.workspaces, outcomeId, 'docs');
}

function getFileType(filename: string): string {
  const ext = extname(filename).toLowerCase();
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

// =========================================================================
// List Documents
// =========================================================================

export interface ListDocumentsResult {
  success: boolean;
  documents: DocumentInfo[];
  count: number;
  error?: string;
}

export function listDocuments(outcomeId: string): ListDocumentsResult {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { success: false, documents: [], count: 0, error: `Outcome not found: ${outcomeId}` };
  }

  const docsPath = getDocsPath(outcomeId);
  if (!existsSync(docsPath)) {
    return { success: true, documents: [], count: 0 };
  }

  const documents: DocumentInfo[] = [];

  try {
    const files = readdirSync(docsPath).filter(f => !f.startsWith('.'));
    for (const filename of files) {
      const filePath = join(docsPath, filename);
      try {
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;

        documents.push({
          name: filename.replace(/\.[^/.]+$/, '').replace(/-/g, ' ').replace(/_/g, ' '),
          filename,
          size: stat.size,
          type: getFileType(filename),
          modified: stat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }
  } catch {
    return { success: false, documents: [], count: 0, error: 'Failed to read documents directory' };
  }

  documents.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  return { success: true, documents, count: documents.length };
}

// =========================================================================
// Save Document
// =========================================================================

export interface SaveDocumentResult {
  success: boolean;
  document?: DocumentInfo;
  error?: string;
}

export function saveDocument(
  outcomeId: string,
  name: string,
  content: string
): SaveDocumentResult {
  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return { success: false, error: `Outcome not found: ${outcomeId}` };
  }

  const docsPath = getDocsPath(outcomeId);

  // Ensure docs directory exists
  if (!existsSync(docsPath)) {
    const workspacePath = join(paths.workspaces, outcomeId);
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    mkdirSync(docsPath, { recursive: true });
  }

  // Sanitize filename
  const sanitizedName = name
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  const filename = `${sanitizedName}.md`;
  const filePath = join(docsPath, filename);

  if (existsSync(filePath)) {
    return { success: false, error: `A document named "${filename}" already exists` };
  }

  try {
    writeFileSync(filePath, content, 'utf-8');

    return {
      success: true,
      document: {
        name: sanitizedName,
        filename,
        size: Buffer.byteLength(content, 'utf-8'),
        type: 'markdown',
        modified: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save document',
    };
  }
}
