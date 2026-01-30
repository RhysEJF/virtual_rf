'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useToast } from '@/app/hooks/useToast';

interface Document {
  name: string;
  filename: string;
  size: number;
  type: string;
  modified: string;
  path: string;
}

interface DocumentsSectionProps {
  outcomeId: string;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  markdown: 'M',
  text: 'T',
  pdf: 'P',
  word: 'W',
  json: 'J',
  csv: 'C',
  html: 'H',
  unknown: '?',
};

const FILE_TYPE_COLORS: Record<string, string> = {
  markdown: 'bg-blue-500/20 text-blue-400',
  text: 'bg-gray-500/20 text-gray-400',
  pdf: 'bg-red-500/20 text-red-400',
  word: 'bg-blue-600/20 text-blue-500',
  json: 'bg-yellow-500/20 text-yellow-400',
  csv: 'bg-green-500/20 text-green-400',
  html: 'bg-orange-500/20 text-orange-400',
  unknown: 'bg-gray-500/20 text-gray-400',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes <= 1 ? 'Just now' : `${minutes}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function DocumentsSection({ outcomeId }: DocumentsSectionProps): JSX.Element {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteName, setPasteName] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [savingPaste, setSavingPaste] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/documents`);
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
    }
  }, [outcomeId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  }, []);

  const uploadFiles = async (files: FileList) => {
    setUploading(true);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`/api/outcomes/${outcomeId}/documents`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (data.success) {
          toast({ type: 'success', message: `Uploaded: ${file.name}` });
        } else {
          toast({ type: 'error', message: data.error || `Failed to upload ${file.name}` });
        }
      } catch (error) {
        toast({ type: 'error', message: `Failed to upload ${file.name}` });
      }
    }

    setUploading(false);
    fetchDocuments();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSavePaste = async () => {
    if (!pasteName.trim() || !pasteContent.trim()) {
      toast({ type: 'warning', message: 'Please provide a name and content' });
      return;
    }

    setSavingPaste(true);

    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: pasteName.trim(),
          content: pasteContent.trim(),
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast({ type: 'success', message: 'Document saved' });
        setShowPasteModal(false);
        setPasteName('');
        setPasteContent('');
        fetchDocuments();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to save document' });
      }
    } catch (error) {
      toast({ type: 'error', message: 'Failed to save document' });
    } finally {
      setSavingPaste(false);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm('Delete this document?')) return;

    try {
      const response = await fetch(
        `/api/outcomes/${outcomeId}/documents?filename=${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );

      const data = await response.json();

      if (data.success) {
        toast({ type: 'success', message: 'Document deleted' });
        fetchDocuments();
      } else {
        toast({ type: 'error', message: data.error || 'Failed to delete' });
      }
    } catch (error) {
      toast({ type: 'error', message: 'Failed to delete document' });
    }
  };

  const handleView = async (doc: Document) => {
    setViewingDoc(doc);
    setDocContent(null);
    setLoadingContent(true);

    try {
      const response = await fetch(
        `/api/outcomes/${outcomeId}/outputs/${encodeURIComponent(doc.path)}`
      );
      const data = await response.json();
      setDocContent(data.content || 'Unable to load content');
    } catch (error) {
      setDocContent('Failed to load document content');
    } finally {
      setLoadingContent(false);
    }
  };

  return (
    <>
      <Card padding="md">
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <Badge variant="default">{documents.length}</Badge>
        </CardHeader>
        <CardContent>
          {/* Drop Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
              dragActive
                ? 'border-accent bg-accent/5'
                : 'border-border hover:border-accent/50'
            }`}
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <div className="animate-spin h-4 w-4 border-2 border-accent border-t-transparent rounded-full" />
                <span className="text-text-secondary text-sm">Uploading...</span>
              </div>
            ) : (
              <>
                <p className="text-text-secondary text-sm mb-2">
                  Drag files here or use the buttons below
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload File
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPasteModal(true)}
                  >
                    Paste Content
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                  multiple
                  accept=".md,.txt,.pdf,.doc,.docx,.json,.csv,.html"
                />
              </>
            )}
          </div>

          {/* Documents List */}
          {loading ? (
            <p className="text-text-tertiary text-sm mt-4">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-text-tertiary text-sm mt-4 text-center">
              No documents attached yet. Upload files or paste content to share context with workers.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.filename}
                  className="flex items-center gap-3 p-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors group"
                >
                  {/* Type Icon */}
                  <div
                    className={`w-8 h-8 rounded flex items-center justify-center font-mono text-xs font-bold ${
                      FILE_TYPE_COLORS[doc.type] || FILE_TYPE_COLORS.unknown
                    }`}
                  >
                    {FILE_TYPE_ICONS[doc.type] || FILE_TYPE_ICONS.unknown}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate">
                      {doc.name}
                    </p>
                    <p className="text-text-tertiary text-xs">
                      {formatFileSize(doc.size)} • {formatDate(doc.modified)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {['markdown', 'text', 'json', 'csv', 'html'].includes(doc.type) && (
                      <button
                        onClick={() => handleView(doc)}
                        className="p-1.5 text-text-tertiary hover:text-text-primary rounded hover:bg-bg-primary transition-colors"
                        title="View"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(doc.filename)}
                      className="p-1.5 text-text-tertiary hover:text-status-error rounded hover:bg-bg-primary transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-text-tertiary mt-4">
            Workers can access these documents when executing tasks.
          </p>
        </CardContent>
      </Card>

      {/* Paste Content Modal */}
      {showPasteModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowPasteModal(false)}
        >
          <div
            className="bg-bg-primary rounded-lg border border-border max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border">
              <h3 className="text-lg font-medium text-text-primary">Paste Document Content</h3>
              <p className="text-sm text-text-secondary mt-1">
                Paste text content to save as a document
              </p>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Document Name
                </label>
                <input
                  type="text"
                  value={pasteName}
                  onChange={(e) => setPasteName(e.target.value)}
                  placeholder="e.g., GTM Strategy, Audit Report"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Content
                </label>
                <textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="Paste your document content here..."
                  rows={12}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-none font-mono text-sm"
                />
              </div>
            </div>

            <div className="p-4 border-t border-border flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowPasteModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSavePaste}
                disabled={savingPaste || !pasteName.trim() || !pasteContent.trim()}
              >
                {savingPaste ? 'Saving...' : 'Save Document'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View Document Modal */}
      {viewingDoc && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingDoc(null)}
        >
          <div
            className="bg-bg-primary rounded-lg border border-border max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium text-text-primary">{viewingDoc.name}</h3>
                <p className="text-sm text-text-tertiary">
                  {viewingDoc.filename} • {formatFileSize(viewingDoc.size)}
                </p>
              </div>
              <button
                onClick={() => setViewingDoc(null)}
                className="text-text-tertiary hover:text-text-primary p-1"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingContent ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full" />
                </div>
              ) : (
                <pre className="text-text-primary text-sm whitespace-pre-wrap font-mono bg-bg-secondary p-4 rounded-lg">
                  {docContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
