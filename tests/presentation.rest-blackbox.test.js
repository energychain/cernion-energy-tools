'use strict';

const triwoFixture = require('./fixtures/presentation/triwo-vdmi-decision.fixture');
const pvKpiFixture = require('./fixtures/presentation/pv-wiesloch-kpi.fixture');
const bessDdFixture = require('./fixtures/presentation/bess-financier-due-diligence.fixture');

const RUN_REST_BLACKBOX = process.env.RUN_PRESENTATION_REST_BLACKBOX === 'true';
const BASE_URL = process.env.PRESENTATION_REST_BASE_URL || 'http://127.0.0.1:3900';
const PATH_RENDER = '/api/presentation/render';

const describeRest = RUN_REST_BLACKBOX ? describe : describe.skip;

describeRest('presentation REST blackbox (Prompt 7)', () => {
  jest.setTimeout(30000);

  async function postRender(payload) {
    const response = await fetch(`${BASE_URL}${PATH_RENDER}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'prompt7-blackbox',
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    return { response, body };
  }

  test('REST-BB-01: #Triwo fixture returns vdmi_matrix_table with five-column header', async () => {
    const { response, body } = await postRender(triwoFixture);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.presentation.type).toBe('vdmi_matrix_table');
    expect(body.markdown).toContain(
      '| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |'
    );
  });

  test('REST-BB-02: PV KPI fixture returns kpi_fact and no VDMI header', async () => {
    const { response, body } = await postRender(pvKpiFixture);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.presentation.type).toBe('kpi_fact');
    expect(body.markdown).not.toContain(
      '| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |'
    );
  });

  test('REST-BB-03: BESS due-diligence fixture returns deterministic decision/risk/evidence structure without invented source/asOf', async () => {
    const { response, body } = await postRender(bessDdFixture);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.presentation.type).toBe('decision_brief');
    expect(body.markdown).toContain('### Risiken');
    expect(body.markdown).toContain('### Evidenz und offene Lücken');
    expect(body.markdown).toContain('### Nächste Schritte');
    expect(body.markdown).not.toContain('Quelle:');
    expect(body.markdown).not.toContain('| Stand |');
  });

  test('REST-BB-04: unknown preferred format falls back safely with warning', async () => {
    const { response, body } = await postRender({
      ...pvKpiFixture,
      preferredFormat: 'not_a_real_renderer',
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.presentation.type).toBe('debug_summary');
    expect(body.presentation.warnings).toContain('unknown_preferred_format');
  });
});
