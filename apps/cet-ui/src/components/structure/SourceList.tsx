export type SourceItem = { ref?: string; label?: string; stand?: string };

export function SourceList({ sources = [] }: { sources?: SourceItem[] }) {
  return (
    <section className="source-list">
      <h3>Quellen</h3>
      <ul>
        {sources.map((source) => (
          <li key={source.ref || source.label}>
            {source.label || source.ref} {source.stand ? `· ${source.stand}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
