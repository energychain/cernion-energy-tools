export type BoundaryItem = { was?: string; grund?: string };

export function BoundaryPanel({ items = [] }: { items?: BoundaryItem[] }) {
  return (
    <aside className="boundary-panel">
      <h3>Grenzen dieser Ansicht</h3>
      {items.map((item) => (
        <p key={`${item.was}-${item.grund}`}>
          <strong>{item.was}</strong>: {item.grund}
        </p>
      ))}
    </aside>
  );
}
