/**
 * Environment Keys API
 *
 * Manages API keys stored in .env.local file.
 * Security: Never returns actual key values, only names.
 *
 * GET - List all API key names (not values)
 * POST - Add or update an API key
 * DELETE - Remove an API key
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ENV_FILE_PATH = path.join(process.cwd(), '.env.local');

/**
 * Parse .env file content into key-value pairs
 */
function parseEnvFile(content: string): Map<string, string> {
  const env = new Map<string, string>();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;

    const key = trimmed.substring(0, equalIndex).trim();
    const value = trimmed.substring(equalIndex + 1).trim();

    // Remove quotes if present
    const unquoted = value.replace(/^["']|["']$/g, '');
    env.set(key, unquoted);
  }

  return env;
}

/**
 * Serialize env map back to file content
 */
function serializeEnvFile(env: Map<string, string>): string {
  const lines: string[] = [
    '# API Keys for Virtual RF',
    '# Managed by the application - do not edit manually',
    '',
  ];

  env.forEach((value, key) => {
    // Quote values that contain spaces or special characters
    const needsQuotes = /[\s#]/.test(value);
    const quotedValue = needsQuotes ? `"${value}"` : value;
    lines.push(`${key}=${quotedValue}`);
  });

  return lines.join('\n') + '\n';
}

/**
 * Read the current .env.local file
 */
function readEnvFile(): Map<string, string> {
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      const content = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
      return parseEnvFile(content);
    }
  } catch (error) {
    console.error('[ENV Keys] Error reading .env.local:', error);
  }
  return new Map();
}

/**
 * Write the env map to .env.local file
 */
function writeEnvFile(env: Map<string, string>): void {
  const content = serializeEnvFile(env);
  fs.writeFileSync(ENV_FILE_PATH, content, 'utf-8');
}

// Common API key patterns
const KNOWN_API_KEYS = [
  { name: 'OPENAI_API_KEY', label: 'OpenAI API Key', description: 'For GPT models and embeddings' },
  { name: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', description: 'For Claude models' },
  { name: 'SERPER_API_KEY', label: 'Serper API Key', description: 'For web search capabilities' },
  { name: 'TAVILY_API_KEY', label: 'Tavily API Key', description: 'For web search and research' },
  { name: 'FIRECRAWL_API_KEY', label: 'Firecrawl API Key', description: 'For web scraping' },
  { name: 'BROWSERBASE_API_KEY', label: 'Browserbase API Key', description: 'For browser automation' },
  { name: 'EXA_API_KEY', label: 'Exa API Key', description: 'For semantic search' },
];

// ============================================================================
// GET: List all API key names
// ============================================================================

export async function GET(): Promise<NextResponse> {
  try {
    const env = readEnvFile();

    // Return key names and whether they are set (not the actual values!)
    const keys = KNOWN_API_KEYS.map(key => ({
      ...key,
      isSet: env.has(key.name) && env.get(key.name)!.length > 0,
      // Show masked preview if set (e.g., "sk-...abc")
      preview: env.has(key.name) && env.get(key.name)!.length > 0
        ? maskKey(env.get(key.name)!)
        : null,
    }));

    // Also include any custom keys not in our known list
    const knownNames = new Set(KNOWN_API_KEYS.map(k => k.name));
    const customKeys = Array.from(env.keys())
      .filter(k => !knownNames.has(k) && k.includes('API') || k.includes('KEY'))
      .map(name => ({
        name,
        label: name.replace(/_/g, ' ').replace(/API KEY/gi, 'API Key'),
        description: 'Custom API key',
        isSet: true,
        preview: maskKey(env.get(name)!),
      }));

    return NextResponse.json({
      keys: [...keys, ...customKeys],
      totalSet: keys.filter(k => k.isSet).length + customKeys.length,
    });
  } catch (error) {
    console.error('[ENV Keys] Error listing keys:', error);
    return NextResponse.json(
      { error: 'Failed to list API keys' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST: Add or update an API key
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, value } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Key name is required' },
        { status: 400 }
      );
    }

    if (!value || typeof value !== 'string') {
      return NextResponse.json(
        { error: 'Key value is required' },
        { status: 400 }
      );
    }

    // Validate key name format (uppercase, underscores, alphanumeric)
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      return NextResponse.json(
        { error: 'Key name must be uppercase with underscores (e.g., MY_API_KEY)' },
        { status: 400 }
      );
    }

    const env = readEnvFile();
    const isNew = !env.has(name);
    env.set(name, value.trim());
    writeEnvFile(env);

    // Also set in process.env for current session
    process.env[name] = value.trim();

    return NextResponse.json({
      success: true,
      message: isNew ? `Added ${name}` : `Updated ${name}`,
      preview: maskKey(value.trim()),
    });
  } catch (error) {
    console.error('[ENV Keys] Error saving key:', error);
    return NextResponse.json(
      { error: 'Failed to save API key' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE: Remove an API key
// ============================================================================

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json(
        { error: 'Key name is required' },
        { status: 400 }
      );
    }

    const env = readEnvFile();

    if (!env.has(name)) {
      return NextResponse.json(
        { error: 'Key not found' },
        { status: 404 }
      );
    }

    env.delete(name);
    writeEnvFile(env);

    // Also remove from process.env
    delete process.env[name];

    return NextResponse.json({
      success: true,
      message: `Removed ${name}`,
    });
  } catch (error) {
    console.error('[ENV Keys] Error removing key:', error);
    return NextResponse.json(
      { error: 'Failed to remove API key' },
      { status: 500 }
    );
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Mask an API key for safe display
 * e.g., "sk-abc123xyz" -> "sk-...xyz"
 */
function maskKey(key: string): string {
  if (key.length <= 8) {
    return '***';
  }

  // Keep first 3-4 chars if they look like a prefix, otherwise just start
  const prefixMatch = key.match(/^([a-z]{2,4}[-_])/i);
  const prefix = prefixMatch ? prefixMatch[1] : key.substring(0, 3);
  const suffix = key.substring(key.length - 4);

  return `${prefix}...${suffix}`;
}
