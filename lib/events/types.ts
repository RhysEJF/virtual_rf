export interface FlowEvent {
  type: string;
  timestamp: string;
  outcomeId?: string;
  workerId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

// Specific event types
export interface WorkerStartedEvent extends FlowEvent {
  type: 'worker.started';
  workerId: string;
  outcomeId: string;
}

export interface WorkerCompletedEvent extends FlowEvent {
  type: 'worker.completed';
  workerId: string;
  outcomeId: string;
  data: { tasksCompleted: number };
}

export interface WorkerStoppedEvent extends FlowEvent {
  type: 'worker.stopped';
  workerId: string;
  outcomeId: string;
  data: { reason: string };
}

export interface WorkerPausedEvent extends FlowEvent {
  type: 'worker.paused';
  workerId: string;
  outcomeId: string;
  data: { reason: string };
}

export interface TaskClaimedEvent extends FlowEvent {
  type: 'task.claimed';
  taskId: string;
  workerId: string;
  outcomeId: string;
}

export interface TaskCompletedEvent extends FlowEvent {
  type: 'task.completed';
  taskId: string;
  workerId: string;
  outcomeId: string;
}

export interface TaskFailedEvent extends FlowEvent {
  type: 'task.failed';
  taskId: string;
  outcomeId: string;
  data: { reason?: string };
}

export interface HomrObservationEvent extends FlowEvent {
  type: 'homr.observation';
  outcomeId: string;
  taskId: string;
  data: { onTrack: boolean; alignmentScore: number; quality: string };
}

export interface HomrEscalationEvent extends FlowEvent {
  type: 'homr.escalation';
  outcomeId: string;
  data: { questionText: string; triggerType: string };
}

export interface HomrDiscoveryEvent extends FlowEvent {
  type: 'homr.discovery';
  outcomeId: string;
  data: { summary: string; scope: string; type?: string };
}

export interface GateTriggeredEvent extends FlowEvent {
  type: 'gate.triggered';
  taskId: string;
  outcomeId: string;
  data: { gateType: string; label: string };
}

export interface OutcomeUpdatedEvent extends FlowEvent {
  type: 'outcome.updated';
  outcomeId: string;
}

export interface ExperimentCompletedEvent extends FlowEvent {
  type: 'experiment.completed';
  outcomeId: string;
  taskId: string;
  data: { iteration: number; metricValue: number | null; kept: boolean; changeSummary: string | null; status?: 'accepted' | 'rejected' | 'crash' };
}

export type FlowEventType =
  | WorkerStartedEvent
  | WorkerCompletedEvent
  | WorkerStoppedEvent
  | WorkerPausedEvent
  | TaskClaimedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | HomrObservationEvent
  | HomrEscalationEvent
  | HomrDiscoveryEvent
  | GateTriggeredEvent
  | OutcomeUpdatedEvent
  | ExperimentCompletedEvent;
