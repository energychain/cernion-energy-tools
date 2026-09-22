export type BasisRevActionButtonProps = {
  basisRev?: string;
  label: string;
  onAction?: (basisRev: string) => void;
  kind?: 'CET-intern' | 'HITL' | 'blocked' | 'external/not connected';
};

export function BasisRevActionButton({
  basisRev,
  label,
  onAction,
  kind = 'CET-intern',
}: BasisRevActionButtonProps) {
  return (
    <button
      type="button"
      disabled={!basisRev}
      title={basisRev ? `${kind} · BasisRev ${basisRev}` : 'basisRev erforderlich'}
      onClick={() => basisRev && onAction?.(basisRev)}
    >
      {label}
    </button>
  );
}
