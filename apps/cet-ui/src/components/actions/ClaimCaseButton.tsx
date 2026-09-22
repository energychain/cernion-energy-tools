import { BasisRevActionButton } from './BasisRevActionButton';

export function ClaimCaseButton({
  basisRev,
  onAction,
}: {
  basisRev?: string;
  onAction?: (basisRev: string) => void;
}) {
  return (
    <BasisRevActionButton
      basisRev={basisRev}
      label="Mir zuweisen"
      kind="CET-intern"
      onAction={onAction}
    />
  );
}
