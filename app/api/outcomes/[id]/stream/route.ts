import { NextRequest } from 'next/server';
import { getEventBus } from '@/lib/events/bus';
import { getOutcomeById } from '@/lib/db/outcomes';
import { getTasksByOutcome } from '@/lib/db/tasks';
import { getWorkersByOutcome } from '@/lib/db/workers';
import { getEscalations } from '@/lib/db/homr';
import type { FlowEvent } from '@/lib/events/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: outcomeId } = await params;

  const outcome = getOutcomeById(outcomeId);
  if (!outcome) {
    return new Response('Outcome not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial snapshot
      const snapshot = {
        type: 'snapshot',
        timestamp: new Date().toISOString(),
        outcomeId,
        data: {
          outcome: getOutcomeById(outcomeId),
          tasks: getTasksByOutcome(outcomeId),
          workers: getWorkersByOutcome(outcomeId),
          escalations: getEscalations(outcomeId),
        },
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));

      // Subscribe to events for this outcome
      const bus = getEventBus();
      unsubscribe = bus.subscribe('*', (event: FlowEvent) => {
        if (event.outcomeId === outcomeId) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Stream closed
          }
        }
      });

      // Heartbeat every 15s
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Stream closed
        }
      }, 15000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  // Clean up on client disconnect
  request.signal.addEventListener('abort', () => {
    if (unsubscribe) unsubscribe();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
