export function HistoryExcerpt({ entries = [] }: { entries?: string[] }) {
  return (
    <section className="history-excerpt">
      <h3>Historie</h3>
      <ol>
        {entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ol>
    </section>
  );
}
