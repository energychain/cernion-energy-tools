import type { ReactNode } from 'react';

export function CollapsibleSection({
  title,
  collapsed = false,
  children,
}: {
  title: string;
  collapsed?: boolean;
  children?: ReactNode;
}) {
  return (
    <details className="collapsible-section" open={!collapsed}>
      <summary aria-expanded={!collapsed}>{title}</summary>
      {children}
    </details>
  );
}
