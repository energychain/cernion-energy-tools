export function AllowedBlockedActionsList({
  allowed = [],
  blocked = [],
}: {
  allowed?: string[];
  blocked?: string[];
}) {
  return (
    <section className="allowed-blocked-actions">
      <h3>Erlaubte und blockierte Aktionen</h3>
      <h4>Erlaubt</h4>
      <ul>
        {allowed.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <h4>Blockiert</h4>
      <ul>
        {blocked.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
