'use client';

export interface SystemStatusProps {
  activeAgents: number;
  todayCost: number;
  skillsLoaded: number;
  recentActivity?: string;
}

export function SystemStatus({
  activeAgents,
  todayCost,
  skillsLoaded,
  recentActivity,
}: SystemStatusProps): JSX.Element {
  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-bg-secondary border-t border-border px-6 py-3 z-50">
      <div className="max-w-6xl mx-auto flex items-center justify-between text-sm">
        {/* Left: Stats */}
        <div className="flex items-center gap-6 text-text-secondary">
          <span>
            <span className="text-text-primary font-medium">{activeAgents}</span> agent
            {activeAgents !== 1 ? 's' : ''} active
          </span>
          <span>
            Today: $<span className="text-text-primary font-medium">{todayCost.toFixed(2)}</span>
          </span>
          <span>
            <span className="text-text-primary font-medium">{skillsLoaded}</span> skill
            {skillsLoaded !== 1 ? 's' : ''} loaded
          </span>
        </div>

        {/* Right: Recent activity */}
        {recentActivity && (
          <div className="text-text-tertiary text-xs truncate max-w-md">Recent: {recentActivity}</div>
        )}
      </div>
    </footer>
  );
}
