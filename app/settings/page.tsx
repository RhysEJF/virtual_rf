'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { useToast } from '@/app/hooks/useToast';

interface ApiKey {
  name: string;
  label: string;
  description: string;
  isSet: boolean;
  preview: string | null;
  usedBy?: string[];
}

interface RepositoryStatus {
  pathExists: boolean;
  isGitRepo: boolean;
  detectedRemote: string | null;
  currentBranch: string;
  hasRemote: boolean;
}

interface Repository {
  id: string;
  name: string;
  type: 'private' | 'team';
  content_type: 'outputs' | 'skills' | 'tools' | 'files' | 'all';
  repo_url: string | null;
  local_path: string;
  branch: string;
  auto_push: boolean;
  require_pr: boolean;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
  status?: RepositoryStatus;
}

type IsolationMode = 'workspace' | 'codebase';

// Wrapper component to handle useSearchParams
function SettingsContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Check if we should show missing keys (coming from skills page)
  const showMissingParam = searchParams.get('showMissing');
  const highlightKeysParam = searchParams.get('highlight');
  const highlightKeys = highlightKeysParam ? highlightKeysParam.split(',') : [];

  // System config state
  const [defaultIsolationMode, setDefaultIsolationMode] = useState<IsolationMode>('workspace');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(showMissingParam === 'true');

  // GitHub auth state
  interface GitHubAuthStatus {
    installed: boolean;
    authenticated: boolean;
    username?: string;
    message: string;
    installUrl?: string;
  }
  const [githubAuth, setGithubAuth] = useState<GitHubAuthStatus | null>(null);
  const [loadingGithub, setLoadingGithub] = useState(true);
  const [connectingGithub, setConnectingGithub] = useState(false);

  const fetchApiKeys = useCallback(async () => {
    try {
      const response = await fetch('/api/env-keys');
      const data = await response.json();
      setApiKeys(data.keys || []);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  const fetchGithubAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/github/auth');
      const data = await response.json();
      setGithubAuth(data);
    } catch (error) {
      console.error('Failed to fetch GitHub auth status:', error);
    } finally {
      setLoadingGithub(false);
    }
  }, []);

  const fetchRepositories = useCallback(async () => {
    try {
      const response = await fetch('/api/repositories');
      const data = await response.json();
      setRepositories(data.repositories || []);
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const fetchSystemConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      setDefaultIsolationMode(data.config?.default_isolation_mode || 'workspace');
    } catch (error) {
      console.error('Failed to fetch system config:', error);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const updateIsolationMode = async (mode: IsolationMode) => {
    setSavingConfig(true);
    try {
      const response = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_isolation_mode: mode }),
      });
      const data = await response.json();
      if (data.success) {
        setDefaultIsolationMode(mode);
        toast({ type: 'success', message: 'Default isolation mode updated' });
      } else {
        toast({ type: 'error', message: data.error || 'Failed to update config' });
      }
    } catch (error) {
      console.error('Failed to update isolation mode:', error);
      toast({ type: 'error', message: 'Failed to update config' });
    } finally {
      setSavingConfig(false);
    }
  };

  // GitHub auth code state
  const [authCode, setAuthCode] = useState<string | null>(null);

  // Repositories state
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [showAddRepoForm, setShowAddRepoForm] = useState(false);
  const [repoFormData, setRepoFormData] = useState({
    name: '',
    type: 'private' as 'private' | 'team',
    content_type: 'all' as 'outputs' | 'skills' | 'tools' | 'files' | 'all',
    local_path: '',
    repo_url: '',
    branch: 'main',
    auto_push: true,
    require_pr: false,
  });
  const [savingRepo, setSavingRepo] = useState(false);

  const connectGithub = async () => {
    setConnectingGithub(true);
    setAuthCode(null);
    try {
      const response = await fetch('/api/github/auth', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        if (data.alreadyAuthenticated) {
          toast({ type: 'success', message: 'Already connected to GitHub' });
          fetchGithubAuth();
          setConnectingGithub(false);
          return;
        }

        // Show the code if we got one
        if (data.code) {
          setAuthCode(data.code);
        }

        // Open the auth URL in a new tab
        if (data.authUrl) {
          window.open(data.authUrl, '_blank');
        }

        toast({ type: 'info', message: data.message || 'Complete authentication in the browser' });

        // Poll for auth completion
        const pollInterval = setInterval(async () => {
          const statusRes = await fetch('/api/github/auth');
          const status = await statusRes.json();
          if (status.authenticated) {
            clearInterval(pollInterval);
            setGithubAuth(status);
            setConnectingGithub(false);
            setAuthCode(null);
            toast({ type: 'success', message: `Connected as ${status.username}` });
          }
        }, 2000);
        // Stop polling after 2 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setConnectingGithub(false);
        }, 120000);
      } else {
        toast({ type: 'error', message: data.error || 'Failed to connect GitHub' });
        setConnectingGithub(false);
      }
    } catch (error) {
      console.error('Failed to connect GitHub:', error);
      toast({ type: 'error', message: 'Failed to connect GitHub' });
      setConnectingGithub(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
    fetchGithubAuth();
    fetchRepositories();
    fetchSystemConfig();
  }, [fetchApiKeys, fetchGithubAuth, fetchRepositories, fetchSystemConfig]);

  const saveApiKey = async (name: string, value: string) => {
    setSavingKey(true);
    try {
      const response = await fetch('/api/env-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: data.message });
        setShowAddKeyForm(false);
        setEditingKey(null);
        setNewKeyName('');
        setNewKeyValue('');
        fetchApiKeys();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to save API key' });
      }
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast({ type: 'error', message: 'Failed to save API key' });
    } finally {
      setSavingKey(false);
    }
  };

  const deleteApiKey = async (name: string) => {
    if (!confirm(`Are you sure you want to remove ${name}?`)) return;

    try {
      const response = await fetch(`/api/env-keys?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: data.message });
        fetchApiKeys();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to remove API key' });
      }
    } catch (error) {
      console.error('Failed to remove API key:', error);
      toast({ type: 'error', message: 'Failed to remove API key' });
    }
  };

  const saveRepository = async () => {
    setSavingRepo(true);
    try {
      const response = await fetch('/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repoFormData),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Repository added successfully' });
        setShowAddRepoForm(false);
        setRepoFormData({
          name: '',
          type: 'private',
          content_type: 'all',
          local_path: '',
          repo_url: '',
          branch: 'main',
          auto_push: true,
          require_pr: false,
        });
        fetchRepositories();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to add repository' });
      }
    } catch (error) {
      console.error('Failed to save repository:', error);
      toast({ type: 'error', message: 'Failed to save repository' });
    } finally {
      setSavingRepo(false);
    }
  };

  const deleteRepository = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove "${name}"?`)) return;

    try {
      const response = await fetch(`/api/repositories/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: 'Repository removed' });
        fetchRepositories();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to remove repository' });
      }
    } catch (error) {
      console.error('Failed to remove repository:', error);
      toast({ type: 'error', message: 'Failed to remove repository' });
    }
  };

  // Group repositories by type
  const privateRepos = repositories.filter(r => r.type === 'private');
  const teamRepos = repositories.filter(r => r.type === 'team');

  // Count configured vs total keys
  const configuredCount = apiKeys.filter(k => k.isSet).length;
  const totalCount = apiKeys.length;

  // Filter keys based on showAllKeys toggle
  const displayedKeys = showAllKeys
    ? apiKeys
    : apiKeys.filter(k => k.isSet);

  return (
    <main className="max-w-4xl mx-auto p-6 pb-20">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/')}
          className="text-text-tertiary hover:text-text-secondary text-sm mb-4 flex items-center gap-1"
        >
          ← Back to Dashboard
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
            <p className="text-text-secondary mt-1">
              Configure API keys and system preferences
            </p>
          </div>
        </div>
      </div>

      {/* Missing Keys Notice (when coming from Skills page) */}
      {showMissingParam && highlightKeys.length > 0 && (
        <div className="mb-6 p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-status-warning text-xl">⚠</span>
            <div>
              <p className="text-text-primary font-medium">
                Skills need API keys
              </p>
              <p className="text-text-secondary text-sm mt-1">
                {highlightKeys.length} API key{highlightKeys.length !== 1 ? 's are' : ' is'} required by skills in your workspace.
                Configure them below to enable full functionality.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Section */}
      <Card padding="md" className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>API Keys</CardTitle>
            <p className="text-text-tertiary text-sm mt-1">
              {configuredCount} configured{highlightKeys.length > 0 && `, ${highlightKeys.filter(k => !apiKeys.find(ak => ak.name === k && ak.isSet)).length} needed by skills`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAllKeys(!showAllKeys)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                showAllKeys
                  ? 'bg-accent/20 text-accent'
                  : 'bg-bg-secondary text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {showAllKeys ? 'Hide Suggestions' : 'Show Suggestions'}
            </button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowAddKeyForm(!showAddKeyForm);
                setEditingKey(null);
                setNewKeyName('');
                setNewKeyValue('');
              }}
            >
              {showAddKeyForm ? 'Cancel' : '+ Add Key'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Security Notice */}
          <div className="mb-4 p-3 bg-bg-secondary rounded-lg border border-border">
            <div className="flex items-start gap-2">
              <span className="text-accent">🔒</span>
              <div className="text-sm">
                <p className="text-text-secondary">
                  Keys are stored in <code className="text-accent">.env.local</code> and never leave your machine.
                </p>
                <p className="text-text-tertiary text-xs mt-1">
                  They&apos;re passed to workers as environment variables, never through AI context.
                </p>
              </div>
            </div>
          </div>

          {/* Add Custom Key Form */}
          {showAddKeyForm && (
            <div className="mb-4 p-4 bg-bg-tertiary rounded-lg border border-border">
              <h4 className="text-sm font-medium text-text-primary mb-3">Add Custom API Key</h4>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Key Name</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    placeholder="e.g., MY_API_KEY"
                    className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Value</label>
                  <input
                    type="password"
                    value={newKeyValue}
                    onChange={(e) => setNewKeyValue(e.target.value)}
                    placeholder="Enter API key value"
                    className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveApiKey(newKeyName, newKeyValue)}
                  disabled={savingKey || !newKeyName || !newKeyValue}
                >
                  {savingKey ? 'Saving...' : 'Save Key'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddKeyForm(false);
                    setNewKeyName('');
                    setNewKeyValue('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Edit Key Form */}
          {editingKey && (
            <div className="mb-4 p-4 bg-bg-tertiary rounded-lg border border-border">
              <h4 className="text-sm font-medium text-text-primary mb-3">
                Update {editingKey}
              </h4>
              <div className="mb-3">
                <label className="block text-xs text-text-tertiary mb-1">New Value</label>
                <input
                  type="password"
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  placeholder="Enter new API key value"
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveApiKey(editingKey, newKeyValue)}
                  disabled={savingKey || !newKeyValue}
                >
                  {savingKey ? 'Saving...' : 'Update Key'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingKey(null);
                    setNewKeyValue('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Keys List */}
          {loadingKeys ? (
            <p className="text-text-tertiary text-sm">Loading API keys...</p>
          ) : (
            <div className="space-y-2">
              {displayedKeys.map((key) => {
                const isHighlighted = highlightKeys.includes(key.name);
                return (
                  <div
                    key={key.name}
                    className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                      isHighlighted && !key.isSet
                        ? 'bg-status-warning/10 border border-status-warning/30 hover:bg-status-warning/20'
                        : 'bg-bg-secondary hover:bg-bg-tertiary'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary text-sm font-medium">{key.label}</span>
                        {key.isSet ? (
                          <Badge variant="success" className="text-[10px]">Configured</Badge>
                        ) : isHighlighted ? (
                          <Badge variant="error" className="text-[10px]">Required by Skills</Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px]">Not Set</Badge>
                        )}
                      </div>
                      <div className="text-text-tertiary text-xs mt-0.5">
                        {key.description}
                      </div>
                      {key.preview && (
                        <div className="text-text-secondary text-xs font-mono mt-1">
                          {key.preview}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 ml-4">
                      <Button
                        variant={isHighlighted && !key.isSet ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => {
                          setEditingKey(key.name);
                          setNewKeyValue('');
                          setShowAddKeyForm(false);
                        }}
                      >
                        {key.isSet ? 'Update' : 'Add'}
                      </Button>
                      {key.isSet && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteApiKey(key.name)}
                          className="text-status-error hover:text-status-error hover:bg-status-error/10"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {displayedKeys.length === 0 && (
                <p className="text-text-tertiary text-sm text-center py-8">
                  {showAllKeys
                    ? 'No API keys available.'
                    : configuredCount === 0
                    ? 'No API keys configured yet. Click "Show Suggestions" to see common keys or add a custom key.'
                    : 'No configured keys to show.'}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workspace Isolation */}
      <Card padding="md" className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>Workspace Isolation</CardTitle>
            <p className="text-text-tertiary text-sm mt-1">
              Default isolation mode for new outcomes
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {loadingConfig ? (
            <p className="text-text-tertiary text-sm">Loading settings...</p>
          ) : (
            <div className="space-y-3">
              {/* Info Notice */}
              <div className="p-3 bg-bg-secondary rounded-lg border border-border">
                <div className="flex items-start gap-2">
                  <span className="text-accent">🔒</span>
                  <div className="text-sm">
                    <p className="text-text-secondary">
                      Isolation controls where workers can create and modify files.
                    </p>
                    <p className="text-text-tertiary text-xs mt-1">
                      Individual outcomes can override this default on their detail page.
                    </p>
                  </div>
                </div>
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-bg-tertiary transition-colors">
                  <input
                    type="radio"
                    name="defaultIsolationMode"
                    value="workspace"
                    checked={defaultIsolationMode === 'workspace'}
                    onChange={() => updateIsolationMode('workspace')}
                    disabled={savingConfig}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        Isolated Workspace
                      </span>
                      <Badge variant="success" className="text-[10px]">Recommended</Badge>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                      Workers can only create/modify files within{' '}
                      <code className="text-accent">workspaces/{'{outcomeId}'}/</code>.
                      Safe for building external projects, client work, or experiments.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-bg-tertiary transition-colors">
                  <input
                    type="radio"
                    name="defaultIsolationMode"
                    value="codebase"
                    checked={defaultIsolationMode === 'codebase'}
                    onChange={() => updateIsolationMode('codebase')}
                    disabled={savingConfig}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">
                        Codebase Access
                      </span>
                      <Badge variant="warning" className="text-[10px]">Advanced</Badge>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                      Workers can modify files in the main codebase (app/, lib/, etc.).
                      Use for self-improvement outcomes or internal features.
                    </p>
                  </div>
                </label>
              </div>

              {savingConfig && (
                <p className="text-xs text-text-tertiary">Saving...</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* GitHub Integration */}
      <Card padding="md" className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>GitHub Integration</CardTitle>
            <p className="text-text-tertiary text-sm mt-1">
              Connect GitHub to enable automatic PRs
            </p>
          </div>
          {githubAuth?.authenticated && (
            <Badge variant="success">Connected</Badge>
          )}
        </CardHeader>
        <CardContent>
          {loadingGithub ? (
            <p className="text-text-tertiary text-sm">Checking GitHub status...</p>
          ) : !githubAuth?.installed ? (
            <div className="space-y-3">
              <p className="text-text-secondary text-sm">
                GitHub CLI is not installed. Install it to enable automatic PR creation.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open('https://cli.github.com/', '_blank')}
              >
                Install GitHub CLI →
              </Button>
            </div>
          ) : githubAuth?.authenticated ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-lg">
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-medium">
                  {githubAuth.username?.[0]?.toUpperCase() || 'G'}
                </div>
                <div>
                  <div className="text-text-primary font-medium">{githubAuth.username}</div>
                  <div className="text-text-tertiary text-xs">Connected to GitHub</div>
                </div>
              </div>
              <p className="text-text-tertiary text-xs">
                Workers can now create PRs automatically when outcomes are achieved.
                Configure git settings per-outcome on each outcome&apos;s detail page.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-text-secondary text-sm">
                Connect your GitHub account to enable automatic PR creation when outcomes are achieved.
              </p>
              <Button
                onClick={connectGithub}
                disabled={connectingGithub}
              >
                {connectingGithub ? 'Waiting for authentication...' : 'Connect GitHub'}
              </Button>
              {connectingGithub && (
                <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                  {authCode ? (
                    <>
                      <p className="text-text-secondary text-sm mb-2">
                        Enter this code on GitHub:
                      </p>
                      <div className="text-2xl font-mono font-bold text-accent tracking-wider text-center py-2">
                        {authCode}
                      </div>
                      <p className="text-text-tertiary text-xs mt-2">
                        A browser tab should have opened. If not,{' '}
                        <a
                          href="https://github.com/login/device"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          click here
                        </a>
                        .
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-text-secondary text-sm">
                        Complete authentication in your browser.
                      </p>
                      <p className="text-text-tertiary text-xs mt-2">
                        If nothing opened, run <code className="text-accent">gh auth login</code> in your terminal.
                      </p>
                    </>
                  )}
                  <p className="text-text-tertiary text-xs mt-3">
                    This page will update automatically when complete.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Repositories Configuration */}
      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>Repositories</CardTitle>
            <p className="text-text-tertiary text-sm mt-1">
              Configure where outputs, skills, tools, and files are saved
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAddRepoForm(!showAddRepoForm)}
          >
            {showAddRepoForm ? 'Cancel' : '+ Add Repository'}
          </Button>
        </CardHeader>
        <CardContent>
          {/* Info Notice */}
          <div className="mb-4 p-3 bg-bg-secondary rounded-lg border border-border">
            <div className="flex items-start gap-2">
              <span className="text-accent">💡</span>
              <div className="text-sm">
                <p className="text-text-secondary">
                  Configure repositories to automatically save skills, tools, and files as workers build them.
                </p>
                <p className="text-text-tertiary text-xs mt-1">
                  Use &quot;Private&quot; for your personal library, &quot;Team&quot; for shared resources.
                </p>
              </div>
            </div>
          </div>

          {/* Add Repository Form */}
          {showAddRepoForm && (
            <div className="mb-4 p-4 bg-bg-tertiary rounded-lg border border-border">
              <h4 className="text-sm font-medium text-text-primary mb-3">Add Repository</h4>

              <div className="space-y-4">
                {/* Name and Type */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-tertiary mb-1">Name</label>
                    <input
                      type="text"
                      value={repoFormData.name}
                      onChange={(e) => setRepoFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., My Skills Library"
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-tertiary mb-1">Type</label>
                    <select
                      value={repoFormData.type}
                      onChange={(e) => setRepoFormData(prev => ({
                        ...prev,
                        type: e.target.value as 'private' | 'team',
                        require_pr: e.target.value === 'team' ? prev.require_pr : false,
                      }))}
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
                    >
                      <option value="private">Private (just you)</option>
                      <option value="team">Team (shared)</option>
                    </select>
                  </div>
                </div>

                {/* Content Type */}
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Content Type</label>
                  <select
                    value={repoFormData.content_type}
                    onChange={(e) => setRepoFormData(prev => ({
                      ...prev,
                      content_type: e.target.value as 'outputs' | 'skills' | 'tools' | 'files' | 'all',
                    }))}
                    className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="all">All (outputs, skills, tools, files)</option>
                    <option value="outputs">Outputs only</option>
                    <option value="skills">Skills only</option>
                    <option value="tools">Tools only</option>
                    <option value="files">Files only</option>
                  </select>
                </div>

                {/* Local Path */}
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Local Path</label>
                  <input
                    type="text"
                    value={repoFormData.local_path}
                    onChange={(e) => setRepoFormData(prev => ({ ...prev, local_path: e.target.value }))}
                    placeholder="e.g., ~/my-skills-library"
                    className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent font-mono"
                  />
                  <p className="text-text-tertiary text-xs mt-1">
                    Path to local git repository (must exist)
                  </p>
                </div>

                {/* Remote URL (optional) */}
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">Remote URL (optional)</label>
                  <input
                    type="text"
                    value={repoFormData.repo_url}
                    onChange={(e) => setRepoFormData(prev => ({ ...prev, repo_url: e.target.value }))}
                    placeholder="e.g., git@github.com:username/repo.git"
                    className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent font-mono"
                  />
                  <p className="text-text-tertiary text-xs mt-1">
                    Will be auto-detected from git config if not specified
                  </p>
                </div>

                {/* Options */}
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={repoFormData.auto_push}
                      onChange={(e) => setRepoFormData(prev => ({ ...prev, auto_push: e.target.checked }))}
                      className="rounded border-border text-accent focus:ring-accent"
                    />
                    <span className="text-sm text-text-secondary">Auto-push after save</span>
                  </label>
                  {repoFormData.type === 'team' && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={repoFormData.require_pr}
                        onChange={(e) => setRepoFormData(prev => ({ ...prev, require_pr: e.target.checked }))}
                        className="rounded border-border text-accent focus:ring-accent"
                      />
                      <span className="text-sm text-text-secondary">Require PR (vs direct push)</span>
                    </label>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  size="sm"
                  onClick={saveRepository}
                  disabled={savingRepo || !repoFormData.name || !repoFormData.local_path}
                >
                  {savingRepo ? 'Saving...' : 'Add Repository'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddRepoForm(false);
                    setRepoFormData({
                      name: '',
                      type: 'private',
                      content_type: 'all',
                      local_path: '',
                      repo_url: '',
                      branch: 'main',
                      auto_push: true,
                      require_pr: false,
                    });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Repository List */}
          {loadingRepos ? (
            <p className="text-text-tertiary text-sm">Loading repositories...</p>
          ) : repositories.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-tertiary text-sm mb-2">No repositories configured</p>
              <p className="text-text-tertiary text-xs">
                Add a repository to start saving skills, tools, and files automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Private Repositories */}
              {privateRepos.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                    Private Repositories
                  </h4>
                  <div className="space-y-2">
                    {privateRepos.map((repo) => (
                      <div
                        key={repo.id}
                        className="flex items-start justify-between p-3 bg-bg-secondary rounded-lg hover:bg-bg-tertiary transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary text-sm font-medium">{repo.name}</span>
                            <Badge variant="info" className="text-[10px]">
                              {repo.content_type === 'all' ? 'All' : repo.content_type}
                            </Badge>
                            {repo.status?.isGitRepo ? (
                              <Badge variant="success" className="text-[10px]">Git</Badge>
                            ) : (
                              <Badge variant="warning" className="text-[10px]">No Git</Badge>
                            )}
                          </div>
                          <div className="text-text-tertiary text-xs font-mono mt-1 truncate">
                            {repo.local_path}
                          </div>
                          {repo.status?.detectedRemote && (
                            <div className="text-text-tertiary text-xs mt-1 truncate">
                              Remote: {repo.status.detectedRemote}
                            </div>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                            {repo.auto_push && <span>Auto-push</span>}
                            <span>Branch: {repo.status?.currentBranch || repo.branch}</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteRepository(repo.id, repo.name)}
                          className="text-status-error hover:text-status-error hover:bg-status-error/10"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team Repositories */}
              {teamRepos.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                    Team Repositories
                  </h4>
                  <div className="space-y-2">
                    {teamRepos.map((repo) => (
                      <div
                        key={repo.id}
                        className="flex items-start justify-between p-3 bg-bg-secondary rounded-lg hover:bg-bg-tertiary transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary text-sm font-medium">{repo.name}</span>
                            <Badge variant="info" className="text-[10px]">
                              {repo.content_type === 'all' ? 'All' : repo.content_type}
                            </Badge>
                            {repo.status?.isGitRepo ? (
                              <Badge variant="success" className="text-[10px]">Git</Badge>
                            ) : (
                              <Badge variant="warning" className="text-[10px]">No Git</Badge>
                            )}
                            {repo.require_pr && (
                              <Badge variant="warning" className="text-[10px]">PR Mode</Badge>
                            )}
                          </div>
                          <div className="text-text-tertiary text-xs font-mono mt-1 truncate">
                            {repo.local_path}
                          </div>
                          {repo.status?.detectedRemote && (
                            <div className="text-text-tertiary text-xs mt-1 truncate">
                              Remote: {repo.status.detectedRemote}
                            </div>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                            {repo.auto_push && <span>Auto-push</span>}
                            <span>Branch: {repo.status?.currentBranch || repo.branch}</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteRepository(repo.id, repo.name)}
                          className="text-status-error hover:text-status-error hover:bg-status-error/10"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

// Loading fallback for Suspense
function SettingsLoading(): JSX.Element {
  return (
    <main className="max-w-4xl mx-auto p-6 pb-20">
      <div className="mb-6">
        <div className="text-text-tertiary text-sm mb-4">← Back to Dashboard</div>
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">Loading...</p>
      </div>
    </main>
  );
}

// Export with Suspense boundary for useSearchParams
export default function SettingsPage(): JSX.Element {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsContent />
    </Suspense>
  );
}
