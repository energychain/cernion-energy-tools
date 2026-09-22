import type { ReactNode } from 'react';

export function GrammarPart({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="grammar-part" data-grammar-part={id}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
