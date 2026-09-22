import type { ReactNode } from 'react';

export type GovernanceTone =
  | 'arbeitsstand'
  | 'gesichert'
  | 'entscheidungsreif'
  | 'klaerung_offen'
  | 'ungeprueft'
  | 'nicht_projiziert'
  | 'quelle_reproduzierbar'
  | 'blocked';

export type RoleActorModel = {
  roleLabel: string;
  actorName?: string;
  tenantLabel?: string;
  placeholderAgent?: boolean;
  status?: 'uebernommen' | 'zugewiesen' | 'beobachten' | 'agent_bedient_rolle';
};

export type EvidenceStatementModel = {
  id?: string;
  label: string;
  granularitaet: 'aggregat' | 'einzeldatensatz';
  status?: 'belegt' | 'klaerung_offen' | 'ungeprueft' | 'quelle_nicht_erreichbar';
  sourceRef?: string;
};

export type BoundaryModel = {
  was: string;
  grund: string;
};

export type DecisionCriterionModel = {
  id: string;
  label: string;
  state: 'erfuellt' | 'offen' | 'nicht_anwendbar';
  reason?: string;
};

export type ApprovalModel = {
  status: 'offen' | 'angefordert' | 'erteilt' | 'verweigert';
  actorName?: string;
  roleLabel?: string;
  actedAt?: string;
};

export type TakeoverStateModel = {
  status:
    | 'unbeansprucht'
    | 'von_mir_uebernommen'
    | 'visible_no_action'
    | 'mir_zugewiesen'
    | 'durch_agent_uebernommen';
  actorName?: string;
};

export type ActionModel = {
  id: string;
  label: string;
  writeClass: 'read' | 'cet_internal_write' | 'external_write_unavailable' | 'hitl';
  disabledReason?: string;
};

export const grammarPartOrder = ['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe'];

const toneLabels: Record<GovernanceTone, string> = {
  arbeitsstand: 'Arbeitsstand',
  gesichert: 'Gesicherter Stand',
  entscheidungsreif: 'Entscheidungsreif',
  klaerung_offen: 'Klärung offen',
  ungeprueft: 'Ungeprüft',
  nicht_projiziert: 'Nicht projiziert',
  quelle_reproduzierbar: 'nur mit Quelle reproduzierbar',
  blocked: 'Blockiert',
};

function cssToken(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

export function StatusBadge({ tone, label }: { tone: GovernanceTone; label?: string }) {
  return (
    <span className={`status-badge status-badge--${cssToken(tone)}`}>
      {label || toneLabels[tone]}
    </span>
  );
}

export function RoleActor({ actor }: { actor: RoleActorModel }) {
  const actorLabel = actor.placeholderAgent
    ? `durch Agent ${actor.actorName || actor.roleLabel}`
    : actor.actorName || 'nicht persönlich besetzt';
  return (
    <span className="role-actor" data-placeholder-agent={actor.placeholderAgent ? 'true' : 'false'}>
      <strong>{actor.roleLabel}</strong> · {actorLabel}
      {actor.tenantLabel ? <span className="meta"> · Mandant: {actor.tenantLabel}</span> : null}
    </span>
  );
}

export function EvidenceMarker({ statement }: { statement: EvidenceStatementModel }) {
  const label =
    statement.granularitaet === 'einzeldatensatz'
      ? 'nur mit Quelle reproduzierbar'
      : statement.status === 'klaerung_offen'
        ? 'Klärung offen'
        : statement.status === 'ungeprueft'
          ? 'Ungeprüft'
          : statement.status === 'quelle_nicht_erreichbar'
            ? 'Quelle nicht erreichbar'
            : 'Belegt';
  return (
    <span className={`evidence-marker evidence-marker--${cssToken(statement.granularitaet)}`}>
      {label}
    </span>
  );
}

function approvalRequiresAttribution(approval: ApprovalModel): boolean {
  return (
    (approval.status === 'erteilt' || approval.status === 'verweigert') &&
    (!approval.actedAt || (!approval.actorName && !approval.roleLabel))
  );
}

export function BoundaryBox({ nichtHandlungen }: { nichtHandlungen?: BoundaryModel[] }) {
  if (!nichtHandlungen || !nichtHandlungen.length) {
    return (
      <aside className="boundary-box boundary-box--invalid">Grenzen dieser Ansicht fehlen.</aside>
    );
  }
  return (
    <aside className="boundary-box" aria-label="Grenzen dieser Ansicht">
      <h3>Grenzen dieser Ansicht</h3>
      {nichtHandlungen.map((boundary) => (
        <p key={`${boundary.was}-${boundary.grund}`}>
          <strong>{boundary.was}:</strong> {boundary.grund}
        </p>
      ))}
    </aside>
  );
}

export function NextContributionCard({
  type,
  text,
  roleLabel,
  requiredFor,
}: {
  type: 'klaeren' | 'bestaetigen' | 'ergaenzen' | 'freigeben' | 'weitergeben' | 'keiner';
  text: string;
  roleLabel: string;
  requiredFor: string;
}) {
  return (
    <article className="next-contribution-card">
      <p className="meta">Nächster Beitrag · {type}</p>
      <h3>{text}</h3>
      <p>
        Rolle: {roleLabel} · Erforderlich für: {requiredFor}
      </p>
    </article>
  );
}

export function DecisionDistanceList({ criteria }: { criteria: DecisionCriterionModel[] }) {
  const visible = criteria.filter((criterion) => criterion.state !== 'nicht_anwendbar');
  const collapsed = criteria.filter((criterion) => criterion.state === 'nicht_anwendbar');
  return (
    <section className="decision-distance-list">
      <h3>Entscheidungsdistanz</h3>
      {visible.map((criterion) => (
        <p key={criterion.id} data-state={criterion.state}>
          <StatusBadge tone={criterion.state === 'erfuellt' ? 'gesichert' : 'klaerung_offen'} />{' '}
          {criterion.label}
          {criterion.reason ? <span className="meta"> · {criterion.reason}</span> : null}
        </p>
      ))}
      {collapsed.length ? (
        <p className="meta">{collapsed.length} nicht anwendbare Kriterien eingeklappt.</p>
      ) : null}
    </section>
  );
}

export function ApprovalPanel({ approval }: { approval: ApprovalModel }) {
  const actor = approval.actorName || approval.roleLabel || 'zuständige Rolle';
  const label =
    approval.status === 'erteilt'
      ? `Freigabe erteilt durch ${actor}`
      : approval.status === 'verweigert'
        ? `Freigabe verweigert durch ${actor}`
        : approval.status === 'angefordert'
          ? 'Freigabe angefordert'
          : 'Freigabe offen';
  const missingAttribution = approvalRequiresAttribution(approval);
  return (
    <section
      className="approval-panel"
      data-status={approval.status}
      data-attribution={missingAttribution ? 'missing' : 'complete'}
    >
      <h3>{label}</h3>
      {approval.actedAt ? <p className="meta">Zeitpunkt: {approval.actedAt}</p> : null}
      {missingAttribution ? (
        <p className="error">Freigabeentscheidung ohne Attribution unvollständig.</p>
      ) : null}
      <p className="meta">
        Das System entscheidet nicht; die Entscheidung bleibt bei Person oder Rolle.
      </p>
    </section>
  );
}

export function TakeoverStatePanel({ state }: { state: TakeoverStateModel }) {
  const labelByState = {
    unbeansprucht: 'Unbeansprucht',
    von_mir_uebernommen: 'Von mir übernommen',
    visible_no_action: `In Bearbeitung durch ${state.actorName || 'zuständige Rolle'}`,
    mir_zugewiesen: 'Mir zugewiesen',
    durch_agent_uebernommen: `durch Agent ${state.actorName || 'der Rolle'} übernommen`,
  } satisfies Record<TakeoverStateModel['status'], string>;
  return <section className="takeover-state-panel">{labelByState[state.status]}</section>;
}

export function GrammarSection({
  part,
  title,
  children,
}: {
  part: (typeof grammarPartOrder)[number];
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="grammar-section" data-grammar-part={part}>
      <h3>{title || part}</h3>
      {children}
    </section>
  );
}

export function RawJsonNotProjectedPanel({ raw }: { raw: unknown }) {
  return (
    <section className="raw-json-not-projected-panel">
      <StatusBadge tone="nicht_projiziert" />
      <p>
        Diese Rohantwort ist nicht projiziert, hat keinen Aggregatzustand und keine Evidenzmarker.
      </p>
      <pre>{JSON.stringify(raw, null, 2)}</pre>
    </section>
  );
}

export function SafeActionBar({ actions }: { actions: ActionModel[] }) {
  const labelByWriteClass = {
    read: 'Lesender Vorgang',
    cet_internal_write: 'CET-interner Schreibvorgang',
    external_write_unavailable: 'Externer Schreibvorgang nicht angebunden',
    hitl: 'HITL erforderlich',
  } satisfies Record<ActionModel['writeClass'], string>;
  return (
    <div className="safe-action-bar">
      {actions.map((action) => (
        <button key={action.id} type="button" disabled={Boolean(action.disabledReason)}>
          {action.label} · {labelByWriteClass[action.writeClass]}
          {action.disabledReason ? ` · ${action.disabledReason}` : ''}
        </button>
      ))}
    </div>
  );
}

export function SinceLastAccessNotice({ changes }: { changes: string[] }) {
  if (!changes.length) return null;
  return (
    <aside className="since-last-access-notice">
      <h3>Seit deinem letzten Zugriff</h3>
      {changes.map((change) => (
        <p key={change}>{change}</p>
      ))}
    </aside>
  );
}

export function ProvenanceDisclosure({
  label,
  version,
  source,
}: {
  label: 'Standardansicht' | 'Hausansicht' | 'Neu zusammengestellt';
  version: string;
  source: string;
}) {
  return (
    <details className="provenance-disclosure">
      <summary>{label}</summary>
      <p>
        Version {version} · Herkunft: {source}
      </p>
    </details>
  );
}
