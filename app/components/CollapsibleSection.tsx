'use client';

import { useState, useEffect } from 'react';

interface CollapsibleSectionProps {
  id: string;                    // For localStorage persistence
  title: string;
  badge?: string | number;       // Shows in header (e.g., "3/6")
  summary?: string;              // Preview when collapsed
  defaultExpanded?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  badge,
  summary,
  defaultExpanded = false,
  className,
  children,
}: CollapsibleSectionProps): JSX.Element {
  // Load initial state from localStorage
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`section-${id}`);
      return saved !== null ? saved === 'true' : defaultExpanded;
    }
    return defaultExpanded;
  });

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem(`section-${id}`, String(expanded));
  }, [id, expanded]);

  return (
    <div className={`border-b border-border ${className || ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-bg-secondary transition-colors"
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-text-tertiary transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
          <span className="font-medium text-text-primary">{title}</span>
          {badge !== undefined && (
            <span className="text-text-tertiary text-sm">({badge})</span>
          )}
        </div>
        {!expanded && summary && (
          <span className="text-text-tertiary text-sm truncate max-w-[200px] ml-4">
            {summary}
          </span>
        )}
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          expanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
