/**
 * Docs Command
 *
 * Manages documents attached to outcomes:
 * - flow docs <outcome-id>          - List documents
 * - flow docs add <outcome-id> <path> - Upload a document from local file
 * - flow docs paste <outcome-id> --name <name> - Paste content as document
 * - flow docs rm <outcome-id> <filename> - Delete a document
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { basename, extname } from 'path';
import { api, getBaseUrl, ApiError, NetworkError } from '../api.js';
import { addOutputFlags, handleOutput, type OutputOptions } from '../utils/flags.js';

interface DocumentInfo {
  name: string;
  filename: string;
  size: number;
  type: string;
  modified: string;
  path: string;
}

interface DocumentsResponse {
  documents: DocumentInfo[];
  count: number;
}

interface OutcomeResponse {
  outcome: {
    id: string;
    name: string;
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function padEnd(str: string, length: number): string {
  if (str.length >= length) {
    return str.substring(0, length - 1) + '…';
  }
  return str + ' '.repeat(length - str.length);
}

function handleApiError(error: unknown): never {
  if (error instanceof NetworkError) {
    console.error(chalk.red('Error:'), 'Could not connect to Flow API');
    console.error(chalk.gray('Make sure the server is running (npm run dev)'));
    process.exit(1);
  }
  if (error instanceof ApiError) {
    const body = error.body as { error?: string } | undefined;
    console.error(chalk.red('API Error:'), body?.error || error.message);
    process.exit(1);
  }
  throw error;
}

// Main command: flow docs <outcome-id>
const docsCommand = new Command('docs')
  .description('Manage documents for an outcome');

// Default action: list documents
const listSubcommand = new Command('list')
  .description('List documents for an outcome')
  .argument('<outcome-id>', 'Outcome ID');

addOutputFlags(listSubcommand);

listSubcommand.action(async (outcomeId: string, options: OutputOptions) => {
  try {
    let outcomeName = outcomeId;
    try {
      const outcomeRes = await api.get<OutcomeResponse>(`/outcomes/${outcomeId}`);
      outcomeName = outcomeRes.outcome.name;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        console.error(chalk.red('Error:'), `Outcome "${outcomeId}" not found`);
        process.exit(1);
      }
      throw error;
    }

    const response = await api.get<DocumentsResponse>(`/outcomes/${outcomeId}/documents`);
    const docs = response.documents || [];

    if (options.json || options.quiet) {
      if (handleOutput(options.json ? { outcomeId, outcomeName, documents: docs } : docs, options, `${docs.length} documents`)) return;
    }

    console.log();
    console.log(chalk.bold(`Documents (${docs.length}) - ${outcomeName}`));
    console.log(chalk.gray('─'.repeat(60)));

    if (docs.length === 0) {
      console.log(chalk.gray('  No documents found'));
      console.log();
      console.log(chalk.gray('  Upload with: flow docs add <outcome-id> <file-path>'));
    } else {
      for (const doc of docs) {
        const name = padEnd(doc.name, 30);
        const type = padEnd(doc.type, 10);
        const size = formatSize(doc.size);
        console.log(`  ${chalk.cyan(name)} ${chalk.gray(type)} ${chalk.white(size)}`);
      }
    }

    console.log();
  } catch (error) {
    handleApiError(error);
  }
});

// Subcommand: flow docs add <outcome-id> <path>
const addSubcommand = new Command('add')
  .description('Upload a local file as a document')
  .argument('<outcome-id>', 'Outcome ID')
  .argument('<file-path>', 'Path to local file');

addOutputFlags(addSubcommand);

addSubcommand.action(async (outcomeId: string, filePath: string, options: OutputOptions) => {
  try {
    if (!existsSync(filePath)) {
      console.error(chalk.red('Error:'), `File not found: ${filePath}`);
      process.exit(1);
    }

    const filename = basename(filePath);
    const ext = extname(filename).toLowerCase();

    // Read file and determine content type
    const fileBuffer = readFileSync(filePath);

    // Use the JSON paste mode for text files, multipart for binary
    const textExtensions = ['.md', '.txt', '.json', '.csv', '.html', '.htm', '.xml', '.tsv'];
    const isText = textExtensions.includes(ext);

    let result: { success: boolean; document?: DocumentInfo };

    if (isText) {
      const content = fileBuffer.toString('utf-8');
      const name = basename(filename, ext);
      result = await api.post<{ success: boolean; document?: DocumentInfo }>(`/outcomes/${outcomeId}/documents`, {
        name,
        content,
      });
    } else {
      // For binary files, use FormData upload
      const formData = new FormData();
      const blob = new Blob([fileBuffer]);
      formData.append('file', blob, filename);

      // Use raw fetch for multipart
      const url = `${getBaseUrl()}/outcomes/${outcomeId}/documents`;
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(response.status, response.statusText, body);
      }

      result = await response.json() as { success: boolean; document?: DocumentInfo };
    }

    if (options.json || options.quiet) {
      if (handleOutput(result, options, result.document?.filename)) return;
    }

    if (result.document) {
      console.log(chalk.green('Uploaded:'), result.document.filename);
      console.log(`  Type: ${result.document.type}`);
      console.log(`  Size: ${formatSize(result.document.size)}`);
    }
  } catch (error) {
    handleApiError(error);
  }
});

// Subcommand: flow docs paste <outcome-id> --name <name>
interface PasteOptions extends OutputOptions {
  name: string;
}

const pasteSubcommand = new Command('paste')
  .description('Create a document from pasted content (reads from stdin)')
  .argument('<outcome-id>', 'Outcome ID')
  .requiredOption('--name <name>', 'Document name');

addOutputFlags(pasteSubcommand);

pasteSubcommand.action(async (outcomeId: string, options: PasteOptions) => {
  try {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf-8');

    if (!content.trim()) {
      console.error(chalk.red('Error:'), 'No content received from stdin');
      process.exit(1);
    }

    const result = await api.post<{ success: boolean; document?: DocumentInfo }>(`/outcomes/${outcomeId}/documents`, {
      name: options.name,
      content,
    });

    if (options.json || options.quiet) {
      if (handleOutput(result, options, result.document?.filename)) return;
    }

    if (result.document) {
      console.log(chalk.green('Created:'), result.document.filename);
      console.log(`  Size: ${formatSize(result.document.size)}`);
    }
  } catch (error) {
    handleApiError(error);
  }
});

// Subcommand: flow docs rm <outcome-id> <filename>
const rmSubcommand = new Command('rm')
  .description('Delete a document')
  .argument('<outcome-id>', 'Outcome ID')
  .argument('<filename>', 'Filename to delete');

addOutputFlags(rmSubcommand);

rmSubcommand.action(async (outcomeId: string, filename: string, options: OutputOptions) => {
  try {
    const result = await api.delete<{ success: boolean }>(`/outcomes/${outcomeId}/documents?filename=${encodeURIComponent(filename)}`);

    if (options.json || options.quiet) {
      if (handleOutput(result, options, filename)) return;
    }

    console.log(chalk.green('Deleted:'), filename);
  } catch (error) {
    handleApiError(error);
  }
});

// Register subcommands
docsCommand.addCommand(listSubcommand);
docsCommand.addCommand(addSubcommand);
docsCommand.addCommand(pasteSubcommand);
docsCommand.addCommand(rmSubcommand);

// Default action: list when called as `flow docs <outcome-id>`
docsCommand
  .argument('[outcome-id]', 'Outcome ID (lists documents)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output')
  .action(async (outcomeId: string | undefined, _options: OutputOptions) => {
    if (!outcomeId) {
      docsCommand.help();
      return;
    }
    // Delegate to list action
    await listSubcommand.parseAsync([outcomeId], { from: 'user' });
  });

export { docsCommand };
export default docsCommand;
