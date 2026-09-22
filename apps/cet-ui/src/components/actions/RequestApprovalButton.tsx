import { BasisRevActionButton } from './BasisRevActionButton';

export function RequestApprovalButton({
  basisRev,
  onAction,
}: {
  basisRev?: string;
  onAction?: (basisRev: string) => void;
}) {
  return (
    <BasisRevActionButton
      basisRev={basisRev}
      label="Freigabe anfordern"
      kind="HITL"
      onAction={onAction}
    />
  );
}
