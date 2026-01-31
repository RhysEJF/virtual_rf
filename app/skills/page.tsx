'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { useToast } from '@/app/hooks/useToast';
import { SkillDetailModal } from '@/app/components/SkillDetailModal';

interface SkillKeyStatus {
  allMet: boolean;
  missing: string[];
  configured: string[];
  requiredKeys: string[];
}

interface Skill {
  id: string;
  name: string;
  category: string;
  description: string | null;
  path: string;
  usage_count: number;
  avg_cost: number | null;
  created_at: number;
  updated_at: number;
  keyStatus?: SkillKeyStatus;
}

interface OutcomeSkill {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  triggers: string[];
  description?: string;
  path: string;
  keyStatus?: SkillKeyStatus;
}

interface SkillStats {
  totalSkills: number;
  categories: number;
  totalUses: number;
}

interface ApiKeyStatus {
  configured: number;
  total: number;
  missing: string[];
  missingKeyNames: string[];  // Actual env var names (e.g., OPENAI_API_KEY)
}

export default function SkillsLibraryPage(): JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const [skills, setSkills] = useState<Record<string, Skill[]>>({});
  const [outcomeSkills, setOutcomeSkills] = useState<Record<string, OutcomeSkill[]>>({});
  const [stats, setStats] = useState<SkillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedOutcomeSkill, setSelectedOutcomeSkill] = useState<OutcomeSkill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'global' | 'outcome'>('global');
  const [showModal, setShowModal] = useState(false);

  // Create skill form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSkillCategory, setNewSkillCategory] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDescription, setNewSkillDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const response = await fetch('/api/skills?groupBy=category&includeKeyStatus=true');
      const data = await response.json();
      setSkills(data.skills || {});

      const allSkills = Object.values(data.skills || {}).flat() as Skill[];
      setStats({
        totalSkills: data.total || 0,
        categories: data.categories?.length || 0,
        totalUses: allSkills.reduce((sum, s) => sum + s.usage_count, 0),
      });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOutcomeSkills = useCallback(async () => {
    try {
      const response = await fetch('/api/skills/outcome');
      const data = await response.json();
      setOutcomeSkills(data.byOutcome || {});
    } catch (error) {
      console.error('Failed to fetch outcome skills:', error);
    }
  }, []);

  // Calculate which API keys are actually needed by skills
  const computeApiKeyStatus = useCallback(async () => {
    // Collect all missing keys from skills that actually require them
    const allSkillsFlat = Object.values(skills).flat();
    const missingLabels = new Set<string>();
    const requiredKeyNames = new Set<string>();

    for (const skill of allSkillsFlat) {
      if (skill.keyStatus && !skill.keyStatus.allMet) {
        for (const missingLabel of skill.keyStatus.missing) {
          missingLabels.add(missingLabel);
        }
        // Collect the required key names (actual env var names)
        for (const keyName of skill.keyStatus.requiredKeys) {
          requiredKeyNames.add(keyName);
        }
      }
    }

    // If there are skills with missing keys, fetch the env-keys to get proper mapping
    if (missingLabels.size > 0) {
      try {
        const response = await fetch('/api/env-keys');
        const data = await response.json();
        const keys = data.keys || [];

        // Find the key names for the missing labels
        const missingKeyNames: string[] = [];
        for (const key of keys) {
          if (!key.isSet && requiredKeyNames.has(key.name)) {
            missingKeyNames.push(key.name);
          }
        }

        setApiKeyStatus({
          configured: 0,
          total: missingLabels.size,
          missing: Array.from(missingLabels),
          missingKeyNames,
        });
      } catch (error) {
        console.error('Failed to fetch env keys:', error);
        setApiKeyStatus({
          configured: 0,
          total: missingLabels.size,
          missing: Array.from(missingLabels),
          missingKeyNames: Array.from(requiredKeyNames),
        });
      }
    } else {
      setApiKeyStatus(null);
    }
  }, [skills]);

  const syncSkills = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: `Synced: ${data.loaded} loaded, ${data.updated} updated` });
        fetchSkills();
      }
    } catch (error) {
      console.error('Failed to sync skills:', error);
      toast({ type: 'error', message: 'Failed to sync skills' });
    } finally {
      setSyncing(false);
    }
  };

  const fetchSkillContent = async (skill: Skill) => {
    setSelectedSkill(skill);
    setSelectedOutcomeSkill(null);
    setLoadingContent(true);
    setSkillContent(null);
    setShowModal(true);

    try {
      const response = await fetch(`/api/skills/${skill.id}?includeKeyStatus=true`);
      const data = await response.json();
      setSkillContent(data.content || 'No content available');
      // Update skill with key status from API if available
      if (data.skill?.keyStatus) {
        setSelectedSkill({ ...skill, keyStatus: data.skill.keyStatus });
      }
    } catch (error) {
      console.error('Failed to fetch skill content:', error);
      setSkillContent('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  const fetchOutcomeSkillContent = async (skill: OutcomeSkill) => {
    setSelectedOutcomeSkill(skill);
    setSelectedSkill(null);
    setLoadingContent(true);
    setSkillContent(null);
    setShowModal(true);

    try {
      const response = await fetch(`/api/skills/outcome/${skill.id}?includeKeyStatus=true`);
      const data = await response.json();
      setSkillContent(data.content || 'No content available');
      // Update with key status if available
      if (data.keyStatus) {
        setSelectedOutcomeSkill({ ...skill, keyStatus: data.keyStatus } as OutcomeSkill & { keyStatus: SkillKeyStatus });
      }
    } catch (error) {
      console.error('Failed to fetch outcome skill content:', error);
      setSkillContent('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  const createSkill = async () => {
    if (!newSkillCategory.trim() || !newSkillName.trim()) {
      toast({ type: 'warning', message: 'Category and name are required' });
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newSkillCategory.trim(),
          name: newSkillName.trim(),
          description: newSkillDescription.trim(),
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ type: 'success', message: `Skill created at: ${data.path}` });
        setShowCreateForm(false);
        setNewSkillCategory('');
        setNewSkillName('');
        setNewSkillDescription('');
        fetchSkills();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to create skill' });
      }
    } catch (error) {
      console.error('Failed to create skill:', error);
      toast({ type: 'error', message: 'Failed to create skill' });
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    fetchSkills();
    fetchOutcomeSkills();
  }, [fetchSkills, fetchOutcomeSkills]);

  // Recompute API key status when skills change
  useEffect(() => {
    computeApiKeyStatus();
  }, [computeApiKeyStatus]);

  const categories = Object.keys(skills).sort();
  const outcomeNames = Object.keys(outcomeSkills).sort();
  const totalOutcomeSkills = Object.values(outcomeSkills).flat().length;

  // Helper to get missing key names for settings navigation
  const getMissingKeyNames = (): string[] => {
    return apiKeyStatus?.missingKeyNames || [];
  };

  return (
    <main className="max-w-6xl mx-auto p-6 pb-20">
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
            <h1 className="text-2xl font-semibold text-text-primary">Skills Library</h1>
            <p className="text-text-secondary mt-1">
              Reusable instructions that Ralph can use when working on tasks
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={syncSkills} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync from Filesystem'}
            </Button>
            <Button onClick={() => setShowCreateForm(true)}>
              Create Skill
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">{stats.totalSkills}</div>
              <div className="text-sm text-text-secondary">Global Skills</div>
            </CardContent>
          </Card>
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">{totalOutcomeSkills}</div>
              <div className="text-sm text-text-secondary">Outcome Skills</div>
            </CardContent>
          </Card>
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">{outcomeNames.length}</div>
              <div className="text-sm text-text-secondary">Outcomes</div>
            </CardContent>
          </Card>
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">{stats.totalUses}</div>
              <div className="text-sm text-text-secondary">Total Uses</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('global')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'global'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Global Skills ({stats?.totalSkills || 0})
        </button>
        <button
          onClick={() => setActiveTab('outcome')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'outcome'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Outcome Skills ({totalOutcomeSkills})
        </button>
      </div>

      {/* Create Skill Form */}
      {showCreateForm && (
        <Card padding="md" className="mb-6">
          <CardHeader>
            <CardTitle>Create New Skill</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Category</label>
                <input
                  type="text"
                  value={newSkillCategory}
                  onChange={(e) => setNewSkillCategory(e.target.value)}
                  placeholder="e.g., development, research, strategy"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="e.g., React Component Patterns"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Description</label>
                <textarea
                  value={newSkillDescription}
                  onChange={(e) => setNewSkillDescription(e.target.value)}
                  placeholder="Brief description of what this skill teaches..."
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-none"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={createSkill} disabled={creating}>
                  {creating ? 'Creating...' : 'Create Skill'}
                </Button>
                <Button variant="secondary" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-text-tertiary">
                This creates a SKILL.md template file. Edit the file to add instructions.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Skills List */}
        <div className="lg:col-span-2 space-y-6">
          {loading ? (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary">Loading skills...</p>
              </CardContent>
            </Card>
          ) : activeTab === 'global' ? (
            // Global Skills
            categories.length === 0 ? (
              <Card padding="lg" className="text-center">
                <CardContent>
                  <p className="text-text-secondary mb-2">No global skills found</p>
                  <p className="text-text-tertiary text-sm mb-4">
                    Skills are stored as SKILL.md files in the skills/ directory.
                  </p>
                  <Button onClick={() => setShowCreateForm(true)}>Create Your First Skill</Button>
                </CardContent>
              </Card>
            ) : (
              categories.map((category) => (
                <div key={category}>
                  <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                    {category}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {skills[category].map((skill) => {
                      const hasMissingKeys = skill.keyStatus && !skill.keyStatus.allMet;
                      return (
                        <Card
                          key={skill.id}
                          padding="sm"
                          hover
                          onClick={() => fetchSkillContent(skill)}
                          className={`cursor-pointer transition-colors ${
                            selectedSkill?.id === skill.id ? 'border-accent' : ''
                          }`}
                        >
                          <CardContent>
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-text-primary font-medium">{skill.name}</span>
                                  {hasMissingKeys && (
                                    <Badge variant="warning" className="text-[10px]">Keys Missing</Badge>
                                  )}
                                </div>
                                {skill.description && (
                                  <p className="text-text-tertiary text-sm mt-1 truncate">
                                    {skill.description}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-2">
                                  {skill.usage_count > 0 && (
                                    <span className="text-text-tertiary text-xs">
                                      {skill.usage_count} uses
                                    </span>
                                  )}
                                  {!hasMissingKeys && (
                                    <Badge variant="success" className="text-[10px]">Ready</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))
            )
          ) : (
            // Outcome Skills
            outcomeNames.length === 0 ? (
              <Card padding="lg" className="text-center">
                <CardContent>
                  <p className="text-text-secondary mb-2">No outcome skills found</p>
                  <p className="text-text-tertiary text-sm">
                    Outcome skills are created during capability phase when building outcomes.
                  </p>
                </CardContent>
              </Card>
            ) : (
              outcomeNames.map((outcomeName) => (
                <div key={outcomeName}>
                  <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                    {outcomeName}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {outcomeSkills[outcomeName].map((skill) => (
                      <Card
                        key={skill.id}
                        padding="sm"
                        hover
                        onClick={() => fetchOutcomeSkillContent(skill)}
                        className={`cursor-pointer transition-colors ${
                          selectedOutcomeSkill?.id === skill.id ? 'border-accent' : ''
                        }`}
                      >
                        <CardContent>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-text-primary font-medium">{skill.name}</span>
                              </div>
                              {skill.description && (
                                <p className="text-text-tertiary text-sm mt-1 truncate">
                                  {skill.description}
                                </p>
                              )}
                              {skill.triggers.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {skill.triggers.slice(0, 3).map((trigger, i) => (
                                    <span key={i} className="text-xs text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded">
                                      {trigger}
                                    </span>
                                  ))}
                                  {skill.triggers.length > 3 && (
                                    <span className="text-xs text-text-tertiary">+{skill.triggers.length - 3}</span>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant="info" className="text-[10px]">Outcome</Badge>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* Skill Detail Panel */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            Skill Detail
          </h2>
          {selectedSkill ? (
            <Card padding="md">
              <CardHeader>
                <CardTitle>{selectedSkill.name}</CardTitle>
                <Badge>{selectedSkill.category}</Badge>
              </CardHeader>
              <CardContent>
                {selectedSkill.description && (
                  <p className="text-text-secondary text-sm mb-4">{selectedSkill.description}</p>
                )}
                <div className="text-xs text-text-tertiary mb-4">
                  <div>Used {selectedSkill.usage_count} times</div>
                  <div className="truncate" title={selectedSkill.path}>
                    Path: {selectedSkill.path.split('/').slice(-3).join('/')}
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs text-text-secondary uppercase tracking-wide mb-2">
                    Content Preview
                  </h4>
                  {loadingContent ? (
                    <p className="text-text-tertiary text-sm">Loading...</p>
                  ) : (
                    <pre className="text-text-primary text-xs bg-bg-secondary p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">
                      {skillContent}
                    </pre>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : selectedOutcomeSkill ? (
            <Card padding="md">
              <CardHeader>
                <CardTitle>{selectedOutcomeSkill.name}</CardTitle>
                <Badge variant="info">Outcome Skill</Badge>
              </CardHeader>
              <CardContent>
                {selectedOutcomeSkill.description && (
                  <p className="text-text-secondary text-sm mb-4">{selectedOutcomeSkill.description}</p>
                )}
                <div className="text-xs text-text-tertiary mb-4">
                  <div>Outcome: {selectedOutcomeSkill.outcomeName}</div>
                  <div className="truncate" title={selectedOutcomeSkill.path}>
                    Path: {selectedOutcomeSkill.path}
                  </div>
                  {selectedOutcomeSkill.triggers.length > 0 && (
                    <div className="mt-2">
                      <span className="text-text-secondary">Triggers:</span>{' '}
                      {selectedOutcomeSkill.triggers.join(', ')}
                    </div>
                  )}
                </div>
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs text-text-secondary uppercase tracking-wide mb-2">
                    Content Preview
                  </h4>
                  {loadingContent ? (
                    <p className="text-text-tertiary text-sm">Loading...</p>
                  ) : (
                    <pre className="text-text-primary text-xs bg-bg-secondary p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">
                      {skillContent}
                    </pre>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card padding="md">
              <CardContent>
                <p className="text-text-tertiary text-sm">
                  Select a skill to view its details and content.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Skill Detail Modal */}
      {showModal && (selectedSkill || selectedOutcomeSkill) && (
        <SkillDetailModal
          skill={selectedSkill || selectedOutcomeSkill!}
          content={skillContent}
          loading={loadingContent}
          onClose={() => {
            setShowModal(false);
            setSelectedSkill(null);
            setSelectedOutcomeSkill(null);
            setSkillContent(null);
          }}
          onSave={(newContent) => {
            setSkillContent(newContent);
            toast({ type: 'success', message: 'Skill saved successfully' });
          }}
        />
      )}

      {/* API Keys Notice */}
      {apiKeyStatus && apiKeyStatus.missing.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg-primary border-t border-border p-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-status-warning">⚠</span>
              <div>
                <p className="text-text-primary text-sm">
                  {apiKeyStatus.missing.length} API key{apiKeyStatus.missing.length !== 1 ? 's' : ''} not configured
                </p>
                <p className="text-text-tertiary text-xs">
                  Some skills may need API keys to function properly
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Pass missing keys as query params so settings page can highlight them
                const missingKeyNames = getMissingKeyNames();
                const params = new URLSearchParams({
                  showMissing: 'true',
                  highlight: missingKeyNames.join(','),
                });
                router.push(`/settings?${params.toString()}`);
              }}
            >
              Configure in Settings →
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
