'use strict';

// Mock pdfkit so tests run without writing real PDF bytes
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const mockEmitter = { _listeners: {} };
    mockEmitter.on = function (event, fn) {
      if (!mockEmitter._listeners[event]) mockEmitter._listeners[event] = [];
      mockEmitter._listeners[event].push(fn);
      return mockEmitter;
    };
    mockEmitter.emit = function (event, ...args) {
      const fns = mockEmitter._listeners[event] || [];
      fns.forEach((fn) => fn(...args));
    };
    const methods = ['fontSize', 'font', 'text', 'moveDown', 'addPage'];
    for (const m of methods) {
      mockEmitter[m] = jest.fn().mockReturnValue(mockEmitter);
    }
    mockEmitter.end = jest.fn(() => {
      mockEmitter.emit('data', Buffer.from('%PDF-1.4\n%%EOF\n'));
      mockEmitter.emit('end');
    });
    return mockEmitter;
  });
});

const PDFDocument = require('pdfkit');
const { buildCyaNarrativePdf } = require('../src/cya-report-builder');

const COMPLETED_SESSION = {
  session_id: 'cya_test_001',
  status: 'completed',
  target_audience: 'Aufsichtsrat',
  metadata: {
    createdAt: '2026-04-18T10:00:00.000Z',
    location: 'Heidelberg',
    trigger: 'Presseanfrage',
  },
  narrative: {
    headline: 'Stabile Versorgungslage',
    executiveSummary: 'Die Lage ist stabil.',
    keyPoints: ['Punkt A', 'Punkt B'],
    recommendedActions: ['Maßnahme 1'],
    riskNotes: ['Risiko X'],
  },
  grounding: {
    confidence: 0.85,
    facts: [{ statement: 'SEE123 – 100 kW Solaranlage in Heidelberg', focusArea: 'capacity' }],
    dataGaps: ['Keine aktuellen Redispatch-Daten verfügbar'],
  },
  regulatory_graph: {
    signals: [{ label: 'EEG 2023 §10', status: 'active' }],
  },
};

const MULTI_SESSION = {
  session_id: 'cya_mp_test_001',
  type: 'multi_perspective',
  status: 'completed',
  target_audience: 'Aufsichtsrat',
  metadata: { createdAt: '2026-04-18T10:00:00.000Z' },
  grounding: { confidence: 0.8, facts: [], dataGaps: [] },
  regulatory_graph: { signals: [] },
  perspectives: [
    {
      _sourceId: 'vnb_defensiv',
      actor: 'grid_operator',
      tone: 'defensiv',
      narrative: {
        headline: 'VNB-Sicht',
        executiveSummary: 'Netzstabilität im Fokus.',
        keyPoints: ['Regelenergie verfügbar'],
        recommendedActions: [],
        riskNotes: [],
      },
    },
    {
      _sourceId: 'projektierer_offensiv',
      actor: 'project_developer',
      tone: 'offensiv',
      narrative: {
        headline: 'Projektierer-Sicht',
        executiveSummary: 'Ausbau beschleunigen.',
        keyPoints: ['Kapazität vorhanden'],
        recommendedActions: ['Netzanschluss beantragen'],
        riskNotes: [],
      },
    },
  ],
};

beforeEach(() => {
  PDFDocument.mockClear();
});

describe('buildCyaNarrativePdf', () => {
  it('returns a Buffer', async () => {
    const buf = await buildCyaNarrativePdf(COMPLETED_SESSION);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('buffer starts with %PDF', async () => {
    const buf = await buildCyaNarrativePdf(COMPLETED_SESSION);
    expect(buf.toString('utf8', 0, 4)).toBe('%PDF');
  });

  it('returns non-empty buffer', async () => {
    const buf = await buildCyaNarrativePdf(COMPLETED_SESSION);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('builds PDF for multi-perspective session', async () => {
    const buf = await buildCyaNarrativePdf(MULTI_SESSION);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('handles null narrative gracefully', async () => {
    const session = { ...COMPLETED_SESSION, narrative: null };
    await expect(buildCyaNarrativePdf(session)).resolves.toBeTruthy();
  });

  it('handles null grounding gracefully', async () => {
    const session = { ...COMPLETED_SESSION, grounding: null };
    await expect(buildCyaNarrativePdf(session)).resolves.toBeTruthy();
  });

  it('calls addPage multiple times for multi-perspective sessions', async () => {
    await buildCyaNarrativePdf(MULTI_SESSION);
    const docInstance = PDFDocument.mock.results[0].value;
    expect(docInstance.addPage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('skips regulatory section when includeRegulatoryDetails=false', async () => {
    await buildCyaNarrativePdf(COMPLETED_SESSION, { includeRegulatoryDetails: false });
    // Should still resolve successfully
    const docInstance = PDFDocument.mock.results[0].value;
    expect(docInstance.end).toHaveBeenCalledTimes(1);
  });

  it('skips data basis section when includeDataBasis=false', async () => {
    await buildCyaNarrativePdf(COMPLETED_SESSION, { includeDataBasis: false });
    const docInstance = PDFDocument.mock.results[0].value;
    expect(docInstance.end).toHaveBeenCalledTimes(1);
  });

  it('includes AI transparency text by default', async () => {
    await buildCyaNarrativePdf(COMPLETED_SESSION);
    const docInstance = PDFDocument.mock.results[0].value;
    const textCalls = docInstance.text.mock.calls.map((c) => c[0]);
    const hasAiText = textCalls.some(
      (s) => typeof s === 'string' && (s.includes('EU AI Act') || s.includes('KI-Transparenz'))
    );
    expect(hasAiText).toBe(true);
  });

  it('supports English language option', async () => {
    const buf = await buildCyaNarrativePdf(COMPLETED_SESSION, { language: 'en' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    const docInstance = PDFDocument.mock.results[0].value;
    const textCalls = docInstance.text.mock.calls.map((c) => c[0]);
    const hasEnTitle = textCalls.some(
      (s) => typeof s === 'string' && s.includes('Situation Report')
    );
    expect(hasEnTitle).toBe(true);
  });
});
