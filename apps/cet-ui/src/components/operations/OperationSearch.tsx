export function OperationSearch({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label>
      Operation suchen
      <input value={value || ''} onChange={(event) => onChange?.(event.target.value)} />
    </label>
  );
}
