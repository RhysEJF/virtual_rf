'use client';

import { useState, useCallback } from 'react';
import { CommandBar } from './components/CommandBar';
import { SystemStatus } from './components/SystemStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { Card, CardContent } from './components/ui/Card';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Dashboard(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (input: string) => {
    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    setLoading(true);

    try {
      const response = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });

      const data = await response.json();

      // Add assistant response
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.response || data.error || 'No response',
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-6 pb-20">
      {/* Header */}
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">@virtual_rf</h1>
          <p className="text-text-secondary mt-1">Your personal AI workforce</p>
        </div>
        <ThemeToggle />
      </header>

      {/* Command Bar */}
      <div className="mb-8">
        <CommandBar onSubmit={handleSubmit} loading={loading} />
      </div>

      {/* Messages / Conversation */}
      {messages.length > 0 ? (
        <section className="flex-1 space-y-4 mb-8">
          {messages.map((msg, i) => (
            <Card key={i} padding="md" className={msg.role === 'user' ? 'ml-8' : 'mr-8'}>
              <CardContent>
                <div className="text-xs text-text-tertiary mb-1">
                  {msg.role === 'user' ? 'You' : '@virtual_rf'}
                </div>
                <div className="text-text-primary whitespace-pre-wrap">{msg.content}</div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <section className="flex-1 flex items-center justify-center mb-8">
          <Card padding="lg" className="text-center max-w-md">
            <CardContent>
              <p className="text-text-secondary mb-2">No conversations yet.</p>
              <p className="text-text-tertiary text-sm">
                Start by describing what you want to work on. I can help with research, building
                tools, strategy, and more.
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* System Status */}
      <SystemStatus activeAgents={0} todayCost={0} skillsLoaded={0} />
    </main>
  );
}
