'use client';

import { createContext, useCallback, useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Toast, type ToastData, type ToastType, type ToastAction } from './Toast';

export interface ToastInput {
  type: ToastType;
  message: string;
  duration?: number;
  persistent?: boolean;
  actions?: ToastAction[];
  onDismiss?: () => void;
}

export interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [mounted, setMounted] = useState(false);

  // Only render portal after client-side hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  const toast = useCallback((input: ToastInput): string => {
    const id = `toast-${++toastCounter}-${Date.now()}`;
    const newToast: ToastData = {
      id,
      type: input.type,
      message: input.message,
      duration: input.duration,
      persistent: input.persistent,
      actions: input.actions,
      onDismiss: input.onDismiss,
    };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Render toasts into a portal at the bottom-right of the screen
  const toastContainer = mounted && typeof document !== 'undefined' ? (
    createPortal(
      <div
        className="fixed bottom-20 right-4 z-[100] flex flex-col gap-2 max-w-sm"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>,
      document.body
    )
  ) : null;

  return (
    <ToastContext.Provider value={{ toast, dismissToast }}>
      {children}
      {toastContainer}
    </ToastContext.Provider>
  );
}
