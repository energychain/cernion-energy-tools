import { NotProjectedBadge } from '../status/NotProjectedBadge';

export function UnprojectedRawJsonView({ unprojected }: { unprojected?: { raw?: unknown } }) {
  return (
    <section className="unprojected-raw-json-view" aria-label="Nicht projiziert">
      <NotProjectedBadge />
      <p>Dieses JSON ist unprojected und keine Evidence.</p>
      <pre>{JSON.stringify(unprojected?.raw, null, 2)}</pre>
    </section>
  );
}

export const NotProjectedResultPanel = UnprojectedRawJsonView;
