'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..', 'apps', 'cet-ui');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

function expectFile(relativePath) {
  expect(fs.existsSync(path.join(appRoot, relativePath))).toBe(true);
  return read(relativePath);
}

describe('CET UI RC2 Phase C reusable visible components', () => {
  test('identity components project tenant, role and placeholder-agent boundaries', () => {
    const tenant = expectFile('src/components/identity/TenantBadge.tsx');
    const activeRole = expectFile('src/components/identity/ActiveRoleBadge.tsx');
    const roleSelector = expectFile('src/components/identity/RoleSelector.tsx');
    const actor = expectFile('src/components/identity/ActorBadge.tsx');

    expect(tenant).toContain('Mandant');
    expect(activeRole).toContain('Rollenperspektive');
    expect(roleSelector).toContain('available');
    expect(roleSelector).toContain('placeholderAgent');
    expect(actor).toContain('Platzhalter-Agent');
    expect(actor).not.toMatch(/Laufkarte/);
  });

  test('status markers delegate wording to shared helpers and keep visible terms safe', () => {
    const files = [
      'src/components/status/AttentionReasonBadge.tsx',
      'src/components/status/DeadlineIndicator.tsx',
      'src/components/status/AggregateStateBadge.tsx',
      'src/components/status/SafetyMarker.tsx',
      'src/components/status/GranularityBadge.tsx',
      'src/components/status/NotProjectedBadge.tsx',
      'src/components/status/ApprovalStatusBadge.tsx',
      'src/components/status/HandlingStatusBadge.tsx',
    ];
    const combined = files.map(expectFile).join('\n');

    expect(combined).toContain('wording-helpers');
    expect(combined).toContain('Nicht projiziert');
    expect(combined).toContain('granularitaet');
    expect(combined).not.toMatch(/Zur Kenntnis|Next Best Action|CET entscheidet/);
  });

  test('structure components expose grammar, source, boundary and history primitives', () => {
    const grammar = expectFile('src/components/structure/GrammarPart.tsx');
    const collapsible = expectFile('src/components/structure/CollapsibleSection.tsx');
    const sourceList = expectFile('src/components/structure/SourceList.tsx');
    const boundary = expectFile('src/components/structure/BoundaryPanel.tsx');
    const history = expectFile('src/components/structure/HistoryExcerpt.tsx');
    const sinceLastAccess = expectFile('src/components/structure/SinceLastAccessNotice.tsx');

    expect(grammar).toContain('data-grammar-part');
    expect(collapsible).toContain('aria-expanded');
    expect(sourceList).toContain('Quellen');
    expect(boundary).toContain('boundary-panel--invalid');
    expect(boundary).toContain('Grenzen dieser Ansicht fehlen');
    expect(history).toContain('Historie');
    expect(sinceLastAccess).toContain('Seit dem letzten Zugriff');
  });

  test('action components require basisRev for CET-internal writes and do not promise outcomes', () => {
    const files = [
      'src/components/actions/NextContributionPanel.tsx',
      'src/components/actions/BasisRevActionButton.tsx',
      'src/components/actions/ClaimCaseButton.tsx',
      'src/components/actions/FreezeCaseButton.tsx',
      'src/components/actions/RequestApprovalButton.tsx',
      'src/components/actions/ReadinessCheckAction.tsx',
    ];
    const combined = files.map(expectFile).join('\n');

    expect(combined).toContain('basisRev');
    expect(combined).toContain('CET-intern');
    expect(combined).toContain('Freigabe anfordern');
    expect(combined).not.toMatch(/genehmigt|ausgeführt|externes Fachsystem/i);
  });

  test('evidence components keep einzeldatensatz hash/ref-only and reproducible', () => {
    const files = [
      'src/components/evidence/EvidenceReceiptLink.tsx',
      'src/components/evidence/HashReferencePanel.tsx',
      'src/components/evidence/SourceClassLabel.tsx',
      'src/components/evidence/SourceStandLabel.tsx',
      'src/components/evidence/ReproducibilityNotice.tsx',
    ];
    const combined = files.map(expectFile).join('\n');

    expect(combined).toContain('evidence-helpers');
    expect(combined).toContain('hashRef');
    expect(combined).toContain('einzeldatensatz');
    expect(combined).toContain('Nur mit Quelle reproduzierbar');
    expect(combined).not.toContain('rawPayload');
  });

  test('operations components keep raw JSON non-projected and separate from evidence', () => {
    const files = [
      'src/components/operations/OperationSearch.tsx',
      'src/components/operations/CapabilityCard.tsx',
      'src/components/operations/OperationForm.tsx',
      'src/components/operations/OperationPermissionPanel.tsx',
      'src/components/operations/RiskClassBadge.tsx',
      'src/components/operations/ProjectedResultView.tsx',
      'src/components/operations/UnprojectedRawJsonView.tsx',
    ];
    const combined = files.map(expectFile).join('\n');

    expect(combined).toContain('Nicht projiziert');
    expect(combined).toContain('unprojected');
    expect(combined).toContain('riskClass');
    expect(combined).toContain('kein Nachweis');
    expect(combined).not.toMatch(/EvidenceReceipt|aggregationState/);
  });

  test('approval primitives require attribution for granted or refused states', () => {
    const requestCard = expectFile('src/components/governance/ApprovalRequestCard.tsx');
    const displayLayer = expectFile('src/components/governance-display-elements.tsx');

    expect(requestCard).toContain('actedAt');
    expect(requestCard).toContain('actorName');
    expect(requestCard).toContain('Attribution fehlt');
    expect(displayLayer).toContain('approvalRequiresAttribution');
    expect(displayLayer).toContain('Freigabeentscheidung ohne Attribution unvollständig');
  });

  test('governance-grounded Phase C primitives exist for the Phase D surfaces', () => {
    const index = expectFile('src/components/index.ts');
    for (const exportedName of [
      'RoleProjectionBadge',
      'RoleActorLine',
      'EvidenceReceiptCard',
      'MissingEvidenceCallout',
      'DecisionReadinessPanel',
      'AllowedBlockedActionsList',
      'HitlGatePanel',
      'ApprovalRequestCard',
      'NotProjectedResultPanel',
      'VorgangCard',
      'TagesflaecheGroup',
    ]) {
      expect(index).toContain(exportedName);
    }
  });
});
