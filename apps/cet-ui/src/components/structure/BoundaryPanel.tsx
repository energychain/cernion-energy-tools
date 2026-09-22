export type BoundaryItem = { was?: string; grund?: string };

export function BoundaryPanel({ items }: { items?: BoundaryItem[] }) {
  if (!items || items.length === 0) {
    return (
      <aside className="boundary-panel boundary-panel--invalid">
        Grenzen dieser Ansicht fehlen; Anzeige ist unvollständig.
      </aside>
    );
  }

  return (
    <aside className="boundary-panel">
      <h3>Grenzen dieser Ansicht</h3>
      {items.map((item) => (
        <p key={`${item.was}-${item.grund}`}>
          <strong>{item.was || 'Nicht vorgesehen'}</strong>:{' '}
          {item.grund || 'Keine Begründung angegeben'}
        </p>
      ))}
    </aside>
  );
}
