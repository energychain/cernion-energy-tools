export function OperationPermissionPanel({
  allowed,
  reason,
}: {
  allowed?: boolean;
  reason?: string;
}) {
  return (
    <aside className="operation-permission-panel">
      {allowed
        ? 'Ausführung im UI-Gateway erlaubt'
        : `Nicht erlaubt: ${reason || 'Governance-Policy'}`}
    </aside>
  );
}
