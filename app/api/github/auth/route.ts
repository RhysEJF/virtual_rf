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
 * Initiate GitHub auth login - returns URL for user to open
 */
export async function POST(): Promise<NextResponse> {
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

    // Start the device flow to get a code and URL
    // gh auth login with --web outputs the URL and code to stderr
    try {
      // Use device flow which gives us a code to display
      const result = execSync(
        'gh auth login --git-protocol https --web 2>&1 || true',
        {
          encoding: 'utf-8',
          timeout: 10000,
          env: { ...process.env, GH_PROMPT_DISABLED: 'true' },
        }
      );

      // Parse the output for the URL and code
      // Output looks like: "! First copy your one-time code: XXXX-XXXX"
      // "Press Enter to open github.com in your browser..."
      const codeMatch = result.match(/code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
      const code = codeMatch ? codeMatch[1] : null;

      if (code) {
        return NextResponse.json({
          success: true,
          authUrl: 'https://github.com/login/device',
          code: code,
          message: `Enter code ${code} at github.com/login/device`,
        });
      }

      // If already authenticated or other case
      if (result.includes('Logged in') || result.includes('already logged in')) {
        return NextResponse.json({
          success: true,
          alreadyAuthenticated: true,
          message: 'Already authenticated with GitHub',
        });
      }

      // Fallback - just direct them to the device page
      return NextResponse.json({
        success: true,
        authUrl: 'https://github.com/login/device',
        manualSteps: true,
        message: 'Open github.com/login/device and run "gh auth login" in terminal',
      });
    } catch (cmdError) {
      console.error('[GitHub Auth] Command error:', cmdError);
      // Fallback approach
      return NextResponse.json({
        success: true,
        authUrl: 'https://github.com/login/device',
        manualSteps: true,
        message: 'Open the link and run "gh auth login" in your terminal to complete setup',
      });
    }
  } catch (error) {
    console.error('[GitHub Auth] Error initiating login:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initiate GitHub login' },
      { status: 500 }
    );
  }
}
