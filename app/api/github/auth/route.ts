/**
 * GitHub CLI Authentication API
 *
 * POST /api/github/auth - Initiates gh auth login
 * GET /api/github/auth - Check auth status
 */

import { NextRequest, NextResponse } from 'next/server';
import { execSync, spawn } from 'child_process';

/**
 * Check GitHub CLI auth status
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Check if gh is installed
    try {
      execSync('gh --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return NextResponse.json({
        installed: false,
        authenticated: false,
        message: 'GitHub CLI (gh) is not installed',
        installUrl: 'https://cli.github.com/',
      });
    }

    // Check if authenticated
    try {
      const result = execSync('gh auth status 2>&1', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse the output to get username
      const usernameMatch = result.match(/Logged in to github\.com account (\S+)/i) ||
                           result.match(/Logged in to github\.com as (\S+)/i);
      const username = usernameMatch ? usernameMatch[1] : null;

      return NextResponse.json({
        installed: true,
        authenticated: true,
        username,
        message: `Authenticated as ${username || 'unknown'}`,
      });
    } catch {
      return NextResponse.json({
        installed: true,
        authenticated: false,
        message: 'Not authenticated with GitHub',
      });
    }
  } catch (error) {
    console.error('[GitHub Auth] Error checking status:', error);
    return NextResponse.json(
      { error: 'Failed to check GitHub auth status' },
      { status: 500 }
    );
  }
}

/**
 * Initiate GitHub auth login (opens browser)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check if gh is installed first
    try {
      execSync('gh --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return NextResponse.json({
        success: false,
        error: 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/',
      });
    }

    // Start gh auth login with web flow
    // This will open a browser automatically
    const child = spawn('gh', ['auth', 'login', '--web', '-p', 'https', '-h', 'github.com'], {
      detached: true,
      stdio: 'ignore',
    });

    // Detach so it runs independently
    child.unref();

    return NextResponse.json({
      success: true,
      message: 'Opening browser for GitHub authentication. Complete the login in your browser, then return here.',
    });
  } catch (error) {
    console.error('[GitHub Auth] Error initiating login:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initiate GitHub login' },
      { status: 500 }
    );
  }
}
