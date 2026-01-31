'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/Card';
import { Button } from '@/app/components/ui/Button';
import { Badge } from '@/app/components/ui/Badge';
import { useToast } from '@/app/hooks/useToast';
import { SkillDetailModal } from '@/app/components/SkillDetailModal';

// Types
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
  keyStatus?: {
    allMet: boolean;
    missing: string[];
    configured: string[];
    requiredKeys: string[];
  };
}

interface OutcomeSkill {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  triggers: string[];
  description?: string;
  path: string;
}

interface Tool {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  description?: string;
  path: string;
  syncStatus?: string;
}

interface Document {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  path: string;
  type: string;
  size?: number;
  createdAt: number;
}

interface OutputFile {
  id: string;
  name: string;
  outcomeId: string;
  outcomeName: string;
  path: string;
  type: string;
  createdAt: number;
}

type TabType = 'skills' | 'tools' | 'documents' | 'files';

export default function ResourcesPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Get initial tab from URL or default to 'skills'
  const initialTab = (searchParams.get('tab') as TabType) || 'skills';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Skills state
  const [skills, setSkills] = useState<Record<string, Skill[]>>({});
  const [outcomeSkills, setOutcomeSkills] = useState<Record<string, OutcomeSkill[]>>({});
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | OutcomeSkill | null>(null);
  const [skillContent, setSkillContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [skillSubTab, setSkillSubTab] = useState<'global' | 'outcome'>('global');

  // Tools state
  const [tools, setTools] = useState<Record<string, Tool[]>>({});
  const [toolsLoading, setToolsLoading] = useState(true);

  // Documents state
  const [documents, setDocuments] = useState<Record<string, Document[]>>({});
  const [documentsLoading, setDocumentsLoading] = useState(true);

  // Files/Outputs state
  const [files, setFiles] = useState<Record<string, OutputFile[]>>({});
  const [filesLoading, setFilesLoading] = useState(true);

  // Update URL when tab changes
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    router.push(`/resources?tab=${tab}`, { scroll: false });
  };

  // Fetch skills
  const fetchSkills = useCallback(async () => {
    try {
      const [globalRes, outcomeRes] = await Promise.all([
        fetch('/api/skills?groupBy=category&includeKeyStatus=true'),
        fetch('/api/skills/outcome')
      ]);

      const globalData = await globalRes.json();
      const outcomeData = await outcomeRes.json();

      setSkills(globalData.skills || {});
      setOutcomeSkills(outcomeData.byOutcome || {});
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  // Fetch tools from all outcomes
  const fetchTools = useCallback(async () => {
    try {
      const res = await fetch('/api/resources/tools');
      const data = await res.json();
      setTools(data.byOutcome || {});
    } catch (error) {
      console.error('Failed to fetch tools:', error);
    } finally {
      setToolsLoading(false);
    }
  }, []);

  // Fetch documents from all outcomes
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/resources/documents');
      const data = await res.json();
      setDocuments(data.byOutcome || {});
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  // Fetch output files from all outcomes
  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/resources/files');
      const data = await res.json();
      setFiles(data.byOutcome || {});
    } catch (error) {
      console.error('Failed to fetch files:', error);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // Sync skills from filesystem
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

  // Fetch skill content for modal
  const fetchSkillContent = async (skill: Skill | OutcomeSkill, isOutcome: boolean) => {
    setSelectedSkill(skill);
    setLoadingContent(true);
    setSkillContent(null);
    setShowModal(true);

    try {
      const url = isOutcome
        ? `/api/skills/outcome/${skill.id}?includeKeyStatus=true`
        : `/api/skills/${skill.id}?includeKeyStatus=true`;
      const response = await fetch(url);
      const data = await response.json();
      setSkillContent(data.content || 'No content available');
    } catch (error) {
      console.error('Failed to fetch skill content:', error);
      setSkillContent('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  useEffect(() => {
    fetchSkills();
    fetchTools();
    fetchDocuments();
    fetchFiles();
  }, [fetchSkills, fetchTools, fetchDocuments, fetchFiles]);

  // Calculate stats
  const totalGlobalSkills = Object.values(skills).flat().length;
  const totalOutcomeSkills = Object.values(outcomeSkills).flat().length;
  const totalTools = Object.values(tools).flat().length;
  const totalDocuments = Object.values(documents).flat().length;
  const totalFiles = Object.values(files).flat().length;

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
            <h1 className="text-2xl font-semibold text-text-primary">Resources</h1>
            <p className="text-text-secondary mt-1">
              Skills, tools, documents, and files across all outcomes
            </p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card
          padding="md"
          hover
          onClick={() => handleTabChange('skills')}
          className={`cursor-pointer ${activeTab === 'skills' ? 'border-accent' : ''}`}
        >
          <CardContent>
            <div className="text-2xl font-semibold text-text-primary">{totalGlobalSkills + totalOutcomeSkills}</div>
            <div className="text-sm text-text-secondary">Skills</div>
          </CardContent>
        </Card>
        <Card
          padding="md"
          hover
          onClick={() => handleTabChange('tools')}
          className={`cursor-pointer ${activeTab === 'tools' ? 'border-accent' : ''}`}
        >
          <CardContent>
            <div className="text-2xl font-semibold text-text-primary">{totalTools}</div>
            <div className="text-sm text-text-secondary">Tools</div>
          </CardContent>
        </Card>
        <Card
          padding="md"
          hover
          onClick={() => handleTabChange('documents')}
          className={`cursor-pointer ${activeTab === 'documents' ? 'border-accent' : ''}`}
        >
          <CardContent>
            <div className="text-2xl font-semibold text-text-primary">{totalDocuments}</div>
            <div className="text-sm text-text-secondary">Documents</div>
          </CardContent>
        </Card>
        <Card
          padding="md"
          hover
          onClick={() => handleTabChange('files')}
          className={`cursor-pointer ${activeTab === 'files' ? 'border-accent' : ''}`}
        >
          <CardContent>
            <div className="text-2xl font-semibold text-text-primary">{totalFiles}</div>
            <div className="text-sm text-text-secondary">Output Files</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        {(['skills', 'tools', 'documents', 'files'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'skills' && (
        <div>
          {/* Skills Sub-tabs and Actions */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2">
              <button
                onClick={() => setSkillSubTab('global')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  skillSubTab === 'global'
                    ? 'bg-accent text-white'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
                }`}
              >
                Global ({totalGlobalSkills})
              </button>
              <button
                onClick={() => setSkillSubTab('outcome')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  skillSubTab === 'outcome'
                    ? 'bg-accent text-white'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
                }`}
              >
                Outcome ({totalOutcomeSkills})
              </button>
            </div>
            <Button variant="secondary" size="sm" onClick={syncSkills} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync Skills'}
            </Button>
          </div>

          {skillsLoading ? (
            <p className="text-text-tertiary">Loading skills...</p>
          ) : skillSubTab === 'global' ? (
            // Global Skills
            Object.keys(skills).length === 0 ? (
              <Card padding="lg" className="text-center">
                <CardContent>
                  <p className="text-text-secondary mb-2">No global skills found</p>
                  <p className="text-text-tertiary text-sm">
                    Skills are stored as SKILL.md files in the skills/ directory.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {Object.keys(skills).sort().map((category) => (
                  <div key={category}>
                    <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {skills[category].map((skill) => (
                        <Card
                          key={skill.id}
                          padding="sm"
                          hover
                          onClick={() => fetchSkillContent(skill, false)}
                          className="cursor-pointer"
                        >
                          <CardContent>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-text-primary font-medium">{skill.name}</span>
                              {skill.keyStatus && !skill.keyStatus.allMet && (
                                <Badge variant="warning" className="text-[10px]">Keys Missing</Badge>
                              )}
                            </div>
                            {skill.description && (
                              <p className="text-text-tertiary text-sm truncate">{skill.description}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2 text-xs text-text-tertiary">
                              {skill.usage_count > 0 && <span>{skill.usage_count} uses</span>}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            // Outcome Skills
            Object.keys(outcomeSkills).length === 0 ? (
              <Card padding="lg" className="text-center">
                <CardContent>
                  <p className="text-text-secondary mb-2">No outcome skills found</p>
                  <p className="text-text-tertiary text-sm">
                    Outcome skills are created during capability phase.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {Object.keys(outcomeSkills).sort().map((outcomeName) => (
                  <div key={outcomeName}>
                    <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                      {outcomeName}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {outcomeSkills[outcomeName].map((skill) => (
                        <Card
                          key={skill.id}
                          padding="sm"
                          hover
                          onClick={() => fetchSkillContent(skill, true)}
                          className="cursor-pointer"
                        >
                          <CardContent>
                            <span className="text-text-primary font-medium">{skill.name}</span>
                            {skill.description && (
                              <p className="text-text-tertiary text-sm truncate mt-1">{skill.description}</p>
                            )}
                            {skill.triggers.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {skill.triggers.slice(0, 2).map((trigger, i) => (
                                  <span key={i} className="text-xs text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded">
                                    {trigger}
                                  </span>
                                ))}
                                {skill.triggers.length > 2 && (
                                  <span className="text-xs text-text-tertiary">+{skill.triggers.length - 2}</span>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {activeTab === 'tools' && (
        <div>
          {toolsLoading ? (
            <p className="text-text-tertiary">Loading tools...</p>
          ) : Object.keys(tools).length === 0 ? (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">No tools found</p>
                <p className="text-text-tertiary text-sm">
                  Tools are created during the capability phase when building outcomes.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.keys(tools).sort().map((outcomeName) => (
                <div key={outcomeName}>
                  <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                    {outcomeName}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tools[outcomeName].map((tool) => (
                      <Card key={tool.id} padding="sm" hover className="cursor-pointer">
                        <CardContent>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-text-primary font-medium">{tool.name}</span>
                            <Badge variant="info" className="text-[10px]">Tool</Badge>
                          </div>
                          {tool.description && (
                            <p className="text-text-tertiary text-sm truncate">{tool.description}</p>
                          )}
                          <p className="text-xs text-text-tertiary mt-2 truncate">{tool.path}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div>
          {documentsLoading ? (
            <p className="text-text-tertiary">Loading documents...</p>
          ) : Object.keys(documents).length === 0 ? (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">No documents found</p>
                <p className="text-text-tertiary text-sm">
                  Documents can be uploaded to outcomes for reference.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.keys(documents).sort().map((outcomeName) => (
                <div key={outcomeName}>
                  <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                    {outcomeName}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {documents[outcomeName].map((doc) => (
                      <Card key={doc.id} padding="sm" hover className="cursor-pointer">
                        <CardContent>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-text-primary font-medium">{doc.name}</span>
                            <Badge className="text-[10px]">{doc.type}</Badge>
                          </div>
                          <p className="text-xs text-text-tertiary mt-2 truncate">{doc.path}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'files' && (
        <div>
          {filesLoading ? (
            <p className="text-text-tertiary">Loading files...</p>
          ) : Object.keys(files).length === 0 ? (
            <Card padding="lg" className="text-center">
              <CardContent>
                <p className="text-text-secondary mb-2">No output files found</p>
                <p className="text-text-tertiary text-sm">
                  Output files are auto-detected from completed outcomes.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.keys(files).sort().map((outcomeName) => (
                <div key={outcomeName}>
                  <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                    {outcomeName}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {files[outcomeName].map((file) => (
                      <Card key={file.id} padding="sm" hover className="cursor-pointer">
                        <CardContent>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-text-primary font-medium">{file.name}</span>
                            <Badge variant="success" className="text-[10px]">{file.type}</Badge>
                          </div>
                          <p className="text-xs text-text-tertiary mt-2 truncate">{file.path}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Skill Detail Modal */}
      {showModal && selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          content={skillContent}
          loading={loadingContent}
          onClose={() => {
            setShowModal(false);
            setSelectedSkill(null);
            setSkillContent(null);
          }}
          onSave={(newContent) => {
            setSkillContent(newContent);
            toast({ type: 'success', message: 'Skill saved successfully' });
          }}
        />
      )}
    </main>
  );
}
