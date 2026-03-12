'use client';

interface CapabilityStatus {
  id: string;
  type: 'skill' | 'tool';
  name: string;
  exists: boolean;
}

interface TaskCapabilitiesSectionProps {
  capabilities: CapabilityStatus[];
  loadingCapabilities: boolean;
}

export function TaskCapabilitiesSection({
  capabilities,
  loadingCapabilities,
}: TaskCapabilitiesSectionProps): JSX.Element | null {
  if (capabilities.length === 0 && !loadingCapabilities) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-text-tertiary uppercase tracking-wide">
          Required Capabilities
        </label>
        {capabilities.some(c => !c.exists) && (
          <span className="text-[10px] text-status-warning flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Some capabilities need to be built
          </span>
        )}
      </div>

      {loadingCapabilities ? (
        <p className="text-text-tertiary text-sm">Loading capabilities...</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {capabilities.map((cap) => (
            <div
              key={cap.id}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                cap.exists
                  ? 'bg-status-success/10 border-status-success/30 text-status-success'
                  : 'bg-status-warning/10 border-status-warning/30 text-status-warning'
              }`}
              title={cap.exists ? `${cap.type}: ${cap.name} (ready)` : `${cap.type}: ${cap.name} (not yet built)`}
            >
              <span>
                {cap.exists ? '✓' : '⚠'}
              </span>
              <span className="text-[10px] opacity-70 uppercase">{cap.type}</span>
              <span>{cap.name}</span>
              {!cap.exists && (
                <span className="text-[10px] opacity-80">(pending)</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
