import { useEffect, useMemo, useState } from 'react';
import { ActorBadge } from './components/identity/ActorBadge';
import { RoleSelector } from './components/identity/RoleSelector';
import { BoundaryPanel } from './components/structure/BoundaryPanel';
import { GrammarPart } from './components/structure/GrammarPart';
import { ClaimCaseButton } from './components/actions/ClaimCaseButton';
import { FreezeCaseButton } from './components/actions/FreezeCaseButton';
import { RequestApprovalButton } from './components/actions/RequestApprovalButton';
import { ApprovalRequestCard } from './components/governance/ApprovalRequestCard';
import { OperationPermissionPanel } from './components/operations/OperationPermissionPanel';
import { UnprojectedRawJsonView } from './components/operations/UnprojectedRawJsonView';
import './styles.css';

type HttpMethod = 'GET' | 'POST';

type ApiClient = {
  getSessionContext: () => Promise<SessionContext>;
  getDailySurface: () => Promise<DailySurface>;
  getCase: (id: string) => Promise<Vorgang>;
  getEvidenceDossier: (id: string) => Promise<EvidenceDossier>;
  claimCase: (id: string, basisRev: string) => Promise<unknown>;
  freezeCase: (id: string, payload: Record<string, unknown>) => Promise<unknown>;
  requestApproval: (id: string, payload: Record<string, unknown>) => Promise<unknown>;
  listOperations: () => Promise<OperationsPayload>;
  runOperation: (
    operationId: string,
    payload: Record<string, unknown>
  ) => Promise<PreparedOperation>;
  recordAudit: (payload: Record<string, unknown>) => Promise<unknown>;
};

type RoleCandidate = {
  roleId?: string;
  id?: string;
  label?: string;
  available?: boolean;
  placeholderAgent?: boolean;
};

type SessionContext = {
  tenantId?: string;
  tenant?: { label?: string };
  userId?: string;
  user?: { displayName?: string };
  roles?: Array<{ id: string; label?: string }>;
  activeRoleId?: string;
  activeRoleCandidates?: RoleCandidate[];
  availableRoles?: RoleCandidate[];
};

type DailyItem = {
  caseId: string;
  title?: string;
  prominence?: string;
  aufmerksamkeitsgrund?: string;
  interactionProjection?: {
    naechsterBeitrag?: {
      kind?: string;
      textKey?: string;
    };
  };
};

type DailySurface = {
  activeRoleId?: string;
  items?: DailyItem[];
};

type Statement = {
  id?: string;
  label?: string;
  wert?: string | number | boolean;
  einheit?: string;
  granularitaet?: string;
  quelle?: { ref?: string };
  source?: { ref?: string };
};

type Vorgang = {
  caseId: string;
  label?: string;
  primaryRoleId?: string;
  visibleStatus?: string;
  basisRev?: string;
  assignment?: { actor?: { displayName?: string; id?: string }; status?: string };
  presentationContract?: {
    titel?: string;
    aussagen?: Statement[];
    nichtHandlungen?: Array<{ was?: string; grund?: string }>;
  };
};

type EvidenceDossier = {
  frozenAt?: string;
  materializedStatements?: Statement[];
  approvalRequests?: Array<{
    status?: string;
    roleId?: string;
    actorName?: string;
    actedAt?: string;
    requestedAt?: string;
  }>;
  hashRefOnlyNotices?: Array<{ label?: string; sourceRef?: string; notice?: string }>;
};

type Operation = {
  id: string;
  label?: string;
  mode?: string;
  method?: string;
  riskClass?: string;
  pathTemplate?: string;
};

type OperationsPayload = {
  available?: Operation[];
};

type PreparedOperation = {
  projectionStatus?: string;
  unprojected?: { raw?: unknown };
};

type AppState = {
  session?: SessionContext;
  daily?: DailySurface;
  vorgang?: Vorgang;
  evidence?: EvidenceDossier;
  operations?: OperationsPayload;
  preparedOperation?: PreparedOperation;
  error?: string;
};

const grammarSections = [
  { id: 'vorgang', title: 'Vorgang' },
  { id: 'quellen', title: 'Quellen' },
  { id: 'pruefung', title: 'Prüfung' },
  { id: 'unsicherheit', title: 'Unsicherheit' },
  { id: 'freigabe', title: 'Freigabe' },
];

const feinkonzeptSourceMarkers = [
  'Nicht projiziert',
  'Dieses Ergebnis ist noch nicht in eine belegte Vorgangsdarstellung projiziert',
];

type BrowserAuthConfig = {
  token?: string;
  tenantId?: string;
  activeRoleId?: string;
};

declare global {
  interface Window {
    __CET_UI_AUTH__?: BrowserAuthConfig;
  }
}

function getMetaContent(name: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
}

function getBrowserAuthConfig(): BrowserAuthConfig {
  return {
    token: window.__CET_UI_AUTH__?.token || getMetaContent('cet-ui-token'),
    tenantId: window.__CET_UI_AUTH__?.tenantId || getMetaContent('cet-ui-tenant-id'),
    activeRoleId: window.__CET_UI_AUTH__?.activeRoleId || getMetaContent('cet-ui-active-role-id'),
  };
}

async function requestJson<T>(
  path: string,
  method: HttpMethod = 'GET',
  body?: unknown
): Promise<T> {
  const authConfig = getBrowserAuthConfig();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authConfig.token) headers.Authorization = `Bearer ${authConfig.token}`;
  if (authConfig.tenantId) headers['x-tenant-id'] = authConfig.tenantId;
  if (authConfig.activeRoleId) headers['x-cet-ui-active-role-id'] = authConfig.activeRoleId;

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function createBrowserApiClient(): ApiClient {
  return {
    getSessionContext: () => requestJson<SessionContext>('/ui/v0/session-context'),
    getDailySurface: () => requestJson<DailySurface>('/ui/v0/daily-surface'),
    getCase: (id) => requestJson<Vorgang>(`/ui/v0/cases/${encodeURIComponent(id)}`),
    getEvidenceDossier: (id) =>
      requestJson<EvidenceDossier>(`/ui/v0/cases/${encodeURIComponent(id)}/evidence`),
    claimCase: (id, basisRev) =>
      requestJson<Vorgang>(`/ui/v0/cases/${encodeURIComponent(id)}/claim`, 'POST', {
        basisRev,
      }),
    freezeCase: (id, payload) =>
      requestJson<EvidenceDossier>(
        `/ui/v0/cases/${encodeURIComponent(id)}/freeze`,
        'POST',
        payload
      ),
    requestApproval: (id, payload) =>
      requestJson<EvidenceDossier>(
        `/ui/v0/cases/${encodeURIComponent(id)}/approval-requests`,
        'POST',
        payload
      ),
    listOperations: () => requestJson<OperationsPayload>('/ui/v0/operations'),
    runOperation: (operationId, payload) =>
      requestJson<PreparedOperation>(
        `/ui/v0/operations/${encodeURIComponent(operationId)}/prepare`,
        'POST',
        payload
      ),
    recordAudit: (payload) => requestJson<unknown>('/ui/v0/audit-events', 'POST', payload),
  };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function StatementList({ statements }: { statements?: Statement[] }) {
  return (
    <>
      {(statements || []).map((statement) => (
        <div key={statement.id || statement.label}>
          <p>
            <strong>{statement.label}:</strong> {displayValue(statement.wert)}
          </p>
          <p className="meta">
            <span className="evidence-receipt-link">
              Nachweis ·{' '}
              {statement.granularitaet === 'einzeldatensatz'
                ? 'nur mit Quelle reproduzierbar'
                : 'aggregat'}
            </span>{' '}
            · {statement.quelle?.ref || statement.source?.ref}
          </p>
        </div>
      ))}
    </>
  );
}

function SessionPanel({ session }: { session?: SessionContext }) {
  if (!session) return <div className="session-shell">Lade Rollen- und Mandantenkontext …</div>;
  const roleLabels = Object.fromEntries(
    (session.roles || []).map((role) => [role.id, role.label || role.id])
  );
  const activeRoleId =
    session.activeRoleId || session.activeRoleCandidates?.find((role) => role.available)?.roleId;
  const candidates = session.activeRoleCandidates || session.availableRoles || [];
  return (
    <div className="session-shell" aria-live="polite">
      <p>
        <strong>Mandant:</strong> {session.tenant?.label || session.tenantId} ·{' '}
        <strong>Benutzer:</strong> {session.user?.displayName || session.userId}
      </p>
      <p className="meta">
        <ActorBadge
          roleId={activeRoleId}
          displayName={session.user?.displayName || session.userId}
          label={roleLabels[activeRoleId || ''] || activeRoleId || 'Rolle offen'}
          placeholderAgent={candidates.some(
            (role) => (role.roleId || role.id) === activeRoleId && role.placeholderAgent
          )}
        />
      </p>
      <RoleSelector
        activeRoleId={activeRoleId}
        roles={candidates.map((role) => ({
          roleId: role.roleId || role.id || '',
          label: role.label || roleLabels[role.roleId || role.id || ''],
          available: role.available,
          placeholderAgent: role.placeholderAgent,
        }))}
      />
      <p className="meta">
        Rollenwechsel bleibt auf tatsächlich gehaltene Mandantenrollen begrenzt.
      </p>
    </div>
  );
}

function DailyPanel({ daily, onOpen }: { daily?: DailySurface; onOpen: (caseId: string) => void }) {
  return (
    <section id="daily" className="panel" aria-live="polite">
      <p className="meta">Tagesfläche · {daily?.activeRoleId || 'lädt'}</p>
      <div className="grid">
        {(daily?.items || []).map((item) => (
          <article className="card" key={item.caseId}>
            <span className="badge">
              {item.interactionProjection?.naechsterBeitrag?.kind || item.prominence || ''}
            </span>
            <h2>{item.title}</h2>
            <p>
              {item.interactionProjection?.naechsterBeitrag?.textKey || item.aufmerksamkeitsgrund}
            </p>
            <button type="button" onClick={() => onOpen(item.caseId)}>
              Vorgang öffnen
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function CasePanel({
  vorgang,
  onClaim,
  onFreeze,
  onApproval,
}: {
  vorgang?: Vorgang;
  onClaim: (basisRev: string) => void;
  onFreeze: (basisRev: string) => void;
  onApproval: (basisRev: string) => void;
}) {
  const statements = vorgang?.presentationContract?.aussagen || [];
  return (
    <section id="case" className="panel" aria-live="polite">
      <p className="meta">Vorgangsansicht · {vorgang?.primaryRoleId || 'lädt'}</p>
      <h2>{vorgang?.label || vorgang?.presentationContract?.titel || 'Lade Vorgang …'}</h2>
      <p>{vorgang?.visibleStatus}</p>
      <span className="status-badge handling-status">
        {vorgang?.visibleStatus === 'visible_no_action'
          ? `In Bearbeitung durch ${vorgang?.assignment?.actor?.displayName || vorgang?.primaryRoleId || 'zuständige Rolle'}`
          : vorgang?.visibleStatus || 'Bearbeitungsstatus offen'}
      </span>
      <div className="grid">
        {grammarSections.map((section) => (
          <GrammarPart id={section.id} title={section.title} key={section.id}>
            {(section.id === 'vorgang' || section.id === 'quellen') && (
              <StatementList statements={statements} />
            )}
            {section.id === 'freigabe' && (
              <ApprovalRequestCard status="offen" roleId={vorgang?.primaryRoleId} />
            )}
          </GrammarPart>
        ))}
        <BoundaryPanel items={vorgang?.presentationContract?.nichtHandlungen} />
      </div>
      <ClaimCaseButton basisRev={vorgang?.basisRev} onAction={onClaim} />
      <FreezeCaseButton basisRev={vorgang?.basisRev} onAction={onFreeze} />
      <RequestApprovalButton basisRev={vorgang?.basisRev} onAction={onApproval} />
    </section>
  );
}

function EvidencePanel({ evidence }: { evidence?: EvidenceDossier }) {
  return (
    <section id="evidence" className="panel" aria-live="polite">
      <p className="meta">Nachweisansicht</p>
      <p>
        <strong>Freeze:</strong> {evidence?.frozenAt ? 'eingefroren' : 'offen'}
      </p>
      <p>
        <strong>Stand:</strong> {evidence?.frozenAt || ''}
      </p>
      <div className="grid">
        {(evidence?.materializedStatements || []).map((statement) => (
          <article className="card" key={statement.id || statement.label}>
            <span className="evidence-receipt-link">
              Nachweis ·{' '}
              {statement.granularitaet === 'einzeldatensatz'
                ? 'nur mit Quelle reproduzierbar'
                : 'aggregat'}
            </span>
            <h3>{statement.label}</h3>
            <p>
              {displayValue(statement.wert)} {statement.einheit || ''}
            </p>
            <p className="meta">{statement.source?.ref || statement.quelle?.ref}</p>
          </article>
        ))}
        {(evidence?.approvalRequests || []).map((request, index) => (
          <ApprovalRequestCard
            key={`${request.status}-${request.roleId}-${index}`}
            status={request.status}
            roleId={request.roleId}
            actorName={request.actorName}
            actedAt={request.actedAt}
            requestedAt={request.requestedAt}
          />
        ))}
        {(evidence?.hashRefOnlyNotices || []).map((notice) => (
          <article className="card boundary" key={`${notice.label}-${notice.sourceRef}`}>
            <span className="status-badge aggregate-state">Quelle reproduzierbar</span>
            <h3>{notice.label}</h3>
            <p>Nur mit Quelle reproduzierbar.</p>
            <p className="meta">
              {notice.sourceRef} · {notice.notice}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function OperationsPanel({
  operations,
  preparedOperation,
  onPrepare,
}: {
  operations?: OperationsPayload;
  preparedOperation?: PreparedOperation;
  onPrepare: (operationId: string) => void;
}) {
  return (
    <section id="operations" className="panel" aria-live="polite">
      <p className="meta">Operationskonsole</p>
      <p className="meta">Die Nutzung der Konsole wird als Bedarfssignal protokolliert.</p>
      <div className="grid">
        {(operations?.available || []).map((operation) => (
          <article className="card" key={operation.id}>
            <span className="badge">{operation.mode}</span>
            <h3>{operation.label}</h3>
            <p>{operation.pathTemplate}</p>
            <p className="meta">
              {operation.method} · {operation.riskClass}
            </p>
            <button type="button" onClick={() => onPrepare(operation.id)}>
              Vorbereiten
            </button>
            <OperationPermissionPanel
              allowed={operation.method === 'GET'}
              reason={
                operation.method === 'GET'
                  ? undefined
                  : 'CET-interner Schreibvorgang nur vorbereitet'
              }
            />
          </article>
        ))}
      </div>
      {preparedOperation ? (
        <UnprojectedRawJsonView unprojected={preparedOperation.unprojected} />
      ) : null}
    </section>
  );
}

export function App({ apiClient = createBrowserApiClient() }: { apiClient?: ApiClient }) {
  const client = useMemo(() => apiClient, [apiClient]);
  const [state, setState] = useState<AppState>({});

  async function recordViewOpened(view: string) {
    await client
      .recordAudit({ event: 'view_opened', transport: 'ui_gateway', view })
      .catch(() => undefined);
  }

  async function refreshCaseViews(caseId: string) {
    const [vorgang, evidence] = await Promise.all([
      client.getCase(caseId),
      client.getEvidenceDossier(caseId),
    ]);
    setState((current) => ({ ...current, vorgang, evidence, error: undefined }));
  }

  async function openCase(caseId: string) {
    await refreshCaseViews(caseId);
    await recordViewOpened('vorgangsansicht');
  }

  async function refresh() {
    try {
      const [session, daily, operations] = await Promise.all([
        client.getSessionContext(),
        client.getDailySurface(),
        client.listOperations(),
      ]);
      setState((current) => ({ ...current, session, daily, operations, error: undefined }));
      await recordViewOpened('tagesflaeche');
      const firstCaseId = daily.items?.[0]?.caseId;
      if (firstCaseId) await openCase(firstCaseId);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function withCurrentCase(action: (caseId: string, basisRev: string) => Promise<void>) {
    const caseId = state.vorgang?.caseId;
    const basisRev = state.vorgang?.basisRev;
    if (!caseId || !basisRev) return;
    try {
      await action(caseId, basisRev);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return (
    <main className="app-shell" data-feinkonzept-markers={feinkonzeptSourceMarkers.join('|')}>
      <header className="app-header">
        <p className="eyebrow">Cernion Energy Tools · RC2</p>
        <h1>Vorgänge</h1>
        <p>Deterministische Tagesfläche, Vorgangsansicht, Nachweisansicht und Operationskonsole.</p>
        <SessionPanel session={state.session} />
        <nav className="app-nav" aria-label="Hauptbereiche">
          <a href="#daily">Heute</a>
          <a href="#case">Vorgang</a>
          <a href="#evidence">Nachweise</a>
          <a href="#operations">Konsole</a>
        </nav>
        {state.error ? <p className="error">{state.error}</p> : null}
      </header>
      <DailyPanel daily={state.daily} onOpen={(caseId) => void openCase(caseId)} />
      <CasePanel
        vorgang={state.vorgang}
        onClaim={(basisRev) =>
          void withCurrentCase(async (caseId) => {
            await client.claimCase(caseId, basisRev);
            await refreshCaseViews(caseId);
            await recordViewOpened('vorgang_claim');
          })
        }
        onFreeze={(basisRev) =>
          void withCurrentCase(async (caseId) => {
            await client.freezeCase(caseId, { basisRev });
            await refreshCaseViews(caseId);
            await recordViewOpened('nachweis_einfrieren');
          })
        }
        onApproval={(basisRev) =>
          void withCurrentCase(async (caseId) => {
            await client.requestApproval(caseId, { basisRev });
            await refreshCaseViews(caseId);
            await recordViewOpened('freigabe_anfordern');
          })
        }
      />
      <EvidencePanel evidence={state.evidence} />
      <OperationsPanel
        operations={state.operations}
        preparedOperation={state.preparedOperation}
        onPrepare={(operationId) =>
          void withCurrentCase(async () => {
            const preparedOperation = await client.runOperation(operationId, {});
            setState((current) => ({ ...current, preparedOperation }));
            await recordViewOpened('operationskonsole');
          })
        }
      />
    </main>
  );
}

export default App;
