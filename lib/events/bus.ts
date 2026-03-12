import { EventEmitter } from 'events';
import type { FlowEvent } from './types';
import { persistEvent } from './persistence';

class FlowEventBus {
  private emitter: EventEmitter;
  private persistQueue: FlowEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.startFlushTimer();
  }

  emit(event: FlowEvent): void {
    // Add timestamp if not set
    if (!event.timestamp) {
      event.timestamp = new Date().toISOString();
    }

    // Emit to in-memory subscribers
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // wildcard subscribers

    // Queue for persistence
    this.persistQueue.push(event);
  }

  subscribe(pattern: string, handler: (event: FlowEvent) => void): () => void {
    if (pattern === '*') {
      this.emitter.on('*', handler);
      return () => this.emitter.off('*', handler);
    }

    if (pattern.endsWith('.*')) {
      // Prefix matching: 'worker.*' matches 'worker.started', 'worker.completed', etc.
      const prefix = pattern.slice(0, -2);
      const wrappedHandler = (event: FlowEvent) => {
        if (event.type.startsWith(prefix + '.')) {
          handler(event);
        }
      };
      this.emitter.on('*', wrappedHandler);
      return () => this.emitter.off('*', wrappedHandler);
    }

    this.emitter.on(pattern, handler);
    return () => this.emitter.off(pattern, handler);
  }

  // Get latest event matching criteria
  getLatest(type: string, filter?: { outcomeId?: string; filter?: (e: FlowEvent) => boolean }): FlowEvent | null {
    // Search persist queue in reverse for matching event
    for (let i = this.persistQueue.length - 1; i >= 0; i--) {
      const event = this.persistQueue[i];
      if (event.type !== type) continue;
      if (filter?.outcomeId && event.outcomeId !== filter.outcomeId) continue;
      if (filter?.filter && !filter.filter(event)) continue;
      return event;
    }
    return null;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, 500);
  }

  private flush(): void {
    if (this.persistQueue.length === 0) return;
    const batch = this.persistQueue.splice(0);
    try {
      persistEvent(batch);
    } catch (err) {
      console.error('[EventBus] Failed to persist events:', err);
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this.emitter.removeAllListeners();
  }
}

let instance: FlowEventBus | null = null;

export function getEventBus(): FlowEventBus {
  if (!instance) {
    instance = new FlowEventBus();
  }
  return instance;
}

export function closeEventBus(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
