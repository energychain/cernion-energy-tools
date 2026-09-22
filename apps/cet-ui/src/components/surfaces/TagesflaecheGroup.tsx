import type { ReactNode } from 'react';

export function TagesflaecheGroup({
  title = 'Tagesfläche',
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <section className="tagesflaeche-group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
