export type TenantBadgeProps = { tenantId?: string; label?: string };

export function TenantBadge({ tenantId, label }: TenantBadgeProps) {
  return (
    <span className="identity-badge tenant-badge" title={tenantId}>
      Mandant: {label || tenantId || 'Mandant offen'}
    </span>
  );
}
