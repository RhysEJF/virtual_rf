'use client';

import { useState } from 'react';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

export function TodoList(): JSX.Element {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState('');

  const addTodo = (): void => {
    if (inputValue.trim() === '') return;

    const newTodo: Todo = {
      id: Date.now(),
      text: inputValue.trim(),
      completed: false,
    };

    setTodos([...todos, newTodo]);
    setInputValue('');
  };

  const toggleTodo = (id: number): void => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  const deleteTodo = (id: number): void => {
    setTodos(todos.filter((todo) => todo.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      addTodo();
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-100">
        Todo List
      </h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a new todo..."
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                     focus:outline-none focus:ring-2 focus:ring-blue-500
                     bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                     placeholder-gray-400 dark:placeholder-gray-500"
        />
        <button
          onClick={addTodo}
          className="px-4 py-2 bg-blue-500 text-white rounded-md
                     hover:bg-blue-600 active:bg-blue-700
                     transition-colors duration-150"
        >
          Add
        </button>
      </div>

      <ul className="space-y-2">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md
                       hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors duration-150"
          >
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
              className="w-5 h-5 rounded border-gray-300 text-blue-500
                         focus:ring-blue-500 cursor-pointer"
            />
            <span
              className={`flex-1 ${
                todo.completed
                  ? 'line-through text-gray-400 dark:text-gray-500'
                  : 'text-gray-800 dark:text-gray-100'
              }`}
            >
              {todo.text}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="px-2 py-1 text-red-500 hover:text-red-700
                         hover:bg-red-100 dark:hover:bg-red-900/30 rounded
                         transition-colors duration-150"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && (
        <p className="text-center text-gray-400 dark:text-gray-500 py-4">
          No todos yet. Add one above!
        </p>
      )}

      {todos.length > 0 && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {todos.filter((t) => t.completed).length} of {todos.length} completed
        </p>
      )}
    </div>
  );
}
