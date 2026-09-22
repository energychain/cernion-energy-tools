import { BasisRevActionButton } from './BasisRevActionButton';

export function FreezeCaseButton({
  basisRev,
  onAction,
}: {
  basisRev?: string;
  onAction?: (basisRev: string) => void;
}) {
  return (
    <BasisRevActionButton
      basisRev={basisRev}
      label="Einfrieren"
      kind="CET-intern"
      onAction={onAction}
    />
  );
}
