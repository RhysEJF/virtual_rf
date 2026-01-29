'use client';

import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

export interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-status-success/10',
    border: 'border-status-success/30',
    icon: '✓',
  },
  error: {
    bg: 'bg-status-error/10',
    border: 'border-status-error/30',
    icon: '✕',
  },
  warning: {
    bg: 'bg-status-warning/10',
    border: 'border-status-warning/30',
    icon: '!',
  },
  info: {
    bg: 'bg-status-info/10',
    border: 'border-status-info/30',
    icon: 'i',
  },
};

const typeTextStyles: Record<ToastType, string> = {
  success: 'text-status-success',
  error: 'text-status-error',
  warning: 'text-status-warning',
  info: 'text-status-info',
};

export function Toast({ toast, onDismiss }: ToastProps): JSX.Element {
  const [isExiting, setIsExiting] = useState(false);
  const styles = typeStyles[toast.type];
  const textStyle = typeTextStyles[toast.type];
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, duration - 300);

    const dismissTimer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(dismissTimer);
    };
  }, [duration, onDismiss, toast.id]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg
        ${styles.bg} ${styles.border}
        transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      <span className={`${textStyle} font-bold text-sm w-5 h-5 flex items-center justify-center rounded-full border ${styles.border}`}>
        {styles.icon}
      </span>
      <span className="text-text-primary text-sm flex-1">{toast.message}</span>
      <button
        onClick={handleDismiss}
        className="text-text-tertiary hover:text-text-secondary transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
