'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle(): JSX.Element {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Only run on client
  useEffect(() => {
    setMounted(true);
    // Check localStorage or system preference
    const stored = localStorage.getItem('theme');
    if (stored) {
      setIsDark(stored === 'dark');
    } else {
      // Default to light mode (earthy theme)
      setIsDark(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark, mounted]);

  // Prevent hydration mismatch
  if (!mounted) {
    return <div className="w-12 h-6" />;
  }

  return (
    <button
      onClick={() => setIsDark(!isDark)}
      className="relative w-12 h-6 rounded-full bg-bg-tertiary border border-border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-primary"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-accent transition-transform duration-200 flex items-center justify-center text-white text-xs ${
          isDark ? 'translate-x-6' : 'translate-x-0'
        }`}
      >
        {isDark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}
