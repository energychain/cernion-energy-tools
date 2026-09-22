export function ProjectedResultView({ children }: { children?: React.ReactNode }) {
  return (
    <section className="projected-result-view">
      <h3>Projiziertes Ergebnis</h3>
      {children}
    </section>
  );
}
