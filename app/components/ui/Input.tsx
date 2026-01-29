'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className = '', error, ...props }, ref) => {
  const baseStyles =
    'w-full bg-bg-tertiary border rounded px-3 py-2 text-text-primary placeholder:text-text-tertiary transition-colors duration-150';

  const stateStyles = error
    ? 'border-status-error focus:border-status-error focus:ring-1 focus:ring-status-error'
    : 'border-border focus:border-accent focus:ring-1 focus:ring-accent';

  return <input ref={ref} className={`${baseStyles} ${stateStyles} ${className}`} {...props} />;
});

Input.displayName = 'Input';

export { Input };
