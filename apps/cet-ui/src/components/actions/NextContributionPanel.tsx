export function NextContributionPanel({ text, kind }: { text?: string; kind?: string }) {
  return (
    <section className="next-contribution-panel">
      <h3>Nächster Beitrag</h3>
      <p>{text || 'Beitrag offen'}</p>
      <p className="meta">{kind || 'Beitragsart offen'}</p>
    </section>
  );
}
