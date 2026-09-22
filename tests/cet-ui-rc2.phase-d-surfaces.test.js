'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..', 'apps', 'cet-ui');
const appSource = fs.readFileSync(path.join(appRoot, 'src', 'App.tsx'), 'utf8');

function expectInOrder(source, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe('CET RC2 Phase D integrated surfaces', () => {
  test('Tagesfläche consumes Phase-C surface primitives and shows attention, role effect, contribution and handling status', () => {
    expect(appSource).toContain('TagesflaecheGroup');
    expect(appSource).toContain('VorgangCard');
    expect(appSource).toContain('aufmerksamkeitsgrund');
    expect(appSource).toContain('rollenwirkung');
    expect(appSource).toContain('naechsterBeitrag');
    expect(appSource).toContain('Mir zugewiesen');
    expect(appSource).toContain('In Bearbeitung durch');
    expect(appSource).toContain('offene Klärung');
  });

  test('Vorgangsansicht renders all five grammar parts with role, decision distance, uncertainty, approval and boundaries', () => {
    expectInOrder(appSource, [
      "{ id: 'vorgang', title: 'Vorgang' }",
      "{ id: 'quellen', title: 'Quellen' }",
      "{ id: 'pruefung', title: 'Prüfung' }",
      "{ id: 'unsicherheit', title: 'Unsicherheit' }",
      "{ id: 'freigabe', title: 'Freigabe' }",
    ]);
    expect(appSource).toContain('Entscheidungsdistanz');
    expect(appSource).toContain('Anschlussfrage');
    expect(appSource).toContain('Das System entscheidet nicht.');
    expect(appSource).toContain('BoundaryPanel');
    expect(appSource).toContain('basisRev');
  });

  test('Nachweisansicht shows frozen projection, aggregate statements, hash/ref-only notices and attributed approvals', () => {
    expect(appSource).toContain('eingefrorener Präsentations-/Interaktionsstand');
    expect(appSource).toContain('granularitaet');
    expect(appSource).toContain('nur mit Quelle reproduzierbar');
    expect(appSource).toContain('hashRefOnlyNotices');
    expect(appSource).toContain('ApprovalRequestCard');
    expect(appSource).toContain("statement.granularitaet !== 'einzeldatensatz'");
    expect(appSource).toContain('hashReferenceStatements');
    expect(appSource).not.toContain('Einzeldatensatz materialisieren');
  });

  test('Operationskonsole separates projected and not-projected results and keeps gateway/audit boundaries visible', () => {
    expect(appSource).toContain('OperationPermissionPanel');
    expect(appSource).toContain('riskClass');
    expect(appSource).toContain('governancePolicyId');
    expect(appSource).toContain('Projected Result');
    expect(appSource).toContain('Unprojected Raw Result');
    expect(appSource).toContain('keine belegte Aussage');
    expect(appSource).toContain('recordAudit');
    expect(appSource).toContain('async function recordViewOpened(view: string, basisRev?: string)');
    expect(appSource).toContain('if (!basisRev) return;');
    expect(appSource).toContain(
      "recordAudit({ event: 'view_opened', transport: 'ui_gateway', view, basisRev })"
    );
  });

  test('Phase-D surfaces keep guardrails: REST-only, no forbidden UX copy, no direct RC1/Moleculer surface', () => {
    expect(appSource).not.toMatch(
      /Zur Kenntnis|Next Best Action|CET entscheidet|Freigabe empfohlen/
    );
    expect(appSource).not.toMatch(/moleculer|RC1|rc1/i);
    expect(appSource).toContain("requestJson<SessionContext>('/ui/v0/session-context')");
    expect(appSource).toContain('await client.claimCase(caseId, basisRev);');
    expect(appSource).toContain('await client.freezeCase(caseId, { basisRev });');
    expect(appSource).toContain('await client.requestApproval(caseId, { basisRev });');
  });
});
