import { type HTMLAttributes, type ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

export function Card({ className = '', children, padding = 'md', hover = false, ...props }: CardProps): JSX.Element {
  const baseStyles = 'bg-bg-secondary border border-border rounded-lg';

  const paddingStyles = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };

  const hoverStyles = hover ? 'hover:border-border-hover transition-colors duration-150 cursor-pointer' : '';

  return (
    <div className={`${baseStyles} ${paddingStyles[padding]} ${hoverStyles} ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardHeader({ className = '', children, ...props }: CardHeaderProps): JSX.Element {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

export function CardTitle({ className = '', children, ...props }: CardTitleProps): JSX.Element {
  return (
    <h3 className={`font-medium text-text-primary ${className}`} {...props}>
      {children}
    </h3>
  );
}

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardContent({ className = '', children, ...props }: CardContentProps): JSX.Element {
  return (
    <div className={`text-text-secondary ${className}`} {...props}>
      {children}
    </div>
  );
}
