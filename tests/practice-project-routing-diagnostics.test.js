'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runPracticeEvaluation } = require('../scripts/validate-practice-live');
const { evaluationConfig } = require('../scripts/practice-evaluation-transport');
const { renderPracticeReport } = require('../scripts/practice-evaluation-report');
const { CRITERIA } = require('../scripts/practice-evaluation-rubric');

test.each([true, false])(
  'offline transport preserves routing diagnostics (present: %s) in JSON and red reports',
  async (present) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-routing-report-'));
    const diagnosis = present
      ? {
          candidateCount: 1,
          bestProjectId: 'project-a',
          score: 0.45,
          margin: 0.45,
          reason: 'no_content',
        }
      : { bestProjectId: null, score: 0, margin: 0, reason: 'not_evaluated' };
    try {
      const report = await runPracticeEvaluation({
        config: { ...evaluationConfig({}), selected: ['project-a-implicit'], repeats: 1 },
        budget: {
          state: {},
          assertReady() {},
          stopForQuota() {},
          report: () => ({ calls: 0, tokens: { used: 0 } }),
        },
        transport: {
          mode: 'local',
          startRun: async () => ({ tenantId: 'synthetic-test' }),
          send: async () => ({
            responseText: 'Welche Datenquelle ist gemeint?',
            metadata: present ? { projectRouting: diagnosis } : {},
          }),
          cleanup: async () => [],
          close: async () => {},
        },
        judge: async () => ({
          total: 12,
          criteria: Object.fromEntries(
            Object.keys(CRITERIA).map((key) => [key, { score: 2, reason: 'Synthetisch geprüft.' }])
          ),
        }),
        reportPath: path.join(dir, 'report.md'),
      });
      expect(report.runs[0].turns[0].projectRouting).toEqual(diagnosis);
      expect(
        JSON.parse(fs.readFileSync(path.join(dir, 'report.json'))).runs[0].turns[0].projectRouting
      ).toEqual(diagnosis);
      const markdown = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
      expect(markdown).toContain('Aktenbewertung: beste Akte');
      expect(markdown).toContain(
        present ? '| project-a | 0.45 | 0.45 | no_content |' : '| – | 0 | 0 | not_evaluated |'
      );
      report.runs[0].turns[0].projectRouting.bestProjectId = '<script>|';
      expect(renderPracticeReport(report)).not.toContain('<script>');
      expect(report.gate.passed).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
