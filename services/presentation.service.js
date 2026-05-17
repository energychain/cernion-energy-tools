'use strict';

/**
 * Presentation Service (#CETview Step 1)
 *
 * Translates domain results into structured, management-grade human views.
 * Deterministic: no LLM calls, no invented facts or roles.
 *
 * Supported renderer types (Step 1):
 *   - kpi_fact           — single value / count with source and timestamp
 *   - debug_summary      — fallback structured dump (no large JSON blobs)
 *
 * Stubs (routing works, renderer returns not-implemented warning):
 *   - vdmi_matrix_table
 *   - comparison_table
 *   - decision_brief
 *   - risk_table
 *   - evidence_gap_table
 *
 * REST: POST /api/presentation/render
 */

const OPENAPI_TAG = 'Presentation';

const VALID_FORMATS = new Set([
  'auto',
  'kpi_fact',
  'comparison_table',
  'vdmi_matrix_table',
  'decision_brief',
  'risk_table',
  'evidence_gap_table',
  'debug_summary',
]);

// ---------------------------------------------------------------------------
// Format selection
// ---------------------------------------------------------------------------

/**
 * Deterministic heuristic to select the best renderer type.
 * Never inspects free-text content; only checks schema-level field presence.
 *
 * @param {string|undefined} preferredFormat
 * @param {object} domainResult
 * @returns {string}
 */
function selectFormat(preferredFormat, domainResult) {
  if (preferredFormat && preferredFormat !== 'auto' && VALID_FORMATS.has(preferredFormat)) {
    return preferredFormat;
  }

  const dr = domainResult || {};

  // VDMI matrix: tasks array with at least one VDMI role field
  const tasks = (dr.matrix && Array.isArray(dr.matrix.tasks) ? dr.matrix.tasks : null)
    || (Array.isArray(dr.tasks) ? dr.tasks : null);
  if (tasks && tasks.length > 0) {
    const first = tasks[0] || {};
    if (
      Array.isArray(first.verantwortlich) ||
      Array.isArray(first.durchfuehrend) ||
      Array.isArray(first.mitwirkend) ||
      Array.isArray(first.information)
    ) {
      return 'vdmi_matrix_table';
    }
  }

  // KPI / fact: has a value or count plus at least one supporting field
  if (
    (dr.value !== undefined || dr.count !== undefined) &&
    (dr.unit !== undefined || dr.source !== undefined || dr.label !== undefined)
  ) {
    return 'kpi_fact';
  }

  // Evidence gaps
  if (Array.isArray(dr.evidenceGaps) && dr.evidenceGaps.length > 0) {
    return 'evidence_gap_table';
  }

  // Asset risks
  if (
    (Array.isArray(dr.assetRisks) && dr.assetRisks.length > 0) ||
    (Array.isArray(dr.risks) && dr.risks.length > 0)
  ) {
    return 'risk_table';
  }

  return 'debug_summary';
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Build a simple Markdown table from rows of { field, value }.
 */
function markdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${row.map((cell) => String(cell ?? '—')).join(' | ')} |`)
    .join('\n');
  return [header, separator, body].join('\n');
}

/**
 * kpi_fact renderer
 *
 * Input fields used (all optional except at least one of value/count):
 *   domainResult.label     — metric label
 *   domainResult.value     — numeric or string result
 *   domainResult.count     — numeric count (alternative to value)
 *   domainResult.unit      — unit string
 *   domainResult.area      — geographic area or scope
 *   domainResult.source    — data source identifier
 *   domainResult.asOf      — ISO timestamp or date string
 *   domainResult.note      — optional short note
 */
function renderKpiFact(domainResult, context, locale) {
  const dr = domainResult || {};
  const warnings = [];

  const metricValue = dr.value !== undefined ? dr.value : dr.count;
  const displayValue = metricValue !== undefined
    ? `${metricValue}${dr.unit ? ' ' + dr.unit : ''}`
    : null;

  if (displayValue === null) {
    warnings.push('kpi_fact_missing_value: domainResult.value and domainResult.count are both absent');
  }

  const label = dr.label || context?.label || 'Ergebnis';
  const title = label;

  const tableRows = [];
  if (displayValue !== null) tableRows.push(['Antwort', displayValue]);
  if (dr.area) tableRows.push(['Gebiet', dr.area]);
  if (dr.source) tableRows.push(['Quelle', dr.source]);
  if (dr.asOf) tableRows.push(['Stand', dr.asOf]);
  if (dr.note) tableRows.push(['Hinweis', dr.note]);

  if (tableRows.length === 0) {
    warnings.push('kpi_fact_no_displayable_fields: no presentable fields found in domainResult');
  }

  const kpis = displayValue !== null
    ? [{ label, value: metricValue, unit: dr.unit || null, displayValue }]
    : [];

  const tableMarkdown = tableRows.length > 0
    ? markdownTable(['Feld', 'Wert'], tableRows)
    : '';

  const summaryParts = [];
  if (displayValue !== null) summaryParts.push(`**${label}:** ${displayValue}`);
  if (dr.area) summaryParts.push(`Gebiet: ${dr.area}`);
  const summary = summaryParts.join(' · ') || 'Keine auswertbaren Felder im Ergebnis.';

  const markdownParts = [`## ${title}`, '', summary];
  if (tableMarkdown) {
    markdownParts.push('', tableMarkdown);
  }
  if (dr.source) {
    markdownParts.push('', `*Quelle: ${dr.source}*`);
  }
  const markdown = markdownParts.join('\n');

  return {
    success: true,
    presentation: {
      type: 'kpi_fact',
      title,
      summary,
      kpis,
      tables: tableRows.length > 0 ? [{ id: 'kpi_main', rows: tableRows, headers: ['Feld', 'Wert'] }] : [],
      sections: [],
      warnings,
      sources: dr.source ? [dr.source] : [],
      nextActions: [],
    },
    markdown,
  };
}

/**
 * debug_summary renderer
 *
 * Produces a short, scannable summary without dumping large JSON blobs.
 */
function renderDebugSummary(domainResult, context) {
  const dr = domainResult || {};
  const warnings = ['debug_summary_fallback: no specific renderer matched the domainResult shape'];

  // Surface top-level non-object keys only (avoid large blobs)
  const scalarFields = Object.entries(dr).filter(
    ([, v]) => v === null || typeof v !== 'object' || (typeof v === 'string')
  );
  const objectKeys = Object.keys(dr).filter((k) => {
    const v = dr[k];
    return v !== null && typeof v === 'object';
  });

  const summary = scalarFields.length > 0
    ? `Domain-Ergebnis (Felder: ${scalarFields.map(([k]) => k).join(', ')})`
    : 'Domain-Ergebnis ohne skalare Felder.';

  const sections = [];
  if (scalarFields.length > 0) {
    const rows = scalarFields.map(([k, v]) => [k, String(v)]);
    sections.push({
      id: 'scalar_fields',
      title: 'Skalare Felder',
      content: markdownTable(['Feld', 'Wert'], rows),
    });
  }
  if (objectKeys.length > 0) {
    sections.push({
      id: 'object_keys',
      title: 'Weitere Felder (Objekte/Arrays)',
      content: objectKeys.map((k) => `- \`${k}\``).join('\n'),
    });
  }

  const markdownParts = ['## Debug-Zusammenfassung', '', summary];
  for (const sec of sections) {
    markdownParts.push('', `### ${sec.title}`, '', sec.content);
  }
  if (objectKeys.length > 0) {
    markdownParts.push('', '> Hinweis: Objekt-/Array-Felder sind nicht ausgeschrieben, um die Ausgabe lesbar zu halten.');
  }
  const markdown = markdownParts.join('\n');

  return {
    success: true,
    presentation: {
      type: 'debug_summary',
      title: 'Debug-Zusammenfassung',
      summary,
      kpis: [],
      tables: [],
      sections,
      warnings,
      sources: [],
      nextActions: [],
    },
    markdown,
  };
}

/**
 * Stub renderer for types not yet implemented in Step 1.
 */
function renderStub(type) {
  const warningCode = `${type}_renderer_not_implemented_yet`;
  return {
    success: true,
    presentation: {
      type,
      title: `${type} (ausstehend)`,
      summary: `Renderer '${type}' ist noch nicht implementiert.`,
      kpis: [],
      tables: [],
      sections: [],
      warnings: [warningCode],
      sources: [],
      nextActions: [],
    },
    markdown: `## ${type}\n\n> **Hinweis:** Renderer noch nicht implementiert (\`${warningCode}\`).`,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function dispatch(format, domainResult, context, locale) {
  switch (format) {
    case 'kpi_fact':
      return renderKpiFact(domainResult, context, locale);
    case 'debug_summary':
      return renderDebugSummary(domainResult, context);
    default:
      return renderStub(format);
  }
}

// ---------------------------------------------------------------------------
// Moleculer Service
// ---------------------------------------------------------------------------

module.exports = {
  name: 'presentation',

  settings: {},

  actions: {
    /**
     * Render a domain result as a structured human view.
     *
     * @param {string}  [intent]         - capability / intent hint
     * @param {string}  [audience]       - default: management
     * @param {string}  [preferredFormat]- renderer override; one of VALID_FORMATS
     * @param {object}  domainResult     - required: raw domain output to render
     * @param {object}  [context]        - optional extra context (tenantId, locale, …)
     * @param {string}  [locale]         - default: de-DE
     */
    render: {
      rest: 'POST /presentation/render',
      openapi: {
        summary: 'Render domain result as structured human view',
        description:
          'Deterministic system-to-human presentation layer. Translates domain results ' +
          'into management-grade artefacts (KPI cards, VDMI matrices, decision briefs, …). ' +
          'No LLM calls; all facts come from domainResult.',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['domainResult'],
                properties: {
                  intent: { type: 'string', example: 'asset_count_query' },
                  audience: { type: 'string', default: 'management', example: 'management' },
                  preferredFormat: {
                    type: 'string',
                    enum: [...VALID_FORMATS],
                    default: 'auto',
                  },
                  domainResult: {
                    type: 'object',
                    description: 'Raw domain output to be rendered',
                    example: {
                      label: 'PV-Anlagen in Wiesloch',
                      count: 312,
                      unit: 'Anlagen',
                      area: 'Wiesloch',
                      source: 'Marktstammdatenregister (MaStR)',
                      asOf: '2026-05-17',
                    },
                  },
                  context: {
                    type: 'object',
                    example: { tenantId: 'demo', locale: 'de-DE' },
                  },
                  locale: { type: 'string', default: 'de-DE', example: 'de-DE' },
                },
              },
              examples: {
                kpi_fact_pv_wiesloch: {
                  summary: 'KPI-Abfrage PV-Anlagen Wiesloch',
                  value: {
                    intent: 'asset_count_query',
                    domainResult: {
                      label: 'PV-Anlagen in Wiesloch',
                      count: 312,
                      unit: 'Anlagen',
                      area: 'Wiesloch',
                      source: 'Marktstammdatenregister (MaStR)',
                      asOf: '2026-05-17',
                    },
                  },
                },
                vdmi_matrix_stub: {
                  summary: 'VDMI-Matrix-Anfrage (Stub)',
                  value: {
                    intent: 'vdmi_role_boundary_governance',
                    domainResult: {
                      matrix: {
                        id: 'matrix-001',
                        name: 'Netzanschluss §17 EnWG',
                        tasks: [
                          {
                            taskId: 'network-operator-decision',
                            taskName: 'Formelle Netzbetreiberentscheidung',
                            verantwortlich: ['DSO_GATEKEEPER'],
                            durchfuehrend: ['TECHNICAL_PLANNER'],
                            mitwirkend: ['APPLICANT'],
                            information: ['REGULATOR'],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Structured presentation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    presentation: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        summary: { type: 'string' },
                        kpis: { type: 'array', items: { type: 'object' } },
                        tables: { type: 'array', items: { type: 'object' } },
                        sections: { type: 'array', items: { type: 'object' } },
                        warnings: { type: 'array', items: { type: 'string' } },
                        sources: { type: 'array', items: { type: 'string' } },
                        nextActions: { type: 'array', items: { type: 'object' } },
                      },
                    },
                    markdown: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid input — domainResult missing' },
        },
      },
      params: {
        intent: { type: 'string', optional: true },
        audience: { type: 'string', optional: true, default: 'management' },
        preferredFormat: { type: 'string', optional: true, default: 'auto' },
        domainResult: { type: 'object' },
        context: { type: 'object', optional: true },
        locale: { type: 'string', optional: true, default: 'de-DE' },
      },

      handler(ctx) {
        const {
          preferredFormat = 'auto',
          domainResult,
          context = {},
          locale = 'de-DE',
        } = ctx.params;

        if (!domainResult || typeof domainResult !== 'object') {
          return this.Promise.reject(
            new Error('presentation.render: domainResult is required and must be an object')
          );
        }

        const format = selectFormat(preferredFormat, domainResult);
        return dispatch(format, domainResult, context, locale);
      },
    },
  },
};
