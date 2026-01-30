'use client';

import Link from 'next/link';

interface Breadcrumb {
  id: string;
  name: string;
}

interface OutcomeBreadcrumbsProps {
  breadcrumbs: Breadcrumb[];
  currentName: string;
}

/**
 * Breadcrumb navigation for hierarchical outcomes
 * Displays: Dashboard > Parent > Child > Current
 */
export function OutcomeBreadcrumbs({ breadcrumbs, currentName }: OutcomeBreadcrumbsProps): JSX.Element {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-text-tertiary overflow-x-auto">
      <Link
        href="/"
        className="hover:text-text-secondary transition-colors whitespace-nowrap"
      >
        Dashboard
      </Link>

      {breadcrumbs.slice(0, -1).map((crumb) => (
        <span key={crumb.id} className="flex items-center gap-1.5">
          <span className="text-text-tertiary/50">›</span>
          <Link
            href={`/outcome/${crumb.id}`}
            className="hover:text-text-secondary transition-colors whitespace-nowrap max-w-[150px] truncate"
            title={crumb.name}
          >
            {crumb.name}
          </Link>
        </span>
      ))}

      <span className="flex items-center gap-1.5">
        <span className="text-text-tertiary/50">›</span>
        <span className="text-text-primary font-medium whitespace-nowrap max-w-[200px] truncate" title={currentName}>
          {currentName}
        </span>
      </span>
    </nav>
  );
}
