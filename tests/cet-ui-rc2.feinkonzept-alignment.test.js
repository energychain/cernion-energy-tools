'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildCaseViewModel,
  buildEvidenceViewModel,
  buildOperationsConsoleModel,
} = require('../apps/cet-ui/src/shared/ui-view-model');

const uiMainSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'cet-ui', 'src', 'main.js'),
  'utf8'
);

describe('CET RC2 Feinkonzept alignment', () => {
  test('Vorgangsansicht keeps all five grammar parts visible in semantic order', () => {
    const view = buildCaseViewModel({
      caseId: 'vorgang-1',
      label: 'Vorgang Artikel-ID-Änderung',
      presentationContract: {
        titel: 'Artikel-ID-Änderung prüfen',
        aussagen: [],
        nichtHandlungen: [],
      },
      interactionProjection: {},
    });

    expect(view.sections.map((section) => section.id)).toEqual([
      'vorgang',
      'quellen',
      'pruefung',
      'unsicherheit',
      'freigabe',
    ]);
  });

  test('Nachweisansicht surfaces hash/ref-only notices for einzel-datensatz boundaries', () => {
    const view = buildEvidenceViewModel({
      frozenAt: '2026-09-21T12:00:00Z',
      materializedStatements: [],
      hashRefOnlyNotices: [
        {
          id: 'raw-row-1',
          label: 'Einzeldatensatz Zählpunkt',
          sourceRef: 'evidence://mako/raw-row#hash-only',
          notice: 'nur_mit_quelle_reproduzierbar',
        },
      ],
    });

    expect(view.hashRefOnlyNotices).toEqual([
      {
        id: 'raw-row-1',
        label: 'Einzeldatensatz Zählpunkt',
        sourceRef: 'evidence://mako/raw-row#hash-only',
        notice: 'nur_mit_quelle_reproduzierbar',
      },
    ]);
  });

  test('Operationskonsole not-projected result exposes raw JSON without evidence marker semantics', () => {
    const view = buildOperationsConsoleModel({
      preparedResult: {
        projectionStatus: 'nicht_projiziert',
        unprojected: { raw: { ok: true }, notice: 'nicht_projiziert' },
      },
    });

    expect(view.preparedResult).toEqual({
      badge: 'Nicht projiziert',
      rawPayload: { ok: true },
      notice: 'nicht_projiziert',
      evidenceMarkers: [],
      aggregationState: null,
    });
  });

  test('SPA source renders Feinkonzept copy for not-projected JSON and source-only notices', () => {
    expect(uiMainSource).toContain(
      'Dieses Ergebnis ist noch nicht in eine belegte Vorgangsdarstellung projiziert'
    );
    expect(uiMainSource).toContain('preparedResult.unprojected?.raw');
    expect(uiMainSource).not.toContain('preparedResult.rawPayload');
    expect(uiMainSource).toContain('hashRefOnlyNotices');
  });
});
