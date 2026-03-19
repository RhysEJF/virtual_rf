'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/Button';

interface TaskSkillStatus {
  name: string;
  status: 'ready' | 'needs_api_key' | 'will_be_built';
  skillId?: string;
  missingKeys?: string[];
  description?: string;
}

interface AvailableSkill {
  id: string;
  name: string;
  category: string;
  description: string | null;
}

interface TaskSkillsSectionProps {
  skills: TaskSkillStatus[];
  availableSkills: AvailableSkill[];
  loadingSkills: boolean;
  showSkillDropdown: boolean;
  setShowSkillDropdown: (show: boolean) => void;
  onAddSkill: (skillName: string) => void;
  onRemoveSkill: (skillName: string) => void;
}

export function TaskSkillsSection({
  skills,
  availableSkills,
  loadingSkills,
  showSkillDropdown,
  setShowSkillDropdown,
  onAddSkill,
  onRemoveSkill,
}: TaskSkillsSectionProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');

  const unassigned = availableSkills.filter(s => !skills.some(sk => sk.name === s.name));
  const filtered = searchQuery
    ? unassigned.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : unassigned;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-text-tertiary uppercase tracking-wide">
          Required Skills
        </label>
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const opening = !showSkillDropdown;
              setShowSkillDropdown(opening);
              if (!opening) setSearchQuery('');
            }}
            className="text-xs h-6 px-2"
          >
            + Add Skill
          </Button>
          {showSkillDropdown && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-bg-primary border border-border rounded-lg shadow-lg z-10">
              <div className="border-b border-border p-2 sticky top-0 bg-bg-primary rounded-t-lg">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search skills..."
                  autoFocus
                  className="w-full text-sm px-2 py-1 bg-bg-secondary border border-border rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="max-h-60 overflow-y-auto">
                {filtered.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => {
                      onAddSkill(skill.name);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-bg-secondary text-sm"
                  >
                    <span className="text-text-primary">{skill.name}</span>
                    <span className="text-text-tertiary text-xs ml-2">({skill.category})</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="px-3 py-2 text-text-tertiary text-sm">
                    {searchQuery ? 'No matching skills' : 'No more skills available'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {loadingSkills ? (
        <p className="text-text-tertiary text-sm">Loading skills...</p>
      ) : skills.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                skill.status === 'ready'
                  ? 'bg-status-success/10 border-status-success/30 text-status-success'
                  : skill.status === 'needs_api_key'
                  ? 'bg-status-warning/10 border-status-warning/30 text-status-warning'
                  : 'bg-accent/10 border-accent/30 text-accent'
              }`}
            >
              <span>
                {skill.status === 'ready' && '✓'}
                {skill.status === 'needs_api_key' && '⚠'}
                {skill.status === 'will_be_built' && '⏳'}
              </span>
              <span>{skill.name}</span>
              {skill.status === 'needs_api_key' && skill.missingKeys && (
                <span className="text-[10px] opacity-80">
                  (needs: {skill.missingKeys.join(', ')})
                </span>
              )}
              <button
                onClick={() => onRemoveSkill(skill.name)}
                className="ml-1 opacity-60 hover:opacity-100"
                title="Remove skill"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-text-tertiary text-sm">
          No skills mapped. Skills will be auto-detected when you optimize the approach.
        </p>
      )}
    </div>
  );
}
