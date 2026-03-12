'use client';

import { useState, useEffect, useRef } from 'react';
import { useEventStream } from '@/lib/events/hooks';
import type { FlowEvent } from '@/lib/events/types';

interface EventStreamPanelProps {
  outcomeId: string;
}

function getEventIcon(type: string): string {
  if (type.startsWith('worker.')) {
    switch (type) {
      case 'worker.started': return '▶';
      case 'worker.completed': return '✓';
      case 'worker.stopped': return '■';
      case 'worker.paused': return '⏸';
      default: return '⚙';
    }
  }
  if (type.startsWith('task.')) {
    switch (type) {
      case 'task.claimed': return '→';
      case 'task.completed': return '✓';
      case 'task.failed': return '✗';
      default: return '○';
    }
  }
  if (type.startsWith('homr.')) {
    switch (type) {
      case 'homr.observation': return '◉';
      case 'homr.escalation': return '!';
      case 'homr.discovery': return '★';
      default: return '◇';
    }
  }
  if (type.startsWith('gate.')) return '⊞';
  if (type.startsWith('experiment.')) return '⚗';
  return '•';
}

function getEventColor(type: string): string {
  if (type.startsWith('worker.')) {
    if (type === 'worker.completed') return 'text-status-success';
    if (type === 'worker.stopped' || type === 'worker.paused') return 'text-status-warning';
    return 'text-status-info';
  }
  if (type.startsWith('task.')) {
    if (type === 'task.completed') return 'text-status-success';
    if (type === 'task.failed') return 'text-status-error';
    return 'text-accent';
  }
  if (type.startsWith('homr.')) {
    if (type === 'homr.escalation') return 'text-status-warning';
    if (type === 'homr.discovery') return 'text-status-success';
    return 'text-text-secondary';
  }
  if (type.startsWith('gate.')) return 'text-status-warning';
  if (type.startsWith('experiment.')) return 'text-accent';
  return 'text-text-tertiary';
}

function getEventSummary(event: FlowEvent): string {
  const data = event.data || {};
  switch (event.type) {
    case 'worker.started': return 'Worker started';
    case 'worker.completed': return `Worker completed (${data.tasksCompleted ?? '?'} tasks)`;
    case 'worker.stopped': return `Worker stopped: ${data.reason || 'manual'}`;
    case 'worker.paused': return `Worker paused: ${data.reason || 'manual'}`;
    case 'task.claimed': return 'Task claimed';
    case 'task.completed': return 'Task completed';
    case 'task.failed': return `Task failed${data.reason ? `: ${data.reason}` : ''}`;
    case 'homr.observation': return `Observation: ${data.quality || 'analyzed'}`;
    case 'homr.escalation': return `Escalation: ${data.questionText || 'needs input'}`;
    case 'homr.discovery': return `Discovery: ${data.summary || 'new insight'}`;
    case 'gate.triggered': return `Gate: ${data.label || 'needs input'}`;
    case 'experiment.completed': {
      const kept = data.kept ? 'kept' : 'reverted';
      return `Experiment #${data.iteration}: ${kept}`;
    }
    case 'outcome.updated': return 'Outcome updated';
    default: return event.type;
  }
}

export function EventStreamPanel({ outcomeId }: EventStreamPanelProps): JSX.Element {
  const { connected, events } = useEventStream(outcomeId);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-status-success' : 'bg-status-error'}`} />
          <span className="text-xs text-text-tertiary">
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`text-xs px-2 py-0.5 rounded ${
            autoScroll ? 'bg-accent/20 text-accent' : 'bg-bg-tertiary text-text-tertiary'
          }`}
        >
          {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        </button>
      </div>

      <div ref={scrollRef} className="max-h-64 overflow-y-auto space-y-1">
        {events.length === 0 ? (
          <p className="text-text-tertiary text-sm py-4 text-center">No events yet</p>
        ) : (
          events.map((event, idx) => (
            <div key={idx} className="flex items-start gap-2 py-1 px-2 rounded hover:bg-bg-tertiary text-xs">
              <span className={`${getEventColor(event.type)} mt-0.5 w-4 text-center shrink-0`}>
                {getEventIcon(event.type)}
              </span>
              <span className="text-text-secondary flex-1 min-w-0 truncate">
                {getEventSummary(event)}
              </span>
              <span className="text-text-tertiary shrink-0">
                {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
