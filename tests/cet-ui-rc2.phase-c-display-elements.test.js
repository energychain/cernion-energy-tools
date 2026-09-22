'use strict';

const fs = require('fs');
const path = require('path');

const componentPath = path.join(
  __dirname,
  '..',
  'apps',
  'cet-ui',
  'src',
  'components',
  'governance-display-elements.tsx'
);
const specPath = path.join(__dirname, '..', 'docs', 'rc2-ui', 'spec-c-display-elements.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('CET RC2 Phase C reusable governance display elements', () => {
  test('implements the reusable display element layer before page-specific Phase D surfaces', () => {
    expect(fs.existsSync(componentPath)).toBe(true);
    const source = read(componentPath);

    const expectedExports = [
      'StatusBadge',
      'RoleActor',
      'EvidenceMarker',
      'BoundaryBox',
      'NextContributionCard',
      'DecisionDistanceList',
      'ApprovalPanel',
      'TakeoverStatePanel',
      'GrammarSection',
      'RawJsonNotProjectedPanel',
      'SafeActionBar',
      'SinceLastAccessNotice',
      'ProvenanceDisclosure',
    ];

    for (const name of expectedExports) {
      expect(source).toContain(`export function ${name}`);
    }
  });

  test('locks governance wording and no-call semantics in the display primitives', () => {
    const source = read(componentPath);

    expect(source).toContain('CET entscheidet nicht');
    expect(source).toContain('In Bearbeitung durch');
    expect(source).toContain('durch Agent');
    expect(source).toContain('nur mit Quelle reproduzierbar');
    expect(source).toContain('Nicht projiziert');
    expect(source).toContain('keinen Aggregatzustand');
    expect(source).toContain('keine Evidenzmarker');
    expect(source).toContain('external_write_unavailable');
    expect(source).toContain('CET-interner Schreibvorgang');

    expect(source).not.toContain('Zur Kenntnis');
    expect(source).not.toContain('Next Best Action');
  });

  test('keeps role, tenant, placeholder-agent, evidence and boundary semantics explicit', () => {
    const source = read(componentPath);

    expect(source).toContain('placeholderAgent');
    expect(source).toContain('tenantLabel');
    expect(source).toContain('nichtHandlungen');
    expect(source).toContain('granularitaet');
    expect(source).toContain('einzeldatensatz');
    expect(source).toContain('aggregat');
    expect(source).toContain('nicht_anwendbar');
    expect(source).toContain('grammarPartOrder');
  });

  test('persists the Phase C specification before D-level page implementation', () => {
    expect(fs.existsSync(specPath)).toBe(true);
    const spec = read(specPath);
    expect(spec).toContain('StatusBadge');
    expect(spec).toContain('RoleActor');
    expect(spec).toContain('EvidenceMarker');
    expect(spec).toContain('BoundaryBox');
    expect(spec).toContain('ApprovalPanel');
    expect(spec).toContain('RawJsonNotProjectedPanel');
    expect(spec).toContain('Phase D');
    expect(spec).toContain('keine Fachregel direkt in einer Seitenkomponente');
  });
});
