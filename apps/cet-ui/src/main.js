/* global document, fetch */
'use strict';

const api = {
  daily: '/api/ui/v0/daily-surface',
  case: (id) => `/api/ui/v0/cases/${encodeURIComponent(id)}`,
  evidence: (id) => `/api/ui/v0/cases/${encodeURIComponent(id)}/evidence`,
  operations: '/api/ui/v0/operations',
  prepareOperation: (id) => `/api/ui/v0/operations/${encodeURIComponent(id)}/prepare`,
};

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDaily(surface) {
  return `
    <p class="meta">Tagesfläche · ${escapeHtml(surface.activeRoleId)}</p>
    <div class="grid">
      ${(surface.items || [])
        .map(
          (item) => `
            <article class="card">
              <span class="badge">${escapeHtml(item.interactionProjection?.naechsterBeitrag?.kind || '')}</span>
              <h2>${escapeHtml(item.title)}</h2>
              <p>${escapeHtml(item.interactionProjection?.naechsterBeitrag?.textKey || '')}</p>
              <button data-open-case="${escapeHtml(item.caseId)}">Vorgang öffnen</button>
            </article>`
        )
        .join('')}
    </div>`;
}

function renderCase(vorgang) {
  const statements = vorgang.presentationContract?.aussagen || [];
  return `
    <p class="meta">Vorgangsansicht · ${escapeHtml(vorgang.primaryRoleId)}</p>
    <h2>${escapeHtml(vorgang.label || vorgang.presentationContract?.titel)}</h2>
    <p>${escapeHtml(vorgang.visibleStatus)}</p>
    <div class="grid">
      <article class="section">
        <h3>${escapeHtml(vorgang.presentationContract?.titel || 'Aussagen')}</h3>
        ${statements
          .map(
            (statement) => `
              <p><strong>${escapeHtml(statement.label)}:</strong> ${escapeHtml(statement.wert)}</p>
              <p class="meta">${escapeHtml(statement.granularitaet)} · ${escapeHtml(
                statement.quelle?.ref
              )}</p>`
          )
          .join('')}
        ${(vorgang.presentationContract?.nichtHandlungen || [])
          .map(
            (boundary) => `
              <div class="card boundary">
                <strong>Grenze:</strong> ${escapeHtml(boundary.was)}<br />
                ${escapeHtml(boundary.grund)}
              </div>`
          )
          .join('')}
      </article>
    </div>
    <button data-action="claim" data-case="${escapeHtml(vorgang.caseId)}">Mir zuweisen</button>
    <button class="secondary" data-action="freeze" data-case="${escapeHtml(vorgang.caseId)}">Einfrieren</button>
    <button class="secondary" data-action="approval" data-case="${escapeHtml(
      vorgang.caseId
    )}">Freigabe anfordern</button>`;
}

function renderEvidence(evidence) {
  return `
    <p class="meta">Nachweisansicht</p>
    <p><strong>Freeze:</strong> ${escapeHtml(evidence.freeze?.status || 'offen')}</p>
    <p><strong>Freigabeanforderungen:</strong> ${(evidence.approvalRequests || []).length}</p>
    <div class="grid">
      ${(evidence.materializedStatements || [])
        .map(
          (statement) => `
            <article class="card">
              <h3>${escapeHtml(statement.label)}</h3>
              <p>${escapeHtml(statement.value)} ${escapeHtml(statement.unit || '')}</p>
              <p class="meta">${escapeHtml(statement.source?.ref)}</p>
            </article>`
        )
        .join('')}
    </div>`;
}

function renderOperations(operations, preparedResult = null) {
  return `
    <p class="meta">Operationskonsole</p>
    <div class="grid">
      ${(operations.available || [])
        .map(
          (operation) => `
            <article class="card">
              <span class="badge">${escapeHtml(operation.mode)}</span>
              <h3>${escapeHtml(operation.label)}</h3>
              <p>${escapeHtml(operation.pathTemplate || '')}</p>
              <button data-prepare-operation="${escapeHtml(operation.id)}">Vorbereiten</button>
            </article>`
        )
        .join('')}
    </div>
    ${
      preparedResult
        ? `<article class="card boundary"><span class="badge">Nicht projiziert</span><pre>${escapeHtml(
            JSON.stringify(preparedResult.rawPayload, null, 2)
          )}</pre></article>`
        : ''
    }`;
}

async function openCase(id) {
  const [vorgang, evidence] = await Promise.all([getJson(api.case(id)), getJson(api.evidence(id))]);
  document.getElementById('case').innerHTML = renderCase(vorgang);
  document.getElementById('evidence').innerHTML = renderEvidence(evidence);
}

async function refresh() {
  const [daily, operations] = await Promise.all([getJson(api.daily), getJson(api.operations)]);
  document.getElementById('daily').innerHTML = renderDaily(daily);
  if (daily.items?.[0]) await openCase(daily.items[0].caseId);
  document.getElementById('operations').innerHTML = renderOperations(operations);
}

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!target || !target.dataset) return;

  if (target.dataset.openCase) {
    await openCase(target.dataset.openCase);
  }

  if (target.dataset.action && target.dataset.case) {
    const actionUrl = {
      claim: `/api/ui/v0/cases/${encodeURIComponent(target.dataset.case)}/claim`,
      freeze: `/api/ui/v0/cases/${encodeURIComponent(target.dataset.case)}/freeze`,
      approval: `/api/ui/v0/cases/${encodeURIComponent(target.dataset.case)}/approval-requests`,
    }[target.dataset.action];
    await postJson(actionUrl);
    await openCase(target.dataset.case);
  }

  if (target.dataset.prepareOperation) {
    const [operations, prepared] = await Promise.all([
      getJson(api.operations),
      postJson(api.prepareOperation(target.dataset.prepareOperation)),
    ]);
    document.getElementById('operations').innerHTML = renderOperations(operations, prepared);
  }
});

refresh().catch((error) => {
  document.getElementById('daily').innerHTML =
    `<strong>Fehler:</strong> ${escapeHtml(error.message)}`;
});
