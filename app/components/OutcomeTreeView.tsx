'use client';

import { useState, useEffect } from 'react';
import { Badge } from './ui/Badge';
import { Progress } from './ui/Progress';
import type { OutcomeStatus } from '@/lib/db/schema';

// Simple chevron icons
function ChevronRight({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9,6 15,12 9,18" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6,9 12,15 18,9" />
    </svg>
  );
}

/**
 * Tree node type matching the API response
 */
export interface OutcomeTreeNode {
  id: string;
  name: string;
  status: OutcomeStatus;
  is_ongoing: boolean;
  brief: string | null;
  parent_id: string | null;
  depth: number;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  pending_tasks: number;
  completed_tasks: number;
  total_tasks: number;
  active_workers: number;
  is_converging: boolean;
  children: OutcomeTreeNode[];
  child_count: number;
}

interface OutcomeTreeViewProps {
  outcomes: OutcomeTreeNode[];
  onOutcomeClick: (outcomeId: string) => void;
  onStartWorker?: (outcomeId: string) => void;
  onPause?: (outcomeId: string) => void;
  filterStatus?: 'all' | 'active' | 'dormant' | 'achieved';
}

const EXPAND_STATE_KEY = 'virtualrf_tree_expand_state';

const statusConfig: Record<
  OutcomeStatus,
  { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }
> = {
  active: { label: 'Active', variant: 'success' },
  dormant: { label: 'Dormant', variant: 'warning' },
  achieved: { label: 'Achieved', variant: 'success' },
  archived: { label: 'Archived', variant: 'default' },
};

/**
 * Recursive tree node component
 */
function TreeNode({
  node,
  expandedIds,
  onToggle,
  onOutcomeClick,
  onStartWorker,
  onPause,
}: {
  node: OutcomeTreeNode;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onOutcomeClick: (id: string) => void;
  onStartWorker?: (id: string) => void;
  onPause?: (id: string) => void;
}): JSX.Element {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const status = statusConfig[node.status];
  const hasWorkers = node.active_workers > 0;
  const isActive = node.status === 'active';
  const isLeaf = !hasChildren;

  // Calculate aggregated progress for parent nodes
  const calculateAggregatedStats = (n: OutcomeTreeNode): { total: number; completed: number; workers: number } => {
    let total = n.total_tasks;
    let completed = n.completed_tasks;
    let workers = n.active_workers;

    for (const child of n.children) {
      const childStats = calculateAggregatedStats(child);
      total += childStats.total;
      completed += childStats.completed;
      workers += childStats.workers;
    }

    return { total, completed, workers };
  };

  const aggregated = hasChildren ? calculateAggregatedStats(node) : null;
  const displayTotal = aggregated ? aggregated.total : node.total_tasks;
  const displayCompleted = aggregated ? aggregated.completed : node.completed_tasks;
  const displayWorkers = aggregated ? aggregated.workers : node.active_workers;
  const progressPercent = displayTotal > 0 ? (displayCompleted / displayTotal) * 100 : 0;

  // Format last activity
  const lastActivity = new Date(node.last_activity_at);
  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - lastActivity.getTime()) / 60000);
  let activityText = 'Just now';
  if (diffMinutes > 60 * 24) {
    activityText = `${Math.floor(diffMinutes / (60 * 24))}d ago`;
  } else if (diffMinutes > 60) {
    activityText = `${Math.floor(diffMinutes / 60)}h ago`;
  } else if (diffMinutes > 0) {
    activityText = `${diffMinutes}m ago`;
  }

  // Depth conventions
  const getDepthLabel = (depth: number): string | null => {
    if (depth === 0 && hasChildren) return 'Strategy';
    if (depth === 1 && hasChildren) return 'Product';
    return null;
  };
  const depthLabel = getDepthLabel(node.depth);

  return (
    <div className="select-none">
      {/* Node Row */}
      <div
        className="group flex items-center gap-2 p-2 rounded-lg hover:bg-bg-secondary cursor-pointer transition-colors"
        style={{ paddingLeft: `${node.depth * 24 + 8}px` }}
      >
        {/* Expand/Collapse Toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        ) : (
          <div className="w-5 h-5 flex items-center justify-center">
            <div
              className={`w-2 h-2 rounded-full ${
                hasWorkers ? 'bg-status-success animate-pulse' :
                isActive ? 'bg-accent' :
                node.status === 'dormant' ? 'bg-status-warning' :
                'bg-text-tertiary'
              }`}
            />
          </div>
        )}

        {/* Main Content - Clickable */}
        <div
          className="flex-1 min-w-0 flex items-center gap-3"
          onClick={() => onOutcomeClick(node.id)}
        >
          {/* Name */}
          <span className="text-sm font-medium text-text-primary truncate">
            {node.name}
          </span>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {depthLabel && (
              <span className="text-[10px] text-text-tertiary px-1.5 py-0.5 rounded bg-bg-tertiary">
                {depthLabel}
              </span>
            )}
            {hasChildren && (
              <span className="text-[10px] text-text-tertiary">
                {node.children.length} {node.children.length === 1 ? 'child' : 'children'}
              </span>
            )}
            <Badge variant={status.variant} className="text-[10px]">
              {status.label}
            </Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-text-tertiary flex-shrink-0">
          {displayTotal > 0 && (
            <span>
              <span className="text-text-secondary">{displayCompleted}</span>
              /{displayTotal} tasks
            </span>
          )}
          {displayWorkers > 0 && (
            <span>
              <span className="text-text-secondary">{displayWorkers}</span> worker{displayWorkers !== 1 ? 's' : ''}
            </span>
          )}
          <span className="w-16 text-right">{activityText}</span>
        </div>

        {/* Quick Actions - only for leaf nodes */}
        {isLeaf && isActive && !hasWorkers && node.pending_tasks > 0 && onStartWorker && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartWorker(node.id);
            }}
            className="opacity-0 group-hover:opacity-100 text-xs text-accent hover:text-accent-hover transition-opacity"
          >
            Start
          </button>
        )}
      </div>

      {/* Progress Bar (inline for parent nodes) */}
      {hasChildren && isExpanded && displayTotal > 0 && (
        <div
          className="pb-2"
          style={{ paddingLeft: `${node.depth * 24 + 36}px`, paddingRight: '8px' }}
        >
          <Progress value={progressPercent} className="h-1" />
        </div>
      )}

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onOutcomeClick={onOutcomeClick}
              onStartWorker={onStartWorker}
              onPause={onPause}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Outcome Tree View - displays outcomes in a hierarchical tree structure
 */
export function OutcomeTreeView({
  outcomes,
  onOutcomeClick,
  onStartWorker,
  onPause,
  filterStatus = 'all',
}: OutcomeTreeViewProps): JSX.Element {
  // Load expanded state from localStorage
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set<string>();
    try {
      const saved = localStorage.getItem(EXPAND_STATE_KEY);
      if (saved) {
        return new Set(JSON.parse(saved) as string[]);
      }
    } catch {
      // Ignore parse errors
    }
    // Default: expand all nodes
    const allIds = new Set<string>();
    const collectIds = (nodes: OutcomeTreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          allIds.add(node.id);
          collectIds(node.children);
        }
      }
    };
    collectIds(outcomes);
    return allIds;
  });

  // Save expanded state when it changes
  useEffect(() => {
    localStorage.setItem(EXPAND_STATE_KEY, JSON.stringify(Array.from(expandedIds)));
  }, [expandedIds]);

  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filter outcomes based on status
  const filterOutcomes = (nodes: OutcomeTreeNode[]): OutcomeTreeNode[] => {
    if (filterStatus === 'all') return nodes;

    return nodes.filter((node) => {
      // Include if node matches filter
      if (node.status === filterStatus) return true;
      // Include if any descendant matches filter
      if (node.children.length > 0) {
        const filteredChildren = filterOutcomes(node.children);
        return filteredChildren.length > 0;
      }
      return false;
    }).map((node) => ({
      ...node,
      children: filterOutcomes(node.children),
    }));
  };

  const filteredOutcomes = filterOutcomes(outcomes);

  if (filteredOutcomes.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-text-secondary mb-2">
          {filterStatus === 'all'
            ? "No outcomes yet."
            : `No ${filterStatus} outcomes.`}
        </p>
        {filterStatus === 'all' && (
          <p className="text-text-tertiary text-sm">
            Start by describing what you want to achieve.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-primary overflow-hidden">
      {filteredOutcomes.map((outcome) => (
        <TreeNode
          key={outcome.id}
          node={outcome}
          expandedIds={expandedIds}
          onToggle={handleToggle}
          onOutcomeClick={onOutcomeClick}
          onStartWorker={onStartWorker}
          onPause={onPause}
        />
      ))}
    </div>
  );
}
