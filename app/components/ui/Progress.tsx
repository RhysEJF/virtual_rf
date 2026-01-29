import { type HTMLAttributes } from 'react';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number; // 0-100
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export function Progress({
  value,
  size = 'md',
  showLabel = false,
  variant = 'default',
  className = '',
  ...props
}: ProgressProps): JSX.Element {
  const clampedValue = Math.min(100, Math.max(0, value));

  const sizeStyles = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  const variantStyles = {
    default: 'bg-accent',
    success: 'bg-status-success',
    warning: 'bg-status-warning',
    error: 'bg-status-error',
  };

  return (
    <div className={`flex items-center gap-2 ${className}`} {...props}>
      <div className={`flex-1 bg-bg-tertiary rounded-full overflow-hidden ${sizeStyles[size]}`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${variantStyles[variant]}`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
      {showLabel && <span className="text-sm text-text-secondary tabular-nums">{Math.round(clampedValue)}%</span>}
    </div>
  );
}
