'use client';

import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from './ui/Button';

export type RequestMode = 'smart' | 'quick' | 'long';

export interface CommandBarProps {
  onSubmit: (input: string, mode: RequestMode) => void;
  loading?: boolean;
  placeholder?: string;
}

export function CommandBar({
  onSubmit,
  loading = false,
  placeholder = 'What would you like to work on?',
}: CommandBarProps): JSX.Element {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<RequestMode>('smart');

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !loading) {
        onSubmit(trimmed, mode);
        setInput('');
      }
    },
    [input, loading, mode, onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter without Shift
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed && !loading) {
          onSubmit(trimmed, mode);
          setInput('');
        }
      }
    },
    [input, loading, mode, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-colors duration-150">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="w-full bg-transparent px-4 py-3 text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none"
          style={{
            minHeight: '48px',
            maxHeight: '200px',
          }}
          disabled={loading}
        />
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/50">
          <div className="flex items-center gap-4">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as RequestMode)}
              className="text-xs bg-bg-tertiary border border-border rounded px-2 py-1 text-text-secondary focus:outline-none focus:border-accent cursor-pointer"
              disabled={loading}
            >
              <option value="smart">Smart (AI decides)</option>
              <option value="quick">Quick response</option>
              <option value="long">Long-running agent</option>
            </select>
            <span className="text-xs text-text-tertiary hidden sm:inline">
              Press Enter to send, Shift+Enter for new line
            </span>
          </div>
          <Button type="submit" size="sm" loading={loading} disabled={!input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
