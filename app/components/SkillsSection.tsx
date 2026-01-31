'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';
import type { SaveTarget } from '@/lib/db/schema';

interface OutcomeSkill {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  triggers: string[];
  description?: string;
  path: string;
}

interface OutcomeItem {
  id: string;
  outcome_id: string;
  item_type: string;
  filename: string;
  file_path: string;
  target_override: SaveTarget | null;
  synced_to: string | null;  // Repository ID if synced, null if local only
  last_synced_at: number | null;
}

interface SkillsSectionProps {
  outcomeId: string;
}

const TARGET_LABELS: Record<'local' | 'repo', string> = {
  local: 'Local',
  repo: 'Repository',
};

export function SkillsSection({ outcomeId }: SkillsSectionProps): JSX.Element {
  const { toast } = useToast();
  const [skills, setSkills] = useState<OutcomeSkill[]>([]);
  const [items, setItems] = useState<Map<string, OutcomeItem>>(new Map());
  const [selectedSkill, setSelectedSkill] = useState<OutcomeSkill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [promotingSkill, setPromotingSkill] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const response = await fetch(`/api/skills/outcome?outcomeId=${outcomeId}`);
      const data = await response.json();
      setSkills(data.skills || []);
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  const fetchItems = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/items?type=skill`);
      const data = await response.json();
      const itemMap = new Map<string, OutcomeItem>();
      (data.items || []).forEach((item: OutcomeItem) => {
        itemMap.set(item.filename, item);
      });
      setItems(itemMap);
    } catch (error) {
      console.error('Failed to fetch skill items:', error);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchSkills();
    fetchItems();
  }, [fetchSkills, fetchItems]);

  const handleSelectSkill = async (skill: OutcomeSkill) => {
    setSelectedSkill(skill);
    setLoadingContent(true);
    setSkillContent(null);

    try {
      const response = await fetch(`/api/skills/outcome/${skill.id}`);
      const data = await response.json();
      setSkillContent(data.content || 'No content available');
    } catch (error) {
      console.error('Failed to fetch skill content:', error);
      setSkillContent('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  const handlePromote = async (skill: OutcomeSkill, target: SaveTarget) => {
    const filename = `${skill.name}.md`;
    setPromotingSkill(skill.id);

    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type: 'skill',
          filename,
          action: 'promote',
          target,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        toast({ type: 'success', message: `Skill ${target === 'local' ? 'unsynced' : `synced to ${target}`}` });
        fetchItems(); // Refresh items
      } else {
        toast({ type: 'error', message: data.error || 'Failed to promote skill' });
      }
    } catch (error) {
      console.error('Failed to promote skill:', error);
      toast({ type: 'error', message: 'Failed to promote skill' });
    } finally {
      setPromotingSkill(null);
    }
  };

  const getItemForSkill = (skill: OutcomeSkill): OutcomeItem | undefined => {
    const filename = `${skill.name}.md`;
    return items.get(filename);
  };

  const getSyncBadge = (item: OutcomeItem | undefined): JSX.Element | null => {
    if (!item || !item.synced_to) {
      return <Badge variant="default">Local</Badge>;
    }
    // synced_to now contains a repository ID, meaning it's synced
    return <Badge variant="success">Synced</Badge>;
  };

  if (loading) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-sm">Loading skills...</p>
        </CardContent>
      </Card>
    );
  }

  if (skills.length === 0) {
    return (
      <Card padding="md">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <Badge variant="default">0</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-sm text-center py-2">
            No skills built yet
          </p>
          <p className="text-text-tertiary text-xs text-center">
            Skills are created during the capability phase
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card padding="md">
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <Badge variant="success">{skills.length}</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {skills.map((skill) => {
            const item = getItemForSkill(skill);
            const isPromoting = promotingSkill === skill.id;

            return (
              <div
                key={skill.id}
                className={`p-2 rounded cursor-pointer transition-colors border ${
                  selectedSkill?.id === skill.id
                    ? 'bg-accent/10 border-accent'
                    : 'bg-bg-secondary border-transparent hover:border-border'
                }`}
                onClick={() => handleSelectSkill(skill)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-text-primary text-sm font-medium">{skill.name}</span>
                  <div className="flex items-center gap-2">
                    {getSyncBadge(item)}
                  </div>
                </div>
                {skill.triggers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {skill.triggers.slice(0, 2).map((trigger, i) => (
                      <span key={i} className="text-[10px] text-text-tertiary bg-bg-primary px-1 rounded">
                        {trigger}
                      </span>
                    ))}
                    {skill.triggers.length > 2 && (
                      <span className="text-[10px] text-text-tertiary">+{skill.triggers.length - 2}</span>
                    )}
                  </div>
                )}

                {/* Promotion dropdown - shown when skill is selected */}
                {selectedSkill?.id === skill.id && (
                  <div
                    className="mt-2 pt-2 border-t border-border/50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-tertiary">Save to:</span>
                      {(['local', 'repo'] as const).map((target) => (
                        <button
                          key={target}
                          disabled={isPromoting}
                          onClick={() => handlePromote(skill, target)}
                          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                            (item?.synced_to && target === 'repo') || (!item?.synced_to && target === 'local')
                              ? 'bg-accent text-white'
                              : 'bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                          } ${isPromoting ? 'opacity-50' : ''}`}
                        >
                          {TARGET_LABELS[target]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Skill Content Preview */}
        {selectedSkill && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs text-text-secondary uppercase tracking-wide">
                {selectedSkill.name}
              </h4>
              <button
                className="text-xs text-text-tertiary hover:text-text-secondary"
                onClick={() => setSelectedSkill(null)}
              >
                Close
              </button>
            </div>
            {loadingContent ? (
              <p className="text-text-tertiary text-sm">Loading...</p>
            ) : (
              <pre className="text-text-primary text-xs bg-bg-secondary p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                {skillContent}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
