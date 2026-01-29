'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from './ui/ToastProvider';

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ToastProvider>
      {children}
    </ToastProvider>
  );
}
