/**
 * Improvements Analyze API Route
 *
 * GET /api/improvements/analyze - Analyze escalation patterns and return improvement proposals
 *
 * Query parameters:
 * - lookbackDays: Number of days to look back (default: 30)
 * - outcomeId: Optional - filter escalations to a specific outcome
 * - maxProposals: Maximum number of proposals to generate (default: 3)
 * - autoCreate: If 'true', automatically create outcomes from proposals
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeForImprovements,
  getImprovementSummary,
  type AnalysisResult,
  type EscalationCluster,
  type ImprovementProposal,
} from '@/lib/agents/improvement-analyzer';

interface ClusterSummary {
  id: string;
  rootCause: string;
  patternDescription: string;
  problemStatement: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  escalationCount: number;
  /** Unique trigger_types from escalations in this cluster - needed for API calls */
  triggerTypes: string[];
}

interface ProposalSummary {
  clusterId: string;
  rootCause: string;
  escalationCount: number;
  problemSummary: string;
  outcomeName: string;
  proposedTasks: Array<{
    title: string;
    description: string;
    priority: number;
  }>;
  intent: {
    summary: string;
    itemCount: number;
    successCriteria: string[];
  };
  approach: {
    summary: string;
    stepCount: number;
    risks: string[];
  };
}

interface AnalyzeResponse {
  success: boolean;
  escalationsAnalyzed: number;
  clusters: ClusterSummary[];
  proposals: ProposalSummary[];
  outcomesCreated?: Array<{ id: string; name: string }>;
  analyzedAt: number;
  message: string;
}

function formatCluster(cluster: EscalationCluster): ClusterSummary {
  // Extract unique trigger_types from escalations in this cluster
  const triggerTypes = Array.from(new Set(cluster.escalations.map(e => e.trigger_type)));

  return {
    id: cluster.id,
    rootCause: cluster.rootCause,
    patternDescription: cluster.patternDescription,
    problemStatement: cluster.problemStatement,
    severity: cluster.severity,
    escalationCount: cluster.escalations.length,
    triggerTypes,
  };
}

function formatProposal(proposal: ImprovementProposal): ProposalSummary {
  return {
    clusterId: proposal.cluster.id,
    rootCause: proposal.cluster.rootCause,
    escalationCount: proposal.cluster.escalations.length,
    problemSummary: proposal.cluster.problemStatement,
    outcomeName: proposal.outcomeName,
    proposedTasks: proposal.tasks,
    intent: {
      summary: proposal.intent.summary,
      itemCount: proposal.intent.items.length,
      successCriteria: proposal.intent.success_criteria,
    },
    approach: {
      summary: proposal.approach.summary,
      stepCount: proposal.approach.steps.length,
      risks: proposal.approach.risks,
    },
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const lookbackDays = parseInt(searchParams.get('lookbackDays') || '30', 10);
    const outcomeId = searchParams.get('outcomeId') || undefined;
    const maxProposals = parseInt(searchParams.get('maxProposals') || '3', 10);
    const autoCreate = searchParams.get('autoCreate') === 'true';
    const summaryOnly = searchParams.get('summaryOnly') === 'true';

    // Validate parameters
    if (isNaN(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
      return NextResponse.json(
        { error: 'lookbackDays must be between 1 and 365' },
        { status: 400 }
      );
    }

    if (isNaN(maxProposals) || maxProposals < 1 || maxProposals > 10) {
      return NextResponse.json(
        { error: 'maxProposals must be between 1 and 10' },
        { status: 400 }
      );
    }

    // If only summary is requested, return a quick overview
    if (summaryOnly) {
      const summary = await getImprovementSummary(lookbackDays);
      return NextResponse.json({
        success: true,
        ...summary,
      });
    }

    // Run the full analysis
    const result: AnalysisResult = await analyzeForImprovements({
      lookbackDays,
      outcomeId,
      autoCreateOutcomes: autoCreate,
      maxProposals,
    });

    // Format the response
    const response: AnalyzeResponse = {
      success: true,
      escalationsAnalyzed: result.escalationsAnalyzed,
      clusters: result.clusters.map(formatCluster),
      proposals: result.proposals.map(formatProposal),
      analyzedAt: result.analyzedAt,
      message: generateMessage(result),
    };

    // Include created outcomes if auto-create was enabled
    if (autoCreate && result.outcomesCreated.length > 0) {
      response.outcomesCreated = result.outcomesCreated.map(o => ({
        id: o.id,
        name: o.name,
      }));
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error analyzing improvements:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to analyze improvements',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

function generateMessage(result: AnalysisResult): string {
  if (result.escalationsAnalyzed === 0) {
    return 'No escalations found for analysis. System is running smoothly or HOMЯ is not enabled.';
  }

  if (result.clusters.length === 0) {
    return `Analyzed ${result.escalationsAnalyzed} escalation(s) but no recurring patterns were identified.`;
  }

  if (result.proposals.length === 0) {
    return `Identified ${result.clusters.length} cluster(s) from ${result.escalationsAnalyzed} escalation(s), but could not generate improvement proposals.`;
  }

  const outcomeText = result.outcomesCreated.length > 0
    ? ` Created ${result.outcomesCreated.length} improvement outcome(s).`
    : '';

  return `Analyzed ${result.escalationsAnalyzed} escalation(s), identified ${result.clusters.length} pattern cluster(s), and generated ${result.proposals.length} improvement proposal(s).${outcomeText}`;
}
