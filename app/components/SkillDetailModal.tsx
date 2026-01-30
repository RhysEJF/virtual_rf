'use client';

import { useRouter } from 'next/navigation';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

interface SkillKeyStatus {
  allMet: boolean;
  missing: string[];
  configured: string[];
  requiredKeys: string[];
}

interface GlobalSkillData {
  id: string;
  name: string;
  category: string;
  description: string | null;
  path: string;
  usage_count: number;
  keyStatus?: SkillKeyStatus;
}

interface OutcomeSkillData {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  triggers: string[];
  description?: string;
  path: string;
  keyStatus?: SkillKeyStatus;
}

type SkillData = GlobalSkillData | OutcomeSkillData;

function isGlobalSkill(skill: SkillData): skill is GlobalSkillData {
  return 'category' in skill && 'usage_count' in skill;
}

interface SkillDetailModalProps {
  skill: SkillData;
  content: string | null;
  loading?: boolean;
  onClose: () => void;
}

export function SkillDetailModal({
  skill,
  content,
  loading = false,
  onClose,
}: SkillDetailModalProps): JSX.Element {
  const router = useRouter();
  const hasRequirements = skill.keyStatus && skill.keyStatus.requiredKeys.length > 0;
  const hasMissingKeys = skill.keyStatus && !skill.keyStatus.allMet;
  const global = isGlobalSkill(skill);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg border border-border max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border bg-bg-secondary">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold text-text-primary">{skill.name}</h2>
                {global ? (
                  <Badge>{skill.category}</Badge>
                ) : (
                  <Badge variant="info">Outcome Skill</Badge>
                )}
                {hasMissingKeys && (
                  <Badge variant="warning">Keys Missing</Badge>
                )}
              </div>
              {skill.description && (
                <p className="text-text-secondary">{skill.description}</p>
              )}
              <div className="flex items-center gap-4 mt-3 text-sm text-text-tertiary">
                {global ? (
                  <span>Used {skill.usage_count} times</span>
                ) : (
                  <span>Outcome: {skill.outcomeName}</span>
                )}
                <span className="truncate" title={skill.path}>
                  {skill.path.split('/').slice(-3).join('/')}
                </span>
              </div>
              {!global && skill.triggers.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.triggers.map((trigger, i) => (
                    <span key={i} className="text-xs text-text-tertiary bg-bg-primary px-2 py-0.5 rounded">
                      {trigger}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary transition-colors p-1"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* API Key Requirements Section */}
          {hasRequirements && (
            <div>
              <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                Required API Keys
              </h3>

              {hasMissingKeys && (
                <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <span className="text-status-warning text-lg">!</span>
                    <div>
                      <p className="text-text-primary font-medium">
                        Missing API Keys
                      </p>
                      <p className="text-text-secondary text-sm mt-1">
                        This skill requires API keys that are not configured.
                        Workers may not be able to use this skill until the keys are set up.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {skill.keyStatus!.requiredKeys.map((key) => {
                  const isConfigured = skill.keyStatus!.configured.includes(key);
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isConfigured
                          ? 'bg-status-success/5 border-status-success/30'
                          : 'bg-status-error/5 border-status-error/30'
                      }`}
                    >
                      <span className="font-mono text-sm text-text-primary">{key}</span>
                      <Badge variant={isConfigured ? 'success' : 'error'}>
                        {isConfigured ? 'Configured' : 'Missing'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Skill Content Section */}
          <div>
            <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
              Skill Instructions
            </h3>
            {loading ? (
              <div className="bg-bg-secondary rounded-lg p-4 text-text-tertiary">
                Loading skill content...
              </div>
            ) : content ? (
              <pre className="text-text-primary text-sm bg-bg-secondary p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                {content}
              </pre>
            ) : (
              <div className="bg-bg-secondary rounded-lg p-4 text-text-tertiary">
                No content available
              </div>
            )}
          </div>

          {/* File Path Section */}
          <div>
            <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
              File Location
            </h3>
            <div className="bg-bg-secondary rounded-lg p-3">
              <code className="text-text-secondary text-sm break-all">{skill.path}</code>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-bg-secondary flex items-center justify-between">
          <div className="flex gap-2">
            {hasMissingKeys && (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  router.push('/settings');
                }}
              >
                Configure API Keys
              </Button>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
