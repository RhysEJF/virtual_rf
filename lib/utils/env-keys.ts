/**
 * Environment Key Utilities
 *
 * Functions for checking and reading API keys from .env.local
 */

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
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;

    const key = trimmed.substring(0, equalIndex).trim();
    const value = trimmed.substring(equalIndex + 1).trim().replace(/^["']|["']$/g, '');
    env.set(key, value);
  }

  return env;
}

/**
 * Read all API keys from .env.local
 */
export function readEnvKeys(): Map<string, string> {
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      const content = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
      return parseEnvFile(content);
    }
  } catch (error) {
    console.error('[Env Keys] Error reading .env.local:', error);
  }
  return new Map();
}

/**
 * Check if a specific API key is set
 */
export function hasApiKey(keyName: string): boolean {
  const env = readEnvKeys();
  const value = env.get(keyName);
  return value !== undefined && value.length > 0;
}

/**
 * Check if any API keys are configured
 */
export function hasAnyApiKeys(): boolean {
  const env = readEnvKeys();
  let hasKeys = false;
  env.forEach((value, key) => {
    if (key.includes('API') || key.includes('KEY')) {
      if (value && value.length > 0) {
        hasKeys = true;
      }
    }
  });
  return hasKeys;
}

/**
 * Get a specific API key value (use sparingly, prefer hasApiKey for checks)
 */
export function getApiKey(keyName: string): string | undefined {
  const env = readEnvKeys();
  return env.get(keyName);
}

/**
 * List all configured API key names (not values)
 */
export function listConfiguredKeys(): string[] {
  const env = readEnvKeys();
  const keys: string[] = [];
  env.forEach((value, key) => {
    if ((key.includes('API') || key.includes('KEY')) && value && value.length > 0) {
      keys.push(key);
    }
  });
  return keys;
}

/**
 * Check which required keys are missing
 * Returns list of missing key names
 */
export function checkRequiredKeys(requiredKeys: string[]): {
  allSet: boolean;
  missing: string[];
  configured: string[];
} {
  const env = readEnvKeys();
  const missing: string[] = [];
  const configured: string[] = [];

  for (const key of requiredKeys) {
    const value = env.get(key);
    if (value && value.length > 0) {
      configured.push(key);
    } else {
      missing.push(key);
    }
  }

  return {
    allSet: missing.length === 0,
    missing,
    configured,
  };
}

/**
 * Load all env keys into process.env (call on server startup)
 */
export function loadEnvKeysIntoProcess(): void {
  const env = readEnvKeys();
  env.forEach((value, key) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
