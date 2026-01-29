'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from '@/app/hooks/useToast';
import type { GitMode } from '@/lib/db/schema';

interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  hasRemote: boolean;
  remoteUrl: string | null;
  isClean: boolean;
  hasUncommittedChanges: boolean;
  unpushedCommits: number;
  behindRemote: number;
  aheadOfRemote: number;
  branches?: string[];
  defaultBranch?: string;
  githubCli?: {
    available: boolean;
    authenticated: boolean;
  };
}

interface GitConfig {
  working_directory: string | null;
  git_mode: GitMode;
  base_branch: string | null;
  work_branch: string | null;
  auto_commit: boolean;
  create_pr_on_complete: boolean;
}

interface Props {
  outcomeId: string;
  outcomeName: string;
  config: GitConfig;
  onUpdate: () => void;
}

const GIT_MODE_OPTIONS: { value: GitMode; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No git integration' },
  { value: 'local', label: 'Local', description: 'Commit locally, no push' },
  { value: 'branch', label: 'Branch', description: 'Work on a feature branch' },
  { value: 'worktree', label: 'Worktree', description: 'Isolated git worktree (advanced)' },
];

export function GitConfigSection({ outcomeId, outcomeName, config, onUpdate }: Props): JSX.Element {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Form state
  const [workingDirectory, setWorkingDirectory] = useState(config.working_directory || '');
  const [gitMode, setGitMode] = useState<GitMode>(config.git_mode || 'none');
  const [baseBranch, setBaseBranch] = useState(config.base_branch || '');
  const [workBranch, setWorkBranch] = useState(config.work_branch || '');
  const [autoCommit, setAutoCommit] = useState(config.auto_commit || false);
  const [createPr, setCreatePr] = useState(config.create_pr_on_complete || false);

  // Fetch git status for the working directory
  const fetchGitStatus = useCallback(async (path?: string) => {
    const targetPath = path || workingDirectory;
    if (!targetPath) return;

    setLoadingStatus(true);
    try {
      const response = await fetch(`/api/git/status?path=${encodeURIComponent(targetPath)}`);
      const data = await response.json();
      setGitStatus(data);

      // Auto-populate branch suggestions
      if (data.isRepo && !baseBranch) {
        setBaseBranch(data.defaultBranch || 'main');
      }
    } catch (error) {
      console.error('Failed to fetch git status:', error);
    } finally {
      setLoadingStatus(false);
    }
  }, [workingDirectory, baseBranch]);

  // Fetch status when expanded and have a working directory
  useEffect(() => {
    if (isExpanded && workingDirectory) {
      fetchGitStatus();
    }
  }, [isExpanded, fetchGitStatus, workingDirectory]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_directory: workingDirectory || null,
          git_mode: gitMode,
          base_branch: baseBranch || null,
          work_branch: workBranch || null,
          auto_commit: autoCommit,
          create_pr_on_complete: createPr,
        }),
      });

      if (response.ok) {
        toast({ type: 'success', message: 'Git configuration saved' });
        setIsEditing(false);
        onUpdate();
      } else {
        toast({ type: 'error', message: 'Failed to save git configuration' });
      }
    } catch (error) {
      toast({ type: 'error', message: 'Failed to save git configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset form to original values
    setWorkingDirectory(config.working_directory || '');
    setGitMode(config.git_mode || 'none');
    setBaseBranch(config.base_branch || '');
    setWorkBranch(config.work_branch || '');
    setAutoCommit(config.auto_commit || false);
    setCreatePr(config.create_pr_on_complete || false);
    setIsEditing(false);
  };

  const generateBranchName = () => {
    const slug = outcomeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);
    setWorkBranch(`outcome/${slug}`);
  };

  const isConfigured = config.git_mode !== 'none' && config.working_directory;

  return (
    <Card padding="md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Git Integration</CardTitle>
          {isConfigured ? (
            <Badge variant="success">Configured</Badge>
          ) : (
            <Badge variant="default">Not Set</Badge>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-text-tertiary hover:text-text-secondary text-sm"
        >
          {isExpanded ? '▼' : '▶'}
        </button>
      </CardHeader>
      <CardContent>
        {!isExpanded ? (
          <div className="text-sm text-text-tertiary">
            {isConfigured ? (
              <span>Mode: {config.git_mode}, Branch: {config.work_branch || 'default'}</span>
            ) : (
              <span>Click to configure git integration</span>
            )}
          </div>
        ) : isEditing ? (
          /* Edit Mode */
          <div className="space-y-4">
            {/* Working Directory */}
            <div>
              <label className="block text-xs text-text-tertiary mb-1">Working Directory</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="/path/to/workspace"
                  className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchGitStatus(workingDirectory)}
                  disabled={loadingStatus || !workingDirectory}
                >
                  {loadingStatus ? '...' : 'Check'}
                </Button>
              </div>
              {gitStatus && (
                <div className="mt-2 text-xs">
                  {gitStatus.isRepo ? (
                    <span className="text-status-success">✓ Git repository detected</span>
                  ) : (
                    <span className="text-status-warning">Not a git repository</span>
                  )}
                </div>
              )}
            </div>

            {/* Git Mode */}
            <div>
              <label className="block text-xs text-text-tertiary mb-1">Workflow Mode</label>
              <select
                value={gitMode}
                onChange={(e) => setGitMode(e.target.value as GitMode)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
              >
                {GIT_MODE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-text-tertiary mt-1">
                {GIT_MODE_OPTIONS.find(o => o.value === gitMode)?.description}
              </p>
            </div>

            {/* Branch Configuration (only for branch/worktree modes) */}
            {(gitMode === 'branch' || gitMode === 'worktree') && (
              <>
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Base Branch</label>
                  <select
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="">Select branch...</option>
                    {gitStatus?.branches?.map(branch => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))}
                    {!gitStatus?.branches?.length && (
                      <>
                        <option value="main">main</option>
                        <option value="master">master</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Work Branch</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={workBranch}
                      onChange={(e) => setWorkBranch(e.target.value)}
                      placeholder="outcome/feature-name"
                      className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                    />
                    <Button variant="ghost" size="sm" onClick={generateBranchName}>
                      Generate
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* Auto-commit option (for any mode except none) */}
            {gitMode !== 'none' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto-commit"
                  checked={autoCommit}
                  onChange={(e) => setAutoCommit(e.target.checked)}
                  className="w-4 h-4 accent-accent"
                />
                <label htmlFor="auto-commit" className="text-sm text-text-secondary">
                  Auto-commit after successful tasks
                </label>
              </div>
            )}

            {/* PR option (for branch/worktree modes with GitHub CLI) */}
            {(gitMode === 'branch' || gitMode === 'worktree') && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="create-pr"
                  checked={createPr}
                  onChange={(e) => setCreatePr(e.target.checked)}
                  className="w-4 h-4 accent-accent"
                  disabled={!gitStatus?.githubCli?.authenticated}
                />
                <label htmlFor="create-pr" className="text-sm text-text-secondary">
                  Create PR when outcome achieved
                </label>
                {gitStatus && !gitStatus.githubCli?.authenticated && (
                  <span className="text-xs text-text-tertiary">(requires gh auth)</span>
                )}
              </div>
            )}

            {/* GitHub CLI Status */}
            {gitStatus?.githubCli && (
              <div className="text-xs border-t border-border pt-3 mt-3">
                <span className="text-text-tertiary">GitHub CLI: </span>
                {gitStatus.githubCli.available ? (
                  gitStatus.githubCli.authenticated ? (
                    <span className="text-status-success">Authenticated</span>
                  ) : (
                    <span className="text-status-warning">Not authenticated (run: gh auth login)</span>
                  )
                ) : (
                  <span className="text-text-tertiary">Not installed</span>
                )}
              </div>
            )}

            {/* Save/Cancel Buttons */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          /* View Mode */
          <div className="space-y-3">
            {isConfigured ? (
              <>
                <div className="text-sm">
                  <span className="text-text-tertiary">Directory: </span>
                  <span className="text-text-secondary font-mono text-xs">{config.working_directory}</span>
                </div>
                <div className="text-sm">
                  <span className="text-text-tertiary">Mode: </span>
                  <span className="text-text-primary">{GIT_MODE_OPTIONS.find(o => o.value === config.git_mode)?.label}</span>
                </div>
                {(config.git_mode === 'branch' || config.git_mode === 'worktree') && (
                  <>
                    <div className="text-sm">
                      <span className="text-text-tertiary">Branch: </span>
                      <span className="text-text-primary">{config.work_branch || '(not set)'}</span>
                      {config.base_branch && (
                        <span className="text-text-tertiary"> → {config.base_branch}</span>
                      )}
                    </div>
                  </>
                )}
                {config.auto_commit && (
                  <div className="text-xs text-text-tertiary">Auto-commit enabled</div>
                )}
                {config.create_pr_on_complete && (
                  <div className="text-xs text-text-tertiary">Will create PR on completion</div>
                )}

                {/* Git Status */}
                {gitStatus?.isRepo && (
                  <div className="border-t border-border pt-3 mt-3 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-text-tertiary">Status:</span>
                      {gitStatus.isClean ? (
                        <span className="text-status-success">Clean</span>
                      ) : (
                        <span className="text-status-warning">
                          {gitStatus.hasUncommittedChanges ? 'Uncommitted changes' : 'Modified'}
                        </span>
                      )}
                    </div>
                    {gitStatus.unpushedCommits > 0 && (
                      <div className="text-status-info">
                        {gitStatus.unpushedCommits} unpushed commit{gitStatus.unpushedCommits !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-text-tertiary">
                Configure git integration to auto-commit work and create PRs.
              </p>
            )}

            <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
              {isConfigured ? 'Edit' : 'Configure'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
