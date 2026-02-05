/**
 * System Configuration API
 *
 * GET /api/config - Get all system config values
 * PATCH /api/config - Update system config values
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllConfig, setConfig } from '@/lib/db/system-config';
import type { IsolationMode } from '@/lib/db/schema';

export async function GET(): Promise<NextResponse> {
  try {
    const config = getAllConfig();

    return NextResponse.json({
      config: {
        default_isolation_mode: config.default_isolation_mode || 'workspace',
      },
    });
  } catch (error) {
    console.error('[API] Failed to get config:', error);
    return NextResponse.json(
      { error: 'Failed to get config' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    // Validate and set each config value
    if (body.default_isolation_mode !== undefined) {
      const mode = body.default_isolation_mode as IsolationMode;
      if (mode !== 'workspace' && mode !== 'codebase') {
        return NextResponse.json(
          { error: 'Invalid isolation mode. Must be "workspace" or "codebase".' },
          { status: 400 }
        );
      }
      setConfig('default_isolation_mode', mode);
    }

    // Return updated config
    const config = getAllConfig();

    return NextResponse.json({
      success: true,
      config: {
        default_isolation_mode: config.default_isolation_mode || 'workspace',
      },
    });
  } catch (error) {
    console.error('[API] Failed to update config:', error);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}
