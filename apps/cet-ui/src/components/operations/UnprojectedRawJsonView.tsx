export function UnprojectedRawJsonView({ unprojected }: { unprojected?: { raw?: unknown } }) {
  return (
    <section className="unprojected-raw-json-view" aria-label="Nicht projiziert">
      <span className="status-badge not-projected" aria-label="Nicht projiziert">
        Nicht projiziert
      </span>
      <p>Dieses JSON ist nicht projiziert, bleibt Rohantwort und ist kein Nachweis.</p>
      <pre>{JSON.stringify(unprojected?.raw, null, 2)}</pre>
    </section>
  );
}

export const NotProjectedResultPanel = UnprojectedRawJsonView;
