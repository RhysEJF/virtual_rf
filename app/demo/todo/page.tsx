'use client';

import { TodoList } from '../../components/TodoList';

export default function TodoDemoPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-bg-primary p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Ralph Built This Too
        </h1>
        <p className="text-text-secondary mb-8">
          Todo list component - built autonomously from the web app!
        </p>

        <TodoList />

        <div className="mt-8 p-4 bg-bg-secondary rounded-lg">
          <h2 className="text-lg font-medium text-text-primary mb-2">Features:</h2>
          <ul className="text-text-secondary space-y-1">
            <li>• Add new todos (Enter key or button)</li>
            <li>• Toggle completion with checkbox</li>
            <li>• Delete individual todos</li>
            <li>• Progress counter</li>
            <li>• Dark mode support</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
