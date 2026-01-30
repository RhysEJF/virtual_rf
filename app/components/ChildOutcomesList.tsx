'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Progress } from './ui/Progress';
import type { OutcomeStatus } from '@/lib/db/schema';

interface ChildOutcomeInfo {
  id: string;
  name: string;
  status: OutcomeStatus;
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  active_workers: number;
}

interface AggregatedStats {
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  active_workers: number;
  total_descendants: number;
}

interface ChildOutcomesListProps {
  children: ChildOutcomeInfo[];
  aggregatedStats: AggregatedStats | null;
  parentId: string;
  onCreateChild: () => void;
}

const statusConfig: Record<OutcomeStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  active: { label: 'Active', variant: 'success' },
  dormant: { label: 'Dormant', variant: 'warning' },
  achieved: { label: 'Achieved', variant: 'success' },
  archived: { label: 'Archived', variant: 'default' },
};

/**
 * Displays child outcomes for a parent outcome
 * Shows aggregated progress and list of children
 */
export function ChildOutcomesList({
  children,
  aggregatedStats,
  parentId,
  onCreateChild,
}: ChildOutcomesListProps): JSX.Element {
  const progressPercent = aggregatedStats && aggregatedStats.total_tasks > 0
    ? (aggregatedStats.completed_tasks / aggregatedStats.total_tasks) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Aggregated Progress */}
      {aggregatedStats && aggregatedStats.total_tasks > 0 && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Aggregated Progress</CardTitle>
            <span className="text-text-tertiary text-sm">
              Across {children.length} {children.length === 1 ? 'child' : 'children'}
              {aggregatedStats.total_descendants > children.length && (
                <> + {aggregatedStats.total_descendants - children.length} descendants</>
              )}
            </span>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Progress value={progressPercent} showLabel />
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-text-tertiary">Tasks: </span>
                <span className="text-text-primary font-medium">
                  {aggregatedStats.completed_tasks}/{aggregatedStats.total_tasks}
                </span>
              </div>
              <div>
                <span className="text-text-tertiary">Active Workers: </span>
                <span className="text-text-primary font-medium">{aggregatedStats.active_workers}</span>
              </div>
              {aggregatedStats.failed_tasks > 0 && (
                <div>
                  <span className="text-text-tertiary">Failed: </span>
                  <span className="text-status-error font-medium">{aggregatedStats.failed_tasks}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Children List */}
      <Card padding="md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Children</CardTitle>
            <Badge variant="default">{children.length}</Badge>
          </div>
          <Button variant="secondary" size="sm" onClick={onCreateChild}>
            + Add Child
          </Button>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-text-secondary text-sm mb-2">No child outcomes yet</p>
              <p className="text-text-tertiary text-xs mb-4">
                Break down this outcome into smaller, more focused outcomes
              </p>
              <Button variant="primary" size="sm" onClick={onCreateChild}>
                Create First Child
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {children.map((child) => {
                const status = statusConfig[child.status];
                const childProgress = child.total_tasks > 0
                  ? (child.completed_tasks / child.total_tasks) * 100
                  : 0;

                return (
                  <Link
                    key={child.id}
                    href={`/outcome/${child.id}`}
                    className="block p-4 rounded-lg border border-border hover:border-accent hover:bg-bg-secondary transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-text-primary font-medium">{child.name}</span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-text-tertiary mb-2">
                      <span>
                        <span className="text-text-secondary">{child.completed_tasks}</span>
                        /{child.total_tasks} tasks
                      </span>
                      {child.active_workers > 0 && (
                        <span>
                          <span className="text-text-secondary">{child.active_workers}</span>
                          {' '}worker{child.active_workers !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {child.total_tasks > 0 && (
                      <Progress value={childProgress} className="h-1.5" />
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
