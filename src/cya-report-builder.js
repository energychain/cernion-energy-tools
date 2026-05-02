'use strict';

const PDFDocument = require('pdfkit');

/**
 * Build a PDF buffer from a CYA session object.
 *
 * @param {object} session  - CYA session (single or multi_perspective).
 * @param {object} [options]
 * @param {string}  [options.language='de']                     - 'de' | 'en'
 * @param {boolean} [options.includeRegulatoryDetails=true]     - include regulatory graph section
 * @param {boolean} [options.includeDataBasis=true]             - include grounding / data-basis section
 * @param {boolean} [options.includeAITransparency=true]        - include EU AI Act Art. 13 footer
 * @returns {Promise<Buffer>}
 */
async function buildCyaNarrativePdf(session, options = {}) {
  const {
    language = 'de',
    includeRegulatoryDetails = true,
    includeDataBasis = true,
    includeAITransparency = true,
  } = options;

  const t = language === 'en' ? LABELS_EN : LABELS_DE;
  const isMulti = session.type === 'multi_perspective' || Array.isArray(session.perspectives);

  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({ autoFirstPage: true, margin: 50 });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // ── Cover ────────────────────────────────────────────────────────────────
    addCover(doc, t, session, isMulti);

    // ── Single-perspective narrative ─────────────────────────────────────────
    if (!isMulti) {
      doc.addPage();
      addNarrativeSection(doc, t, session.narrative);

      if (includeRegulatoryDetails && session.regulatory_graph) {
        doc.addPage();
        addRegulatorySection(doc, t, session.regulatory_graph);
      }

      if (includeDataBasis && session.grounding) {
        doc.addPage();
        addDataBasisSection(doc, t, session.grounding);
      }
    } else {
      // ── Multi-perspective ──────────────────────────────────────────────────
      const perspectives = session.perspectives || [];

      // Shared grounding & regulatory graph (computed once)
      if (includeRegulatoryDetails && session.regulatory_graph) {
        doc.addPage();
        addRegulatorySection(doc, t, session.regulatory_graph);
      }

      if (includeDataBasis && session.grounding) {
        doc.addPage();
        addDataBasisSection(doc, t, session.grounding);
      }

      // One page per perspective
      for (const p of perspectives) {
        doc.addPage();
        addPerspectiveSection(doc, t, p);
      }

      // Comparison summary table
      if (perspectives.length >= 2) {
        doc.addPage();
        addComparisonTable(doc, t, perspectives);
      }
    }

    // ── AI Transparency footer page ──────────────────────────────────────────
    if (includeAITransparency) {
      doc.addPage();
      addAITransparencySection(doc, t, session);
    }

    doc.end();
  });
}

// ── Section builders ──────────────────────────────────────────────────────────

function addCover(doc, t, session, isMulti) {
  doc
    .fontSize(22)
    .font('Helvetica-Bold')
    .text(isMulti ? t.titleMulti : t.titleSingle, { align: 'center' });
  doc.moveDown(0.5);

  doc
    .fontSize(11)
    .font('Helvetica')
    .text(`${t.sessionId}: ${session.session_id || '—'}`, { align: 'center' });

  const createdAt = session.metadata?.createdAt || session.createdAt || new Date().toISOString();
  doc.text(`${t.generated}: ${new Date(createdAt).toLocaleString(t.locale)}`, { align: 'center' });

  if (session.target_audience) {
    doc.moveDown(0.5).text(`${t.audience}: ${session.target_audience}`, { align: 'center' });
  }

  if (session.metadata?.location) {
    doc.text(`${t.location}: ${session.metadata.location}`, { align: 'center' });
  }

  if (session.metadata?.trigger) {
    doc.text(`${t.trigger}: ${session.metadata.trigger}`, { align: 'center' });
  }
}

function addNarrativeSection(doc, t, narrative) {
  if (!narrative) {
    doc.fontSize(12).font('Helvetica').text(t.noNarrative);
    return;
  }

  doc.fontSize(16).font('Helvetica-Bold').text(t.narrative);
  doc.moveDown(0.4);

  if (narrative.headline) {
    doc.fontSize(13).font('Helvetica-Bold').text(narrative.headline);
    doc.moveDown(0.3);
  }

  if (narrative.executiveSummary) {
    doc.fontSize(11).font('Helvetica').text(narrative.executiveSummary, { align: 'justify' });
    doc.moveDown(0.5);
  }

  if (Array.isArray(narrative.keyPoints) && narrative.keyPoints.length) {
    doc.fontSize(12).font('Helvetica-Bold').text(t.keyPoints);
    doc.moveDown(0.2);
    for (const kp of narrative.keyPoints) {
      doc.fontSize(11).font('Helvetica').text(`• ${kp}`);
    }
    doc.moveDown(0.5);
  }

  if (Array.isArray(narrative.recommendedActions) && narrative.recommendedActions.length) {
    doc.fontSize(12).font('Helvetica-Bold').text(t.recommendations);
    doc.moveDown(0.2);
    for (const ra of narrative.recommendedActions) {
      doc.fontSize(11).font('Helvetica').text(`• ${ra}`);
    }
    doc.moveDown(0.5);
  }

  if (Array.isArray(narrative.riskNotes) && narrative.riskNotes.length) {
    doc.fontSize(12).font('Helvetica-Bold').text(t.risks);
    doc.moveDown(0.2);
    for (const rn of narrative.riskNotes) {
      doc.fontSize(11).font('Helvetica').text(`• ${rn}`);
    }
  }
}

function addRegulatorySection(doc, t, regulatoryGraph) {
  doc.fontSize(16).font('Helvetica-Bold').text(t.regulatory);
  doc.moveDown(0.4);

  const signals = regulatoryGraph?.signals || regulatoryGraph?.nodes || [];
  if (!signals.length) {
    doc.fontSize(11).font('Helvetica').text(t.noRegulatoryData);
    return;
  }

  for (const sig of signals.slice(0, 20)) {
    const label = sig.label || sig.id || sig.name || '';
    const status = sig.status || sig.state || '';
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(`• ${label}${status ? ` [${status}]` : ''}`);
  }
}

function addDataBasisSection(doc, t, grounding) {
  doc.fontSize(16).font('Helvetica-Bold').text(t.dataBasis);
  doc.moveDown(0.4);

  const confidence = grounding?.confidence ?? grounding?.score ?? null;
  if (confidence !== null) {
    doc
      .fontSize(11)
      .font('Helvetica')
      .text(`${t.confidence}: ${Math.round(confidence * 100)}%`);
    doc.moveDown(0.3);
  }

  const facts = grounding?.facts || [];
  if (facts.length) {
    doc.fontSize(12).font('Helvetica-Bold').text(t.facts);
    doc.moveDown(0.2);
    for (const f of facts.slice(0, 15)) {
      const stmt = f.statement || f.text || JSON.stringify(f);
      doc.fontSize(11).font('Helvetica').text(`• ${stmt}`);
    }
    doc.moveDown(0.3);
  }

  const gaps = grounding?.dataGaps || grounding?.gaps || [];
  if (gaps.length) {
    doc.fontSize(12).font('Helvetica-Bold').text(t.dataGaps);
    doc.moveDown(0.2);
    for (const g of gaps) {
      const txt = typeof g === 'string' ? g : g.description || JSON.stringify(g);
      doc.fontSize(11).font('Helvetica').text(`• ${txt}`);
    }
  }
}

function addPerspectiveSection(doc, t, perspective) {
  const label = perspective.profile_id || perspective.profileId || perspective._sourceId || '';
  doc.fontSize(16).font('Helvetica-Bold').text(`${t.perspective}: ${label}`);
  doc.moveDown(0.3);

  if (perspective.actor) {
    doc.fontSize(11).font('Helvetica').text(`${t.actor}: ${perspective.actor}`);
  }
  if (perspective.tone) {
    doc.fontSize(11).font('Helvetica').text(`${t.tone}: ${perspective.tone}`);
  }
  doc.moveDown(0.3);

  addNarrativeSection(doc, t, perspective.narrative);
}

function addComparisonTable(doc, t, perspectives) {
  doc.fontSize(16).font('Helvetica-Bold').text(t.comparisonTable);
  doc.moveDown(0.4);

  for (const p of perspectives) {
    const id = p.profile_id || p.profileId || p._sourceId || '?';
    const headline = p.narrative?.headline || t.noNarrative;
    doc.fontSize(12).font('Helvetica-Bold').text(`${id}:`);
    doc.fontSize(11).font('Helvetica').text(`  ${headline}`);
    doc.moveDown(0.2);
  }
}

function addAITransparencySection(doc, t, session) {
  doc.fontSize(16).font('Helvetica-Bold').text(t.aiTransparency);
  doc.moveDown(0.4);

  const lines = [
    t.aiArt13Line1,
    t.aiArt13Line2,
    `${t.sessionId}: ${session.session_id || '—'}`,
    `${t.generated}: ${new Date().toLocaleString(t.locale)}`,
    t.aiArt13Line3,
  ];

  for (const line of lines) {
    doc.fontSize(10).font('Helvetica').text(line, { align: 'justify' });
    doc.moveDown(0.2);
  }
}

// ── Labels ────────────────────────────────────────────────────────────────────

const LABELS_DE = {
  locale: 'de-DE',
  titleSingle: 'CYA Narrative – Lagebericht',
  titleMulti: 'CYA Narrative – Multi-Perspektiven-Vergleich',
  sessionId: 'Session-ID',
  generated: 'Erstellt',
  audience: 'Zielgruppe',
  location: 'Standort',
  trigger: 'Anlass',
  narrative: 'Narrative',
  noNarrative: '(Kein abgeschlossenes Narrative verfügbar.)',
  keyPoints: 'Kernaussagen',
  recommendations: 'Empfohlene Maßnahmen',
  risks: 'Risikohinweise',
  regulatory: 'Regulatorischer Kontext',
  noRegulatoryData: '(Keine regulatorischen Signale verfügbar.)',
  dataBasis: 'Datenbasis',
  confidence: 'Belastbarkeit',
  facts: 'Fakten',
  dataGaps: 'Datenlücken',
  perspective: 'Perspektive',
  actor: 'Akteursrolle',
  tone: 'Kommunikationston',
  comparisonTable: 'Vergleichsübersicht',
  aiTransparency: 'KI-Transparenzhinweis (EU AI Act Art. 13)',
  aiArt13Line1:
    'Dieses Dokument wurde mit Unterstützung eines KI-Systems (Cernion CYA Agent) erstellt.',
  aiArt13Line2:
    'Die enthaltenen Aussagen basieren auf Daten aus öffentlichen Quellen (MaStR, ENTSO-E, BNetzA). ' +
    'Alle Angaben sind ohne Gewähr und ersetzen keine rechtliche oder regulatorische Beratung.',
  aiArt13Line3:
    'Gemäß EU AI Act Art. 13 werden Nutzer darüber informiert, dass KI-generierte Inhalte einer ' +
    'menschlichen Überprüfung bedürfen, bevor sie für Entscheidungen herangezogen werden.',
};

const LABELS_EN = {
  locale: 'en-GB',
  titleSingle: 'CYA Narrative – Situation Report',
  titleMulti: 'CYA Narrative – Multi-Perspective Comparison',
  sessionId: 'Session ID',
  generated: 'Generated',
  audience: 'Target Audience',
  location: 'Location',
  trigger: 'Trigger',
  narrative: 'Narrative',
  noNarrative: '(No completed narrative available.)',
  keyPoints: 'Key Points',
  recommendations: 'Recommended Actions',
  risks: 'Risk Notes',
  regulatory: 'Regulatory Context',
  noRegulatoryData: '(No regulatory signals available.)',
  dataBasis: 'Data Basis',
  confidence: 'Confidence',
  facts: 'Facts',
  dataGaps: 'Data Gaps',
  perspective: 'Perspective',
  actor: 'Actor Role',
  tone: 'Communication Tone',
  comparisonTable: 'Comparison Overview',
  aiTransparency: 'AI Transparency Notice (EU AI Act Art. 13)',
  aiArt13Line1:
    'This document was created with the assistance of an AI system (Cernion CYA Agent).',
  aiArt13Line2:
    'The statements contained herein are based on data from public sources (MaStR, ENTSO-E, BNetzA). ' +
    'All information is provided without warranty and does not substitute legal or regulatory advice.',
  aiArt13Line3:
    'Pursuant to EU AI Act Art. 13, users are informed that AI-generated content requires human ' +
    'review before being used for decision-making.',
};

module.exports = { buildCyaNarrativePdf };
