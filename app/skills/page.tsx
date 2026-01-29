'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { useToast } from '@/app/hooks/useToast';

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
}

interface SkillStats {
  totalSkills: number;
  categories: number;
  topUsed: Skill[];
}

export default function SkillsLibraryPage(): JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const [skills, setSkills] = useState<Record<string, Skill[]>>({});
  const [stats, setStats] = useState<SkillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Create skill form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSkillCategory, setNewSkillCategory] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDescription, setNewSkillDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const response = await fetch('/api/skills?groupBy=category');
      const data = await response.json();
      setSkills(data.skills || {});
      setStats({
        totalSkills: data.total || 0,
        categories: data.categories?.length || 0,
        topUsed: [],
      });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoading(false);
    }
  }, []);

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
    setLoadingContent(true);
    setSkillContent(null);

    try {
      const response = await fetch(`/api/skills/${skill.id}`);
      const data = await response.json();
      setSkillContent(data.content || 'No content available');
    } catch (error) {
      console.error('Failed to fetch skill content:', error);
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
  }, [fetchSkills]);

  const categories = Object.keys(skills).sort();

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
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">{stats.totalSkills}</div>
              <div className="text-sm text-text-secondary">Total Skills</div>
            </CardContent>
          </Card>
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">{stats.categories}</div>
              <div className="text-sm text-text-secondary">Categories</div>
            </CardContent>
          </Card>
          <Card padding="md">
            <CardContent>
              <div className="text-2xl font-semibold text-text-primary">
                {Object.values(skills).flat().reduce((sum, s) => sum + s.usage_count, 0)}
              </div>
              <div className="text-sm text-text-secondary">Total Uses</div>
            </CardContent>
          </Card>
        </div>
      )}

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
          ) : categories.length === 0 ? (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">No skills found</p>
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
                <div className="space-y-2">
                  {skills[category].map((skill) => (
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
                              {skill.usage_count > 0 && (
                                <Badge variant="default" className="text-[10px]">
                                  {skill.usage_count} uses
                                </Badge>
                              )}
                            </div>
                            {skill.description && (
                              <p className="text-text-tertiary text-sm mt-1 truncate">
                                {skill.description}
                              </p>
                            )}
                          </div>
                          <span className="text-text-tertiary text-xs">→</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))
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
    </main>
  );
}
