'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { reviewDocuments } = require('../src/workbench-review');
const { storedPassage, renderReview } = require('../src/workbench-document-flow');
const {
  mappedPassages,
  passageLines,
  summarizePassages,
} = require('../src/workbench-document-passages');
const { markParagraphs } = require('../src/workbench-conversation-mode');
const { sourceLine } = require('../src/workbench-answer-evidence');
const text = fs.readFileSync(
  path.join(__dirname, 'fixtures/document-review/neutral-eight-chapters.txt'),
  'utf8'
);
const documents = [{ name: 'Synthetischer Plan', text, completeness: 'full' }];
const emptyReview = () => ({
  verdict: 'Innere Widersprüche.',
  rationale: 'Drei konkrete Befunde.',
  strengths: [],
  risks: [],
  checkpoints: [],
  contradictions: [],
  openQuestions: [],
  draft: '',
});

function anchoredFacade(tamper = false) {
  return {
    generateStructured: jest.fn(async (_schema, prompt) => {
      const data = JSON.parse(prompt);
      if (data.untrustedDocument) {
        const citations = data.lines.filter((line) =>
          /Gesamtzahl|verfügbare Budget/.test(line.quote)
        );
        if (tamper) citations.push({ line: 1, quote: 'Das Budget beträgt 9999.' });
        return {
          claims: citations.map((citation) => citation.quote),
          assumptions: [],
          numbers: [],
          measures: [],
          schedule: [],
          citations,
        };
      }
      const index = (chapter) =>
        data.locations.findIndex((location) => location.chapter.startsWith(`Kapitel ${chapter}:`));
      return {
        ...emptyReview(),
        contradictions: [
          {
            finding: 'Im gleichen Ausgangsjahr stehen 120 und 280 Einheiten.',
            locations: [index(3), index(4)],
            criterion: -1,
          },
          {
            finding: 'Der Abschluss 01.05.2030 liegt vor dem Start 01.06.2030.',
            locations: [index(4)],
            criterion: -1,
          },
          {
            finding: 'Ausgaben von 1300 überschreiten das Budget von 900.',
            locations: [index(5)],
            criterion: -1,
          },
          ...(tamper
            ? [{ finding: 'Das Budget beträgt 9999.', locations: [index(3), 999], criterion: -1 }]
            : []),
        ],
      };
    }),
  };
}

test('all generated inconsistencies cite their actual chapters inside one shared map', async () => {
  const llm = anchoredFacade();
  const result = await reviewDocuments({ documents, question: 'Bewerte den Plan' }, { llm });
  expect(result.status).toBe('completed');
  expect(result.stats.mapCalls).toBe(1);
  expect(
    result.review.contradictions.map((point) =>
      point.locations.map((index) => result.locations[index].chapter)
    )
  ).toEqual([
    ['Kapitel 3: Synthetische Planung', 'Kapitel 4: Synthetische Planung'],
    ['Kapitel 4: Synthetische Planung'],
    ['Kapitel 5: Synthetische Planung'],
  ]);
  for (const location of result.locations) {
    expect(text.slice(location.start, location.end)).toBe(location.quote);
    expect(location.page).toBe(Number(location.chapter.match(/\d+/u)[0]));
    expect(location.end - location.start).toBeLessThan(300);
  }
  const rendered = renderReview(result);
  expect(rendered).not.toMatch(/Kapitel 1|Kapitel 2/);
  expect(rendered).toContain('Kapitel 5');
});

test('fabricated quotes, wrong line anchors and unsupported numbers are removed', async () => {
  const result = await reviewDocuments(
    { documents, question: 'Prüfen' },
    { llm: anchoredFacade(true) }
  );
  expect(result.status).toBe('completed');
  expect(result.locations).toHaveLength(3);
  expect(result.review.contradictions).toHaveLength(3);
  expect(renderReview(result)).not.toContain('9999');
});

test('unanchored repeated quotes are ambiguous; explicit lines resolve them without guessing', () => {
  const raw = 'Gleiche Aussage 42.\nGleiche Aussage 42.';
  const lines = passageLines(raw, [{ chapter: 'Kapitel 3', page: 7, start: 0, end: raw.length }]);
  expect(mappedPassages({ citations: [{ line: 1, quote: 'Erfundene Aussage' }] }, lines)).toEqual(
    []
  );
  expect(
    mappedPassages(
      { claims: ['Gleiche Aussage 42.'], assumptions: [], numbers: [], measures: [], schedule: [] },
      lines
    )
  ).toEqual([]);
  expect(
    mappedPassages({ citations: [{ line: 2, quote: 'Aussage 42.' }] }, lines)[0]
  ).toMatchObject({ start: raw.lastIndexOf('Aussage'), page: 7, chapter: 'Kapitel 3' });
});

test('chapter five is concise, omits boilerplate and cites each short quote exactly', () => {
  const response = storedPassage(documents, 'Was steht in Kapitel 5 genau?');
  expect(response).toContain('Kurzfassung von Kapitel 5');
  expect(response).toContain('Budget beträgt 900');
  expect(response).toContain('Ausgaben betragen 1300');
  expect(response).toContain('12-fach wiederholter Standardtext ausgelassen');
  expect(response).not.toContain('Standardtext regelmäßig');
  expect(response.length).toBeLessThan(900);
  const offset = response.match(/Zeichen (\d+)–(\d+)/u);
  const quote = response.match(/^> (.+)$/mu)[1];
  expect(text.slice(Number(offset[1]), Number(offset[2]))).toBe(quote);
  expect(response).toContain('Kapitel 5: Synthetische Planung · Seite 5');
});

test('different numeric statements are substantive and never mistaken for repeated standard text', () => {
  const lines = ['Budget 100.', 'Budget 200.', 'Budget 300.'].map((quote) => ({ quote }));
  expect(summarizePassages(lines).selected).toHaveLength(3);
});

test('marker guard: one at the end of each answer block, none on greeting or signature', () => {
  const rendered = markParagraphs(
    'Einordnung:\nAngabe A (bitte gegenprüfen)\n\nAngabe B (bitte gegenprüfen)\n\nSchritte:\nSchritt A (bitte gegenprüfen)\n\nSchritt B (bitte gegenprüfen)\n\nEntwurf:\nGuten Tag, (bitte gegenprüfen)\n\nAussage A (bitte gegenprüfen)\n\nAussage B (bitte gegenprüfen)\n\nViele Grüße (bitte gegenprüfen)\nTeam (bitte gegenprüfen)',
    false
  );
  expect(rendered.match(/\(bitte gegenprüfen\)/gu)).toHaveLength(3);
  for (const finalLine of ['Angabe B', 'Schritt B', 'Aussage B'])
    expect(rendered).toContain(`${finalLine} (bitte gegenprüfen)`);
  expect(rendered).not.toMatch(/(?:Guten Tag,|Viele Grüße|Team) \(bitte gegenprüfen\)/u);
  expect(markParagraphs('Guten Tag,\n\nViele Grüße\nTeam', true)).not.toContain('gegenprüfen');
  expect(markParagraphs('Belegte Aussage.\n\nWeiterer belegter Punkt.', false)).not.toContain(
    'gegenprüfen'
  );
});

test('sources require actual document titles; metadata wins over systems, IDs and filenames', () => {
  expect(
    sourceLine([
      { source: 'willi-mako' },
      { title: 'Wissensquelle' },
      { title: 'E_1234.json', sectionId: 'Abschnitt 5' },
    ])
  ).toBe('');
  expect(
    sourceLine([
      {
        source: 'willi-mako',
        title: 'willi-mako',
        metadata: { documentTitle: 'Planungsleitfaden', sectionTitle: 'Nachweise' },
      },
    ])
  ).toBe('Quellen: Planungsleitfaden · Nachweise');
});

test('knowledge projections preserve document and section titles before the workbench renders them', () => {
  const { toSafeEvidenceHit } = require('../src/personal-agent-knowledge-rag')._internal;
  const hit = toSafeEvidenceHit({
    summary: 'Synthetischer Nachweis.',
    source: 'knowledge-rag',
    metadata: { documentTitle: 'Leitfaden 3.2', sectionTitle: 'Kapitel 4.1' },
  });
  expect(sourceLine([hit])).toBe('Quellen: Leitfaden 3.2 · Kapitel 4.1');
  expect(sourceLine([{ title: 'EBD E_0608' }, { title: 'knowledge-rag' }])).toBe('');
});
