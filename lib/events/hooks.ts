'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FlowEvent } from './types';

interface EventStreamState {
  connected: boolean;
  events: FlowEvent[];
  lastEvent: FlowEvent | null;
}

export function useEventStream(outcomeId: string | null): EventStreamState {
  const [state, setState] = useState<EventStreamState>({
    connected: false,
    events: [],
    lastEvent: null,
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;

  const connect = useCallback(() => {
    if (!outcomeId) return;

    const url = `/api/outcomes/${outcomeId}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
      reconnectAttempts.current = 0;
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as FlowEvent;
        setState(prev => ({
          ...prev,
          events: [...prev.events.slice(-99), event], // Keep last 100
          lastEvent: event,
        }));
      } catch {
        // Ignore parse errors (heartbeats, etc.)
      }
    };

    es.onerror = () => {
      es.close();
      setState(prev => ({ ...prev, connected: false }));

      // Exponential backoff reconnection
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    };
  }, [outcomeId]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return state;
}

interface OutcomeState {
  outcome: Record<string, unknown> | null;
  tasks: Record<string, unknown>[];
  workers: Record<string, unknown>[];
  escalations: Record<string, unknown>[];
  loading: boolean;
  connected: boolean;
}

export function useOutcomeState(outcomeId: string | null): OutcomeState {
  const [state, setState] = useState<OutcomeState>({
    outcome: null,
    tasks: [],
    workers: [],
    escalations: [],
    loading: true,
    connected: false,
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fallback polling function
  const fetchOutcome = useCallback(async () => {
    if (!outcomeId) return;
    try {
      const [outcomeRes, tasksRes, workersRes, escalationsRes] = await Promise.all([
        fetch(`/api/outcomes/${outcomeId}`),
        fetch(`/api/outcomes/${outcomeId}/tasks`),
        fetch(`/api/outcomes/${outcomeId}/workers`),
        fetch(`/api/outcomes/${outcomeId}/homr/escalations`),
      ]);

      const outcome = await outcomeRes.json();
      const tasks = await tasksRes.json();
      const workers = await workersRes.json();
      const escalations = await escalationsRes.json();

      setState(prev => ({
        ...prev,
        outcome,
        tasks: Array.isArray(tasks) ? tasks : tasks.tasks || [],
        workers: Array.isArray(workers) ? workers : workers.workers || [],
        escalations: Array.isArray(escalations) ? escalations : escalations.escalations || [],
        loading: false,
      }));
    } catch {
      // Silently fail, will retry
    }
  }, [outcomeId]);

  const connect = useCallback(() => {
    if (!outcomeId) return;

    // Try SSE first
    const url = `/api/outcomes/${outcomeId}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setState(prev => ({ ...prev, connected: true, loading: false }));
      reconnectAttempts.current = 0;
      // Stop polling if SSE is working
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        if (event.type === 'snapshot') {
          // Full state snapshot
          setState(prev => ({
            ...prev,
            outcome: event.data.outcome,
            tasks: event.data.tasks || [],
            workers: event.data.workers || [],
            escalations: event.data.escalations || [],
            loading: false,
          }));
        } else {
          // Delta event — refetch to get updated state
          // (simpler than maintaining local state machine)
          fetchOutcome();
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      setState(prev => ({ ...prev, connected: false }));

      // Fall back to polling
      if (!pollIntervalRef.current) {
        fetchOutcome();
        pollIntervalRef.current = setInterval(fetchOutcome, 5000);
      }

      // Try to reconnect SSE with backoff
      if (reconnectAttempts.current < 10) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    };
  }, [outcomeId, fetchOutcome]);

  useEffect(() => {
    if (!outcomeId) return;

    // Initial fetch
    fetchOutcome();
    // Try SSE connection
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [outcomeId, connect, fetchOutcome]);

  return state;
}
