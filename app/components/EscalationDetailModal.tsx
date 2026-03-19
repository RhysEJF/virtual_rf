'use client';

/**
 * Escalation Detail Modal
 *
 * Shows full context for a specific escalation:
 * - The question asked
 * - Options presented
 * - Answer given (if any)
 * - Which tasks were affected
 * - Investigation context (attempts, checkpoint, observations, worker output)
 */

import { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

interface TaskSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

interface QuestionOption {
  id: string;
  label: string;
  description: string;
  implications: string;
}

interface AttemptSummary {
  attemptNumber: number;
  approachSummary: string | null;
  failureReason: string | null;
  errorOutput: string | null;
  filesModified: string[];
  durationSeconds: number | null;
  progressEntryId: number | null;
  createdAt: string;
}

interface CheckpointSummary {
  progressSummary: string | null;
  remainingWork: string | null;
  filesModified: string[];
  gitSha: string | null;
  createdAt: string;
}

interface ObservationSummary {
  alignmentScore: number;
  quality: string;
  onTrack: boolean;
  summary: string;
  drift: Array<{ type: string; description: string; severity: string }>;
  discoveries: Array<{ type: string; content: string }>;
  issues: Array<{ type: string; description: string; severity: string }>;
  createdAt: number;
}

interface InvestigationContext {
  attempts: AttemptSummary[];
  checkpoint: CheckpointSummary | null;
  observations: ObservationSummary[];
  lastWorkerOutput: string | null;
}

interface EscalationDetail {
  id: string;
  outcomeId: string;
  outcomeName: string;
  createdAt: number;
  status: 'pending' | 'answered' | 'dismissed';
  trigger: {
    type: string;
    taskId: string;
    taskTitle: string | null;
    evidence: string[];
  };
  question: {
    text: string;
    context: string;
    options: QuestionOption[];
  };
  affectedTasks: TaskSummary[];
  answer?: {
    option: string;
    optionLabel: string | null;
    context: string | null;
    answeredAt: number;
  };
  resolutionTimeMs: number | null;
  investigation?: InvestigationContext;
}

interface Props {
  escalationId: string;
  onClose: () => void;
}

const triggerTypeLabels: Record<string, string> = {
  unclear_requirement: 'Unclear Requirement',
  conflicting_info: 'Conflicting Info',
  missing_context: 'Missing Context',
  scope_ambiguity: 'Scope Ambiguity',
  technical_decision: 'Technical Decision',
  priority_conflict: 'Priority Conflict',
  dependency_unclear: 'Dependency Unclear',
  success_criteria: 'Success Criteria',
};

function formatTriggerType(triggerType: string): string {
  return triggerTypeLabels[triggerType] || triggerType.replace(/_/g, ' ');
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '< 1m';
}

function getStatusVariant(status: string): 'warning' | 'success' | 'default' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'answered':
      return 'success';
    case 'dismissed':
      return 'default';
    default:
      return 'default';
  }
}

function getTaskStatusVariant(status: string): 'warning' | 'success' | 'default' | 'error' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'running':
      return 'warning';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

function getFailureReasonColor(reason: string): string {
  if (reason.includes('timeout') || reason.includes('turn_limit')) return 'text-status-warning';
  if (reason.includes('permission')) return 'text-status-error';
  if (reason.includes('syntax') || reason.includes('runtime')) return 'text-status-error';
  return 'text-text-secondary';
}

function CollapsibleSection({ title, defaultOpen = false, badge, children }: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 bg-bg-secondary hover:bg-bg-tertiary transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <span className={`text-text-tertiary text-xs transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          <span className="text-sm font-medium text-text-primary">{title}</span>
          {badge}
        </div>
      </button>
      {open && (
        <div className="p-3 border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

function AttemptFullOutput({ progressEntryId }: { progressEntryId: number }): JSX.Element {
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchOutput = (): void => {
    if (output !== null) {
      setExpanded(!expanded);
      return;
    }
    setLoading(true);
    setExpanded(true);
    fetch(`/api/progress/${progressEntryId}/context`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.fullOutput) {
          setOutput(data.fullOutput);
        } else {
          setOutput('[No full output available]');
        }
      })
      .catch(() => setOutput('[Failed to load output]'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mt-1">
      <button
        onClick={fetchOutput}
        className="text-xs text-accent hover:text-accent/80 underline"
      >
        {loading ? 'Loading...' : expanded ? 'Hide full output' : 'View full output'}
      </button>
      {expanded && output && (
        <pre className="text-xs text-text-secondary bg-bg-secondary p-2 rounded mt-1 overflow-x-auto max-h-48 overflow-y-auto font-mono whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}

export function EscalationDetailModal({ escalationId, onClose }: Props): JSX.Element {
  const [data, setData] = useState<EscalationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetail(): Promise<void> {
      try {
        const response = await fetch(`/api/insights/escalations/${escalationId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch escalation details');
        }
        const detail = await response.json();
        setData(detail);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchDetail();
  }, [escalationId]);

  // Handle escape key to close modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const inv = data?.investigation;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-primary rounded-lg border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-bg-primary border-b border-border p-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-text-primary">
            Escalation Detail
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading && (
            <div className="text-center py-8">
              <p className="text-text-tertiary">Loading details...</p>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-status-error">{error}</p>
            </div>
          )}

          {data && (
            <div className="space-y-6">
              {/* Status & Metadata */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getStatusVariant(data.status)}>{data.status}</Badge>
                <Badge variant="default">{formatTriggerType(data.trigger.type)}</Badge>
                {data.resolutionTimeMs !== null && (
                  <span className="text-xs text-text-tertiary">
                    Resolved in {formatDuration(data.resolutionTimeMs)}
                  </span>
                )}
              </div>

              {/* Outcome Context */}
              <div className="text-sm text-text-secondary">
                <span className="text-text-tertiary">Outcome:</span>{' '}
                <span className="text-text-primary">{data.outcomeName}</span>
              </div>

              {/* Question Section */}
              <Card padding="md" className="border-l-4 border-l-accent-primary">
                <h3 className="font-medium text-text-primary mb-2">Question Asked</h3>
                <p className="text-text-primary mb-3">{data.question.text}</p>
                {data.question.context && (
                  <p className="text-sm text-text-secondary">{data.question.context}</p>
                )}
              </Card>

              {/* Options Section */}
              <div>
                <h3 className="font-medium text-text-primary mb-3">Options Presented</h3>
                <div className="space-y-2">
                  {data.question.options.map((option) => {
                    const isSelected = data.answer?.option === option.id;
                    return (
                      <div
                        key={option.id}
                        className={`p-3 rounded-lg border ${
                          isSelected
                            ? 'border-status-success bg-status-success/10'
                            : 'border-border'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {isSelected && (
                            <span className="text-status-success text-sm">✓</span>
                          )}
                          <span className={`font-medium ${isSelected ? 'text-status-success' : 'text-text-primary'}`}>
                            {option.label}
                          </span>
                          {isSelected && (
                            <Badge variant="success" size="sm">Selected</Badge>
                          )}
                        </div>
                        <p className="text-sm text-text-secondary ml-0">{option.description}</p>
                        <p className="text-xs text-text-muted mt-1 ml-0">{option.implications}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Answer Section */}
              {data.answer && (
                <Card padding="md" className="border-l-4 border-l-status-success">
                  <h3 className="font-medium text-text-primary mb-2">Answer Given</h3>
                  <div className="space-y-2">
                    <p className="text-text-primary">
                      <span className="text-text-tertiary">Selected:</span>{' '}
                      {data.answer.optionLabel || data.answer.option}
                    </p>
                    {data.answer.context && (
                      <div>
                        <span className="text-text-tertiary text-sm">Additional Context:</span>
                        <p className="text-text-secondary text-sm mt-1 p-2 bg-bg-tertiary rounded">
                          {data.answer.context}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-text-tertiary">
                      Answered at: {formatTimestamp(data.answer.answeredAt)}
                    </p>
                  </div>
                </Card>
              )}

              {data.status === 'dismissed' && (
                <Card padding="md" className="border-l-4 border-l-text-muted">
                  <h3 className="font-medium text-text-primary mb-2">Dismissed</h3>
                  <p className="text-sm text-text-secondary">
                    This escalation was dismissed without selecting an option.
                  </p>
                </Card>
              )}

              {/* Trigger Evidence */}
              {data.trigger.evidence.length > 0 && (
                <div>
                  <h3 className="font-medium text-text-primary mb-2">Trigger Evidence</h3>
                  <Card padding="sm" className="bg-bg-tertiary">
                    <p className="text-sm text-text-tertiary mb-2">
                      From task: {data.trigger.taskTitle || data.trigger.taskId}
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      {data.trigger.evidence.map((evidence, index) => (
                        <li key={index} className="text-sm text-text-secondary">
                          {evidence}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              )}

              {/* ============================================================ */}
              {/* Investigation Context */}
              {/* ============================================================ */}
              {inv && (inv.attempts.length > 0 || inv.checkpoint || inv.observations.length > 0 || inv.lastWorkerOutput) && (
                <div>
                  <h3 className="font-medium text-text-primary mb-3">Investigation Context</h3>
                  <div className="space-y-2">

                    {/* Attempt History */}
                    {inv.attempts.length > 0 && (
                      <CollapsibleSection
                        title="Attempt History"
                        defaultOpen={true}
                        badge={<Badge variant="default" size="sm">{inv.attempts.length}</Badge>}
                      >
                        <div className="space-y-3">
                          {inv.attempts.map((attempt) => (
                            <div key={attempt.attemptNumber} className="border-l-2 border-border pl-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-text-secondary">
                                  Attempt {attempt.attemptNumber}
                                </span>
                                {attempt.failureReason && (
                                  <Badge variant="error" size="sm">{attempt.failureReason}</Badge>
                                )}
                                {attempt.durationSeconds !== null && (
                                  <span className="text-xs text-text-tertiary">
                                    {attempt.durationSeconds}s
                                  </span>
                                )}
                              </div>
                              {attempt.approachSummary && (
                                <p className="text-sm text-text-secondary mb-1">{attempt.approachSummary}</p>
                              )}
                              {attempt.errorOutput && (
                                <pre className="text-xs text-status-error bg-status-error/5 p-2 rounded mt-1 overflow-x-auto max-h-32 overflow-y-auto font-mono whitespace-pre-wrap">
                                  {attempt.errorOutput}
                                </pre>
                              )}
                              {attempt.filesModified.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {attempt.filesModified.map((f, i) => (
                                    <span key={i} className="text-[10px] bg-bg-tertiary px-1.5 py-0.5 rounded text-text-tertiary font-mono">
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {attempt.progressEntryId && (
                                <AttemptFullOutput progressEntryId={attempt.progressEntryId} />
                              )}
                            </div>
                          ))}
                        </div>
                      </CollapsibleSection>
                    )}

                    {/* Worker Progress / Checkpoint */}
                    {(inv.checkpoint || inv.lastWorkerOutput) && (
                      <CollapsibleSection title="Worker Progress">
                        {inv.checkpoint && (
                          <div className="space-y-2 mb-3">
                            {inv.checkpoint.progressSummary && (
                              <div>
                                <span className="text-xs text-text-tertiary uppercase tracking-wide">Got this far</span>
                                <p className="text-sm text-text-primary mt-1">{inv.checkpoint.progressSummary}</p>
                              </div>
                            )}
                            {inv.checkpoint.remainingWork && (
                              <div>
                                <span className="text-xs text-text-tertiary uppercase tracking-wide">Remaining work</span>
                                <p className="text-sm text-text-secondary mt-1">{inv.checkpoint.remainingWork}</p>
                              </div>
                            )}
                            {inv.checkpoint.filesModified.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {inv.checkpoint.filesModified.map((f, i) => (
                                  <span key={i} className="text-[10px] bg-bg-tertiary px-1.5 py-0.5 rounded text-text-tertiary font-mono">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                            {inv.checkpoint.gitSha && (
                              <span className="text-[10px] text-text-tertiary font-mono">
                                git: {inv.checkpoint.gitSha.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        )}
                        {inv.lastWorkerOutput && (
                          <div>
                            <span className="text-xs text-text-tertiary uppercase tracking-wide">Last Worker Output</span>
                            <pre className="text-xs text-text-secondary bg-bg-secondary p-2 rounded mt-1 overflow-x-auto max-h-48 overflow-y-auto font-mono whitespace-pre-wrap">
                              {inv.lastWorkerOutput}
                            </pre>
                          </div>
                        )}
                      </CollapsibleSection>
                    )}

                    {/* Observer Findings */}
                    {inv.observations.length > 0 && (
                      <CollapsibleSection
                        title="Observer Findings"
                        badge={<Badge variant="default" size="sm">{inv.observations.length}</Badge>}
                      >
                        <div className="space-y-3">
                          {inv.observations.map((obs, i) => (
                            <div key={i} className="border-l-2 border-border pl-3">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-text-tertiary">Alignment:</span>
                                  <span className={`text-xs font-medium ${
                                    obs.alignmentScore >= 70 ? 'text-status-success' :
                                    obs.alignmentScore >= 40 ? 'text-status-warning' :
                                    'text-status-error'
                                  }`}>
                                    {obs.alignmentScore}%
                                  </span>
                                </div>
                                <Badge
                                  variant={obs.quality === 'good' ? 'success' : obs.quality === 'needs_work' ? 'warning' : 'error'}
                                  size="sm"
                                >
                                  {obs.quality}
                                </Badge>
                                {!obs.onTrack && (
                                  <Badge variant="error" size="sm">Off Track</Badge>
                                )}
                              </div>
                              <p className="text-sm text-text-secondary">{obs.summary}</p>

                              {obs.drift.length > 0 && (
                                <div className="mt-1">
                                  <span className="text-[10px] text-text-tertiary uppercase">Drift:</span>
                                  {obs.drift.map((d, j) => (
                                    <p key={j} className="text-xs text-status-warning ml-2">
                                      [{d.severity}] {d.description}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {obs.issues.length > 0 && (
                                <div className="mt-1">
                                  <span className="text-[10px] text-text-tertiary uppercase">Issues:</span>
                                  {obs.issues.map((iss, j) => (
                                    <p key={j} className={`text-xs ml-2 ${
                                      iss.severity === 'high' ? 'text-status-error' : 'text-status-warning'
                                    }`}>
                                      [{iss.type}] {iss.description}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {obs.discoveries.length > 0 && (
                                <div className="mt-1">
                                  <span className="text-[10px] text-text-tertiary uppercase">Discoveries:</span>
                                  {obs.discoveries.map((d, j) => (
                                    <p key={j} className="text-xs text-accent ml-2">
                                      [{d.type}] {d.content}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </CollapsibleSection>
                    )}
                  </div>
                </div>
              )}

              {/* Affected Tasks */}
              <div>
                <h3 className="font-medium text-text-primary mb-2">
                  Affected Tasks ({data.affectedTasks.length})
                </h3>
                {data.affectedTasks.length === 0 ? (
                  <p className="text-sm text-text-tertiary">No tasks were affected</p>
                ) : (
                  <div className="space-y-2">
                    {data.affectedTasks.map((task) => (
                      <Card key={task.id} padding="sm" hover className="cursor-default">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-text-primary truncate">
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-xs text-text-secondary line-clamp-2 mt-1">
                                {task.description}
                              </p>
                            )}
                          </div>
                          <Badge variant={getTaskStatusVariant(task.status)} size="sm">
                            {task.status}
                          </Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Timestamps */}
              <div className="pt-4 border-t border-border text-xs text-text-tertiary">
                <p>Created: {formatTimestamp(data.createdAt)}</p>
                {data.answer && (
                  <p>Resolved: {formatTimestamp(data.answer.answeredAt)}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
