'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildCaseViewModel,
  buildEvidenceViewModel,
  buildOperationsConsoleModel,
} = require('../apps/cet-ui/src/shared/ui-view-model');

const uiAppSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'cet-ui', 'src', 'App.tsx'),
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
      operationId: undefined,
      badge: 'Nicht projiziert',
      raw: { ok: true },
      evidenceMarkers: [],
      audit: null,
    });
  });

  test('SPA source renders Feinkonzept copy for not-projected JSON and source-only notices', () => {
    expect(uiAppSource).toContain(
      'Dieses Ergebnis ist noch nicht in eine belegte Vorgangsdarstellung projiziert'
    );
    expect(uiAppSource).toContain('preparedOperation.unprojected?.raw');
    expect(uiAppSource).not.toContain('rawPayload');
    expect(uiAppSource).toContain('hashRefOnlyNotices');
  });
});
