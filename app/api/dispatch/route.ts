/**
 * Dispatch API Route
 *
 * Main entry point for user requests. Classifies and routes to appropriate handler.
 * Uses Claude Code CLI (your existing subscription) - no API costs.
 *
 * Smart Dispatcher: Checks for matching outcomes before creating new ones.
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatch, type DispatchResult } from '@/lib/agents/dispatcher';
import { executeQuick } from '@/lib/agents/quick-executor';
import { generateBrief } from '@/lib/agents/briefer';
import { executeResearch, formatResearchPlan } from '@/lib/agents/research-handler';
import { isClaudeAvailable, claudeComplete } from '@/lib/claude/client';
import { createTask } from '@/lib/db/tasks';
import { createOutcome, getActiveOutcomes } from '@/lib/db/outcomes';
import { logOutcomeCreated } from '@/lib/db/activity';
import type { IsolationMode } from '@/lib/db/schema';

type ModeHint = 'smart' | 'quick' | 'long';

interface DispatchRequest {
  input: string;
  modeHint?: ModeHint; // User can override AI classification
  projectContext?: string; // For interventions on existing projects
  skipMatching?: boolean; // Skip outcome matching (user explicitly wants new)
  isolationMode?: IsolationMode; // 'workspace' (isolated) or 'codebase' (can modify main)
}

interface MatchedOutcome {
  id: string;
  name: string;
  brief: string | null;
  confidence: 'high' | 'medium';
  reason: string;
}

interface DispatchResponse {
  type: DispatchResult['type'] | 'outcome' | 'match_found';
  response?: string;
  questions?: string[];
  projectId?: string; // Deprecated, use outcomeId
  outcomeId?: string;
  navigateTo?: string;
  error?: string;
  // For match_found type
  matchedOutcomes?: MatchedOutcome[];
  originalInput?: string;
}

/**
 * Check if user input might relate to existing active outcomes
 */
async function checkForMatchingOutcomes(input: string): Promise<MatchedOutcome[] | null> {
  try {
    const activeOutcomes = getActiveOutcomes();

    // No active outcomes to match against
    if (activeOutcomes.length === 0) {
      return null;
    }

    // Build context for Claude
    const outcomesContext = activeOutcomes.map(o => {
      let intentSummary = o.brief || '';
      if (o.intent) {
        try {
          const parsed = JSON.parse(o.intent);
          intentSummary = parsed.summary || intentSummary;
        } catch {
          // Use brief
        }
      }
      return `- ID: ${o.id}\n  Name: "${o.name}"\n  About: ${intentSummary.substring(0, 200)}`;
    }).join('\n\n');

    const prompt = `You are helping route user requests to the right place.

ACTIVE OUTCOMES (existing projects):
${outcomesContext}

USER'S NEW REQUEST:
"${input}"

Does this request clearly relate to any of the existing outcomes above?

Rules:
- Only match if there's a CLEAR relationship (same topic, follow-up work, refinement, bug fix, etc.)
- Do NOT match if it's just vaguely similar or in the same general domain
- When in doubt, return empty matches (user can always choose to create new)

Respond with ONLY valid JSON (no markdown):
{
  "matches": [
    {
      "outcomeId": "the_id",
      "confidence": "high or medium",
      "reason": "brief explanation of why this matches"
    }
  ]
}

Return empty matches array [] if no clear relationship exists.`;

    const result = await claudeComplete({ prompt, timeout: 30000 });

    // Parse response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const matches = parsed.matches || [];

    if (matches.length === 0) return null;

    // Enrich matches with outcome details
    const enrichedMatches: MatchedOutcome[] = [];
    for (const match of matches) {
      const outcome = activeOutcomes.find(o => o.id === match.outcomeId);
      if (outcome) {
        enrichedMatches.push({
          id: outcome.id,
          name: outcome.name,
          brief: outcome.brief,
          confidence: match.confidence || 'medium',
          reason: match.reason || 'Potentially related',
        });
      }
    }

    return enrichedMatches.length > 0 ? enrichedMatches : null;

  } catch (error) {
    console.error('[Smart Dispatcher] Matching error:', error);
    // On error, proceed without matching (don't block the user)
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<DispatchResponse>> {
  try {
    const body = (await request.json()) as DispatchRequest;
    const { input, modeHint, skipMatching, isolationMode } = body;

    if (!input || typeof input !== 'string') {
      return NextResponse.json(
        { type: 'clarification', error: 'Input is required' },
        { status: 400 }
      );
    }

    // Check if Claude CLI is available
    const available = await isClaudeAvailable();
    if (!available) {
      return NextResponse.json(
        {
          type: 'clarification',
          error: 'Claude Code CLI not found. Make sure `claude` is installed and in your PATH.',
        },
        { status: 500 }
      );
    }

    // SMART DISPATCHER: Check for matching outcomes (unless skipped or quick mode)
    if (!skipMatching && modeHint !== 'quick') {
      const matchResult = await checkForMatchingOutcomes(input);
      if (matchResult && matchResult.length > 0) {
        return NextResponse.json({
          type: 'match_found',
          matchedOutcomes: matchResult,
          originalInput: input,
          response: `This might be related to an existing outcome. Would you like to add to one of these, or create a new outcome?`,
        });
      }
    }

    // Determine request type based on mode hint or AI classification
    let requestType: 'quick' | 'research' | 'deep' | 'clarification';
    let clarifyingQuestions: string[] | undefined;

    if (modeHint === 'quick') {
      // User explicitly wants a quick response
      requestType = 'quick';
    } else if (modeHint === 'long') {
      // User explicitly wants long-running agent - treat as deep work
      requestType = 'deep';
    } else {
      // Smart mode: let AI classify
      const classification = await dispatch(input);
      requestType = classification.type;
      clarifyingQuestions = classification.clarifyingQuestions;
    }

    // Handle based on type
    switch (requestType) {
      case 'quick': {
        const result = await executeQuick(input);

        if (!result.success) {
          return NextResponse.json({
            type: 'quick',
            error: result.error || 'Quick execution failed',
          });
        }

        return NextResponse.json({
          type: 'quick',
          response: result.response,
        });
      }

      case 'research': {
        const result = await executeResearch(input, false); // Don't auto-start - let user review first

        if (!result.success) {
          return NextResponse.json({
            type: 'research',
            error: result.error || 'Failed to start research',
          });
        }

        const response = formatResearchPlan(result.plan!) + '\n\nReview the outcome and start a worker when ready.';

        return NextResponse.json({
          type: 'outcome',
          outcomeId: result.outcomeId,
          navigateTo: `/outcome/${result.outcomeId}`,
          response,
        });
      }

      case 'deep': {
        // Generate brief using Claude
        const brief = await generateBrief(input);

        if (!brief) {
          return NextResponse.json({
            type: 'deep',
            error: 'Failed to create project brief',
          });
        }

        // Create an Outcome (not a legacy Project)
        const outcome = createOutcome({
          name: brief.title,
          brief: input,
          intent: JSON.stringify({
            summary: brief.objective,
            items: brief.prd.map(item => ({
              id: item.id,
              title: item.title,
              description: item.description,
              acceptance_criteria: [],
              priority: item.priority <= 3 ? 'high' : item.priority <= 6 ? 'medium' : 'low',
              status: 'pending',
            })),
            success_criteria: brief.deliverables,
          }),
          isolation_mode: isolationMode, // Pass through isolation mode (undefined = use default)
        });

        const outcomeId = outcome.id;

        // Log activity
        logOutcomeCreated(outcomeId, brief.title);

        // Create tasks from PRD items for the worker to claim
        for (const item of brief.prd) {
          createTask({
            outcome_id: outcomeId,
            title: item.title,
            description: item.description,
            prd_context: JSON.stringify(item),
            priority: item.priority * 10, // Convert 1-10 scale to 10-100 range
          });
        }

        // Don't auto-start - let user review and start when ready
        return NextResponse.json({
          type: 'outcome',
          outcomeId: outcomeId,
          navigateTo: `/outcome/${outcomeId}`,
          response: `**Outcome Created: ${brief.title}**

**Objective:** ${brief.objective}

**Tasks:** ${brief.prd.length} tasks created

Review the outcome and start a worker when ready.`,
        });
      }

      case 'clarification': {
        const questions = clarifyingQuestions || [
          'Could you please provide more details about what you need?',
        ];

        return NextResponse.json({
          type: 'clarification',
          response: `I need a bit more information:\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
          questions,
        });
      }

      default: {
        return NextResponse.json({
          type: 'clarification',
          response: "I'm not sure how to handle that request. Could you try rephrasing it?",
        });
      }
    }
  } catch (error) {
    console.error('Dispatch error:', error);

    return NextResponse.json(
      {
        type: 'clarification',
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
