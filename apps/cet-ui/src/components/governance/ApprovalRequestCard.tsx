function approvalLabel(status?: string, actorName?: string, roleId?: string) {
  const actor = actorName || roleId || 'Person oder Agent';
  if (status === 'erteilt') return `Freigabe erteilt durch ${actor}`;
  if (status === 'verweigert') return `Freigabe verweigert durch ${actor}`;
  if (status === 'angefordert') return 'Freigabe angefordert';
  if (status === 'erforderlich') return 'Freigabe erforderlich';
  return 'Freigabestatus offen';
}

function attributionMissing(
  status?: string,
  actorName?: string,
  roleId?: string,
  actedAt?: string
) {
  return (status === 'erteilt' || status === 'verweigert') && (!actedAt || (!actorName && !roleId));
}

export function ApprovalRequestCard({
  status = 'angefordert',
  roleId,
  actorName,
  actedAt,
  requestedAt,
}: {
  status?: string;
  roleId?: string;
  actorName?: string;
  actedAt?: string;
  requestedAt?: string;
}) {
  const missingAttribution = attributionMissing(status, actorName, roleId, actedAt);
  return (
    <article
      className="approval-request-card"
      data-attribution={missingAttribution ? 'missing' : 'complete'}
    >
      <h3>Freigabeanforderung</h3>
      <span className="status-badge approval-status">
        {approvalLabel(status, actorName, roleId)}
      </span>
      <p>{roleId || 'Rolle offen'}</p>
      {actorName ? <p className="meta">Akteur: {actorName}</p> : null}
      {actedAt ? <p className="meta">Entscheidungszeitpunkt: {actedAt}</p> : null}
      {requestedAt ? <p className="meta">Angefordert: {requestedAt}</p> : null}
      {missingAttribution ? (
        <p className="error">
          Attribution fehlt: erteilte oder verweigerte Freigaben benötigen Akteur/Rolle und
          Zeitpunkt.
        </p>
      ) : null}
    </article>
  );
}
