'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

interface OutcomeSkill {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  triggers: string[];
  description?: string;
  path: string;
}

interface SkillsSectionProps {
  outcomeId: string;
}

export function SkillsSection({ outcomeId }: SkillsSectionProps): JSX.Element {
  const [skills, setSkills] = useState<OutcomeSkill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<OutcomeSkill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);

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

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

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
            Skills are created during the infrastructure phase
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
          {skills.map((skill) => (
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
            </div>
          ))}
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
