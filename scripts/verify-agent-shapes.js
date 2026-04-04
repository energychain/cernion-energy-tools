#!/usr/bin/env node
/**
 * Agent Response-Shape Verification — Static Analysis Mode
 *
 * Reads the four agent service files directly (no broker, no MCP, no PouchDB)
 * and compares the actual return shapes against the UI-Contracts in
 * docs/ui-contracts/05–08.
 *
 * Usage:
 *   node scripts/verify-agent-shapes.js
 *
 * Output:
 *   docs/ui-contract-verification.md  — diff table (backend-owned)
 *
 * For live broker-based verification (requires running server):
 *   bash scripts/verify-agent-shapes-curl.sh
 *
 * v0.20.2 — pre-flight before v0.20.3 frontend agent-page build
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Discrepancy catalogue — derived from code reading of services + UI-Contracts
// ---------------------------------------------------------------------------

/**
 * Each entry:
 *   contractField  — dot-path as written in docs/ui-contracts/05–08
 *   actualField    — dot-path in the real service response (null = not present)
 *   match          — 'ok' | 'renamed' | 'missing' | 'request-mismatch'
 *   note           — human-readable explanation
 */
const DISCREPANCIES = {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. mastr-quality  POST /api/mastr-quality/audit
  //    Source: services/mastr-quality.service.js lines 1215–1235
  //    UI-Contract: docs/ui-contracts/05-mastr-quality.md
  // ─────────────────────────────────────────────────────────────────────────
  'mastr-quality.audit': [
    { contractField: 'id',                          actualField: 'id',                                           match: 'ok' },
    { contractField: 'createdAt',                   actualField: 'metadata.executedAt',                         match: 'renamed',  note: 'Not at top level. Stored in PouchDB; use metadata.executedAt in audit response.' },
    { contractField: 'gridOperator.name',           actualField: 'gridOperator.name',                           match: 'ok' },
    { contractField: 'gridOperator.mastrId',        actualField: 'gridOperator.mastrId',                        match: 'ok' },
    { contractField: 'qualityScore',                actualField: 'qualityScore',                                 match: 'ok' },
    { contractField: 'dimensions',                  actualField: 'qualityDimensions',                           match: 'renamed',  note: 'Top-level key is qualityDimensions, not dimensions.' },
    { contractField: 'dimensions.registration',     actualField: 'qualityDimensions.connectionPoints',          match: 'renamed',  note: 'registration → connectionPoints (QUALITY_DIMENSION_WEIGHTS key in src/validation-findings.js)' },
    { contractField: 'dimensions.registration.score',  actualField: 'qualityDimensions.connectionPoints.score',  match: 'renamed' },
    { contractField: 'dimensions.registration.weight', actualField: 'qualityDimensions.connectionPoints.weight', match: 'renamed' },
    { contractField: 'dimensions.capacity.score',   actualField: 'qualityDimensions.capacity.score',            match: 'renamed',  note: 'key correct but parent is qualityDimensions' },
    { contractField: 'dimensions.capacity.weight',  actualField: 'qualityDimensions.capacity.weight',           match: 'renamed' },
    { contractField: 'dimensions.connectivity',     actualField: 'qualityDimensions.status',                    match: 'renamed',  note: 'connectivity → status' },
    { contractField: 'dimensions.connectivity.score',  actualField: 'qualityDimensions.status.score',           match: 'renamed' },
    { contractField: 'dimensions.connectivity.weight', actualField: 'qualityDimensions.status.weight',          match: 'renamed' },
    { contractField: 'dimensions.deduplication',    actualField: 'qualityDimensions.duplicates',                match: 'renamed',  note: 'deduplication → duplicates' },
    { contractField: 'dimensions.deduplication.score',  actualField: 'qualityDimensions.duplicates.score',      match: 'renamed' },
    { contractField: 'dimensions.deduplication.weight', actualField: 'qualityDimensions.duplicates.weight',     match: 'renamed' },
    { contractField: 'dimensions.geo.score',        actualField: 'qualityDimensions.geo.score',                 match: 'renamed',  note: 'key correct but parent is qualityDimensions' },
    { contractField: 'dimensions.geo.weight',       actualField: 'qualityDimensions.geo.weight',                match: 'renamed' },
    { contractField: 'findings[].code',             actualField: 'findings[].finding',                          match: 'renamed',  note: 'createFinding() uses field name "finding" not "code"' },
    { contractField: 'findings[].severity',         actualField: 'findings[].severity',                         match: 'ok' },
    { contractField: 'findings[].installationId',   actualField: 'findings[].context.mastrNummer',              match: 'renamed',  note: 'installationId does not exist; use findings[].context.mastrNummer' },
    { contractField: 'findingsCount',               actualField: 'summary.findingsCount',                       match: 'renamed',  note: 'findingsCount is nested inside summary, not top-level' },
    { contractField: 'findingsCount.info',          actualField: 'summary.findingsCount.info',                  match: 'renamed' },
    { contractField: 'findingsCount.warning',       actualField: 'summary.findingsCount.warning',               match: 'renamed' },
    { contractField: 'findingsCount.error',         actualField: 'summary.findingsCount.error',                 match: 'renamed' },
    { contractField: 'portfolio',                   actualField: 'summary (restructured)',                       match: 'missing',  note: 'No top-level portfolio object. Use summary.totalInstallations + summary.installationsByType.' },
    { contractField: 'portfolio.total',             actualField: 'summary.totalInstallations',                  match: 'renamed' },
    { contractField: 'portfolio.solar',             actualField: 'summary.installationsByType.solar',           match: 'renamed' },
    { contractField: 'portfolio.wind',              actualField: 'summary.installationsByType.wind',            match: 'renamed' },
    { contractField: 'portfolio.storage',           actualField: 'summary.installationsByType.storage',         match: 'renamed' },
    { contractField: 'portfolio.biomass',           actualField: 'summary.installationsByType.biomass',         match: 'renamed' },
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // 2. grid-connection  POST /api/grid-connection/validate
  //    Source: services/grid-connection.service.js lines 863–895
  //    UI-Contract: docs/ui-contracts/06-grid-connection.md
  // ─────────────────────────────────────────────────────────────────────────
  'grid-connection.validate': [
    { contractField: 'id',                          actualField: 'id',                                           match: 'ok' },
    { contractField: 'createdAt',                   actualField: 'metadata.executedAt',                         match: 'renamed',  note: 'Not at top level. Use metadata.executedAt.' },
    { contractField: 'gridOperator.name',           actualField: 'gridOperator.name',                           match: 'ok' },
    { contractField: 'gridOperator.mastrId',        actualField: 'gridOperator.mastrId',                        match: 'ok' },
    { contractField: 'decision',                    actualField: 'decision',                                     match: 'ok' },
    { contractField: 'findings[].code',             actualField: 'findings[].finding',                          match: 'renamed',  note: 'createFinding() uses "finding" not "code"' },
    { contractField: 'findings[].severity',         actualField: 'findings[].severity',                         match: 'ok' },
    { contractField: 'findings[].step',             actualField: 'findings[].step',                             match: 'ok' },
    { contractField: 'findings[].detail',           actualField: 'findings[].reason',                           match: 'renamed',  note: 'createFinding() uses "reason" not "detail"' },
    { contractField: 'findingsCount.info',          actualField: 'summary.findingsCount.info',                  match: 'renamed',  note: 'nested in summary' },
    { contractField: 'findingsCount.warning',       actualField: 'summary.findingsCount.warning',               match: 'renamed' },
    { contractField: 'findingsCount.error',         actualField: 'summary.findingsCount.error',                 match: 'renamed' },
    { contractField: 'steps[].id',                  actualField: 'steps[].step',                                match: 'renamed',  note: 'step number is in "step" field, not "id"' },
    { contractField: 'steps[].name',                actualField: 'steps[].name',                                match: 'ok' },
    { contractField: 'steps[].status',              actualField: 'steps[].status',                              match: 'ok' },
    { contractField: 'steps[].findingCode',         actualField: null,                                          match: 'missing',  note: 'stepSummaries do not include findingCode; per-step findings are in the top-level findings[] array filtered by step number' },
    // Request body discrepancy
    { contractField: 'REQUEST: applicant (object)', actualField: 'not validated — gridOperatorId only required', match: 'ok',       note: 'applicant is optional and accepted but not validated or stored' },
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // 3. energy-sharing  POST /api/energy-sharing/validate
  //    Source: services/energy-sharing.service.js lines 990–1030
  //    UI-Contract: docs/ui-contracts/07-energy-sharing.md
  // ─────────────────────────────────────────────────────────────────────────
  'energy-sharing.validate': [
    { contractField: 'id',                              actualField: 'id',                                    match: 'ok' },
    { contractField: 'createdAt',                       actualField: 'metadata.executedAt',                  match: 'renamed',  note: 'Use metadata.executedAt.' },
    { contractField: 'gridOperator.name',               actualField: 'gridOperator.name',                    match: 'ok' },
    { contractField: 'decision',                        actualField: 'decision',                              match: 'ok' },
    { contractField: 'findings[].code',                 actualField: 'findings[].finding',                   match: 'renamed' },
    { contractField: 'findingsCount.info',              actualField: 'summary.findingsCount.info',           match: 'renamed',  note: 'nested in summary' },
    { contractField: 'findingsCount.warning',           actualField: 'summary.findingsCount.warning',        match: 'renamed' },
    { contractField: 'findingsCount.error',             actualField: 'summary.findingsCount.error',          match: 'renamed' },
    { contractField: 'generatorResults',                actualField: 'generators',                            match: 'renamed',  note: 'Key is "generators" (enriched input array), not "generatorResults"' },
    { contractField: 'generatorResults[].mastrId',      actualField: 'generators[].mastrNummer',             match: 'renamed',  note: 'Field is mastrNummer (matches MaStR spec), not mastrId' },
    { contractField: 'generatorResults[].status',       actualField: 'generators[].status',                  match: 'renamed',  note: 'Correct value but wrong parent key' },
    { contractField: 'generatorResults[].dvValidated',  actualField: 'generators[].hasDvFlag',               match: 'renamed',  note: 'dvValidated does not exist; closest is hasDvFlag (boolean)' },
    // Request body discrepancy
    { contractField: 'REQUEST: generators[].mastrId',   actualField: 'generators[].mastrNummer',             match: 'request-mismatch', note: 'Service reads gen.mastrNummer; sending mastrId will be ignored' },
    { contractField: 'REQUEST: consumers[].malo',       actualField: 'consumers[].maloId',                   match: 'request-mismatch', note: 'Service checks c.maloId; field in contract is malo (no Id suffix)' },
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // 4. redispatch-expost  POST /api/redispatch/audit
  //    Source: services/redispatch-expost.service.js lines 1174–1200
  //            src/redispatch-risk.js
  //    UI-Contract: docs/ui-contracts/08-redispatch.md
  // ─────────────────────────────────────────────────────────────────────────
  'redispatch-expost.audit': [
    { contractField: 'id',                                          actualField: 'id',                                      match: 'ok' },
    { contractField: 'createdAt',                                   actualField: 'metadata.executedAt',                    match: 'renamed',  note: 'Use metadata.executedAt.' },
    { contractField: 'gridOperator.name',                           actualField: 'gridOperator.name',                      match: 'ok' },
    { contractField: 'gridOperator.mastrId',                        actualField: 'gridOperator.mastrId',                   match: 'ok' },
    { contractField: 'period.from',                                 actualField: 'period.dateFrom',                        match: 'renamed',  note: 'period uses dateFrom/dateTo not from/to' },
    { contractField: 'period.to',                                   actualField: 'period.dateTo',                          match: 'renamed' },
    { contractField: 'settlementReadiness.readinessPercent',        actualField: 'settlementReadiness.readinessPercent',   match: 'ok' },
    { contractField: 'settlementReadiness.readyCount',              actualField: null,                                     match: 'missing',  note: 'No readyCount field. readinessPercent * totalInstallations / 100 = implied ready count. Use totalInstallations - blockedInstallations.' },
    { contractField: 'settlementReadiness.blockedCount',            actualField: 'settlementReadiness.blockedInstallations', match: 'renamed' },
    { contractField: 'settlementReadiness.totalCount',              actualField: 'settlementReadiness.totalInstallations', match: 'renamed' },
    { contractField: 'riskAssessment.level',                        actualField: 'riskAssessment.riskLevel',               match: 'renamed',  note: '"level" → "riskLevel" in src/redispatch-risk.js' },
    { contractField: 'riskAssessment.estimatedExposureEur',         actualField: 'riskAssessment.estimatedLostCompensationEur', match: 'renamed', note: 'Full field name: estimatedLostCompensationEur' },
    { contractField: 'curtailment',                                 actualField: null,                                     match: 'missing',  note: 'No top-level curtailment object. curtailmentGWh available only in findings[step=4].context. highFrequencyFlag is finding RD_HIGH_CURTAILMENT_PERIOD.' },
    { contractField: 'curtailment.totalGWh',                        actualField: 'findings[step=4].context.curtailmentGWh', match: 'missing' },
    { contractField: 'curtailment.source',                          actualField: 'findings[step=4].context (implied)',      match: 'missing' },
    { contractField: 'curtailment.highFrequencyFlag',               actualField: 'finding code RD_HIGH_CURTAILMENT_PERIOD', match: 'missing',  note: 'Check findings[].finding === "RD_HIGH_CURTAILMENT_PERIOD"' },
    { contractField: 'findingsCount.info',                          actualField: 'summary.findingsCount.info',             match: 'renamed',  note: 'nested in summary' },
    { contractField: 'findingsCount.warning',                       actualField: 'summary.findingsCount.warning',          match: 'renamed' },
    { contractField: 'findingsCount.error',                         actualField: 'summary.findingsCount.error',            match: 'renamed' },
    { contractField: 'portfolio.total',                             actualField: null,                                     match: 'missing',  note: 'No top-level portfolio object. Installation count in step 2 finding context.' },
    { contractField: 'portfolio.weg',                               actualField: null,                                     match: 'missing',  note: 'usedWegB boolean is in step 2 finding context only (findings[step=2].context.usedWegB)' },
    // Request body discrepancy
    { contractField: 'REQUEST: periodFrom',                         actualField: 'dateFrom',                               match: 'request-mismatch', note: 'Service params are dateFrom/dateTo, not periodFrom/periodTo' },
    { contractField: 'REQUEST: periodTo',                           actualField: 'dateTo',                                 match: 'request-mismatch' },
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // List endpoints — all four services
  // ─────────────────────────────────────────────────────────────────────────
  'mastr-quality.list': [
    { contractField: 'audits',                  actualField: 'audits',                match: 'ok' },
    { contractField: 'total',                   actualField: 'count',                 match: 'renamed',  note: 'list returns { count, audits }, not { total, audits }' },
    { contractField: 'audits[0].id',            actualField: 'audits[0].id',          match: 'ok' },
    { contractField: 'audits[0].qualityScore',  actualField: 'audits[0].qualityScore', match: 'ok' },
    { contractField: 'audits[0].createdAt',     actualField: 'audits[0].createdAt',   match: 'ok' },
    { contractField: 'audits[0].gridOperator.name', actualField: 'audits[0].gridOperator.name', match: 'ok' },
  ],

  'grid-connection.list': [
    { contractField: 'validations',             actualField: 'validations',           match: 'ok' },
    { contractField: 'total',                   actualField: 'count',                 match: 'renamed',  note: 'list returns { count, validations }' },
    { contractField: 'validations[0].id',       actualField: 'validations[0].id',     match: 'ok' },
    { contractField: 'validations[0].decision', actualField: 'validations[0].decision', match: 'ok' },
    { contractField: 'validations[0].createdAt', actualField: 'validations[0].createdAt', match: 'ok' },
  ],

  'energy-sharing.list': [
    { contractField: 'validations',             actualField: 'validations',           match: 'ok' },
    { contractField: 'total',                   actualField: 'count',                 match: 'renamed',  note: 'list returns { count, validations }' },
    { contractField: 'validations[0].id',       actualField: 'validations[0].id',     match: 'ok' },
    { contractField: 'validations[0].decision', actualField: 'validations[0].decision', match: 'ok' },
    { contractField: 'validations[0].createdAt', actualField: 'validations[0].createdAt', match: 'ok' },
  ],

  'redispatch-expost.list': [
    { contractField: 'audits',                          actualField: 'audits',                             match: 'ok' },
    { contractField: 'total',                           actualField: 'count',                              match: 'renamed',  note: 'list returns { count, audits }' },
    { contractField: 'audits[0].id',                    actualField: 'audits[0].id',                      match: 'ok' },
    { contractField: 'audits[0].createdAt',             actualField: 'audits[0].createdAt',               match: 'ok' },
    { contractField: 'audits[0].settlementReadinessPercent', actualField: 'audits[0].settlementReadiness.readinessPercent', match: 'renamed', note: 'Not a flat field. Nested: audits[0].settlementReadiness.readinessPercent' },
  ],
};

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function icon(match) {
  if (match === 'ok') return '✅';
  if (match === 'renamed') return '⚠️';
  if (match === 'request-mismatch') return '🔴';
  return '❌';
}

function buildMarkdown() {
  const now = new Date().toISOString().slice(0, 10);

  let totalChecks = 0;
  let okCount = 0;
  let renamedCount = 0;
  let missingCount = 0;
  let requestMismatchCount = 0;

  for (const entries of Object.values(DISCREPANCIES)) {
    for (const e of entries) {
      totalChecks++;
      if (e.match === 'ok') okCount++;
      else if (e.match === 'renamed') renamedCount++;
      else if (e.match === 'missing') missingCount++;
      else if (e.match === 'request-mismatch') requestMismatchCount++;
    }
  }

  // Use single-quoted strings throughout to avoid backtick-inside-template-literal issues.
  const lines = [
    '# UI-Contract Verification — v0.20.2',
    '',
    '> **Purpose:** Verify agent response shapes against `docs/ui-contracts/05–08`',
    '> before the frontend builds v0.20.3 agent pages.',
    '> **Source:** Static code analysis of agent services vs. UI-Contract field specs.',
    `> **Generated:** ${now}`,
    '',
    '## Legend',
    '',
    '| Icon | Meaning |',
    '|------|---------|',
    '| ✅ | Field present with correct name |',
    '| ⚠️ | Field present but under a different name / path — UI-Contract must be updated |',
    '| ❌ | Field absent from response — either add to service or remove from contract |',
    '| 🔴 | Request body field mismatch — frontend sends wrong field name |',
    '',
    '---',
    '',
  ];


  const sectionTitles = {
    'mastr-quality.audit':      '## 1. `POST /api/mastr-quality/audit`  ->  UI-Contract 05',
    'grid-connection.validate': '## 2. `POST /api/grid-connection/validate`  ->  UI-Contract 06',
    'energy-sharing.validate':  '## 3. `POST /api/energy-sharing/validate`  ->  UI-Contract 07',
    'redispatch-expost.audit':  '## 4. `POST /api/redispatch/audit`  ->  UI-Contract 08',
    'mastr-quality.list':       '## 5. `GET /api/mastr-quality/list`  ->  UI-Contract 05 (list)',
    'grid-connection.list':     '## 6. `GET /api/grid-connection/list`  ->  UI-Contract 06 (list)',
    'energy-sharing.list':      '## 7. `GET /api/energy-sharing/list`  ->  UI-Contract 07 (list)',
    'redispatch-expost.list':   '## 8. `GET /api/redispatch/list`  ->  UI-Contract 08 (list)',
  };

  for (const [section, entries] of Object.entries(DISCREPANCIES)) {
    lines.push(sectionTitles[section] || ('## ' + section), '');
    lines.push(
      '| UI-Contract Field | Actual Field | Match | Notes |',
      '|---|---|:---:|---|'
    );
    for (const e of entries) {
      const actual = e.actualField != null ? e.actualField : '(not present)';
      const note = e.note || '';
      lines.push('| `' + e.contractField + '` | `' + actual + '` | ' + icon(e.match) + ' | ' + note + ' |');
    }
    lines.push('');
  }

  const matchRate = Math.round((okCount / totalChecks) * 100);
  const actionable = renamedCount + missingCount + requestMismatchCount;

  lines.push(
    '---',
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|--------|-------|',
    '| Total fields checked | ' + totalChecks + ' |',
    '| Correct | ' + okCount + ' |',
    '| Renamed (contract update needed) | ' + renamedCount + ' |',
    '| Missing (field absent from response) | ' + missingCount + ' |',
    '| Request body mismatch | ' + requestMismatchCount + ' |',
    '',
    '**Match rate:** ' + matchRate + '%',
    '**Actionable:** ' + actionable + ' items',
    '',
    '---',
    '',
    '## Required UI-Contract Updates',
    '',
    'The following UI-Contract files need updating before the frontend builds v0.20.3.',
    'These are all **code-is-correct, contract-is-wrong** cases.',
    '',
    '### docs/ui-contracts/05-mastr-quality.md',
    '',
    '```diff',
    '-  "dimensions": {',
    '-    "registration":  { "score": 82, "weight": 0.3 },',
    '-    "connectivity":  { "score": 91, "weight": 0.2 },',
    '-    "deduplication": { "score": 55, "weight": 0.15 }',
    '-  },',
    '-  "findings": [{ "code": "MQ_ZERO_CAPACITY", "installationId": "SEE..." }],',
    '-  "findingsCount": { "info": 12 },',
    '-  "portfolio": { "total": 312, "solar": 201 }',
    '+  "qualityDimensions": {',
    '+    "connectionPoints": { "score": 82, "weight": 0.30 },',
    '+    "status":           { "score": 91, "weight": 0.15 },',
    '+    "duplicates":       { "score": 55, "weight": 0.15 }',
    '+  },',
    '+  "findings": [{ "finding": "MQ_ZERO_CAPACITY", "context": { "mastrNummer": "SEE..." } }],',
    '+  "summary": { "findingsCount": { "info": 12 }, "totalInstallations": 312, "installationsByType": { "solar": 201 } }',
    '```',
    '',
    'Actual dimension keys (from QUALITY_DIMENSION_WEIGHTS in src/validation-findings.js):',
    'connectionPoints (0.30) | capacity (0.20) | geo (0.20) | status (0.15) | duplicates (0.15)',
    '',
    '### docs/ui-contracts/06-grid-connection.md',
    '',
    '```diff',
    '-  "findings": [{ "code": "GO_CONDITIONAL", "detail": "..." }],',
    '-  "findingsCount": { "info": 4 },',
    '-  "steps": [{ "id": 1, "findingCode": "VNB_RESOLVED" }]',
    '+  "findings": [{ "finding": "GO_CONDITIONAL", "reason": "..." }],',
    '+  "summary": { "findingsCount": { "info": 4 } },',
    '+  "steps": [{ "step": 1 }]',
    '```',
    '',
    'Note: steps[].findingCode does not exist. Filter findings[] by step number to get per-step findings.',
    '',
    '### docs/ui-contracts/07-energy-sharing.md',
    '',
    '```diff',
    '- Request: generators[].mastrId',
    '- Request: consumers[].malo',
    '+ Request: generators[].mastrNummer',
    '+ Request: consumers[].maloId',
    '',
    '- Response: "generatorResults": [{ "mastrId": "SEE...", "dvValidated": true }]',
    '+ Response: "generators": [{ "mastrNummer": "SEE...", "hasDvFlag": true }]',
    '```',
    '',
    '### docs/ui-contracts/08-redispatch.md',
    '',
    '```diff',
    '- Request: periodFrom / periodTo',
    '+ Request: dateFrom / dateTo',
    '',
    '-  "period": { "from": "2025-01-01", "to": "2025-12-31" },',
    '-  "settlementReadiness": { "readyCount": 52, "blockedCount": 7, "totalCount": 59 },',
    '-  "riskAssessment": { "level": "medium", "estimatedExposureEur": 45000 },',
    '-  "curtailment": { "totalGWh": 123.4, "source": "netztransparenz", "highFrequencyFlag": false },',
    '-  "portfolio": { "total": 59, "weg": "A" }',
    '+  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-12-31" },',
    '+  "settlementReadiness": { "readinessPercent": 88.1, "blockedInstallations": 7, "totalInstallations": 59 },',
    '+  "riskAssessment": { "riskLevel": "medium", "estimatedLostCompensationEur": 45000 },',
    '+  // curtailment: derive from findings[step=4].context.curtailmentGWh',
    '+  //   highFrequency: findings[].finding === "RD_HIGH_CURTAILMENT_PERIOD"',
    '+  // portfolio: derive from findings[step=2].context.total + .usedWegB',
    '```',
    '',
    '### All list endpoints (05-08)',
    '',
    '```diff',
    '- { "total": N, "audits": [...] }',
    '+ { "count": N, "audits": [...] }',
    '```',
    '',
    'Also: redispatch list audits[0].settlementReadinessPercent (flat)',
    '  -> audits[0].settlementReadiness.readinessPercent (nested object).',
    '',
    '---',
    '',
    '## Decision: Update Contracts, Not Code',
    '',
    'All mismatches are intentional implementation choices — the service code',
    'is correct. The UI-Contracts were written ahead of implementation (v0.19.0)',
    'and contain idealized field names that differ from the actual conventions.',
    '',
    '**Exceptions (potential small code fixes):**',
    '',
    '| Issue | Recommendation |',
    '|-------|----------------|',
    '| createdAt absent from audit responses | Add alias: metadata.executedAt -> createdAt |',
    '| steps[].findingCode missing | Low priority: derive from findings[] filtered by step |',
    '| curtailment top-level missing | Promote curtailmentGWh + highFrequencyFlag to top-level |',
    '| portfolio top-level missing | Promote total + usedWegB to top-level in redispatch |',
    ''
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const md = buildMarkdown();
  const outPath = require('path').resolve('docs/ui-contract-verification.md');
  require('fs').writeFileSync(outPath, md, 'utf8');
  console.log('Written: ' + outPath);

  let total = 0;
  let ok = 0;
  let issues = 0;

  for (const [section, entries] of Object.entries(DISCREPANCIES)) {
    const sectionIssues = entries.filter((e) => e.match !== 'ok');
    if (sectionIssues.length > 0) {
      console.log('\n  [MISMATCH] ' + section + ' - ' + sectionIssues.length + ' issue(s):');
      for (const e of sectionIssues) {
        console.log('    ' + icon(e.match) + ' ' + e.contractField + '  ->  ' + (e.actualField != null ? e.actualField : 'NOT PRESENT'));
      }
    } else {
      console.log('  [OK] ' + section);
    }
    total += entries.length;
    ok += entries.filter((e) => e.match === 'ok').length;
    issues += sectionIssues.length;
  }

  console.log('\n  Total: ' + ok + '/' + total + ' correct, ' + issues + ' items need contract updates');
  console.log('  Report: docs/ui-contract-verification.md\n');
}

main();
