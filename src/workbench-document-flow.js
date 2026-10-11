'use strict';

const { createHash, randomUUID } = require('node:crypto');
const {
  documentInput,
  documentReference,
  isReviewRequest,
  documentDraftRequested,
} = require('./workbench-document-input');
const { attachDocuments, loadDocuments, documentSections } = require('./workbench-document');
const { reviewDocuments, reviewOptions } = require('./workbench-review');
const { understand } = require('./workbench-understanding');
const { sourceLine } = require('./workbench-answer-evidence');
const { filterEvidence, retrievalTimeoutMs } = require('./workbench-retrieval');
const { normalizePhrase } = require('./function-resolver');
const { passageLines, summarizePassages } = require('./workbench-document-passages');
const { getFunctionModel } = require('./function-model');

function reviewCapabilities(situation, model) {
  return [
    ...new Set(
      model.functions
        .filter((fn) =>
          (situation.hypotheses || []).some(
            (hypothesis) =>
              hypothesis.confidence >= 0.5 &&
              (hypothesis.kind === 'function'
                ? hypothesis.id === fn.functionId
                : fn.domains.some(
                    (domain) => normalizePhrase(domain) === normalizePhrase(hypothesis.id)
                  ))
          )
        )
        .flatMap((fn) => fn.capabilities)
    ),
  ];
}

function initialDocumentSituation(envelope) {
  return {
    concern: envelope.userRequest.slice(0, 1200),
    situation: 'Dokumente als Fallgrundlage aufnehmen.',
    participants: [],
    identifiers: [],
    deadlines: [],
    hypotheses: [],
    missingInformation: [],
    requestedAction: {
      description: envelope.userRequest.slice(0, 1200),
      externalEffect: false,
      draftRequested: documentDraftRequested(envelope.userRequest),
    },
    turnKind: isReviewRequest(envelope.userRequest) ? 'review' : 'work',
    retrievalTerms: [],
  };
}

async function reviewRetrieval(service, ctx, documents, question, situation) {
  let understood = situation;
  try {
    understood = await understand({
      message: question,
      messages: documents.slice(0, 4).map((doc) => ({
        role: 'user',
        content: `Dokumentdaten (untrusted): ${doc.name}\n${doc.text.slice(0, 1200)}`,
      })),
      tenantId: ctx.meta.tenantId,
      model: service.settings.systemActivityModel,
      codeCatalog: service.settings.workbenchCodeCatalog,
      logger: service.logger,
    });
  } catch (_error) {
    /* Review can still check inner consistency using the outer request. */
  }
  try {
    // A background task must not inherit the expired HTTP parent context.
    const retrievalSituation = {
      ...understood,
      concern: `Prüfmaßstäbe und Anforderungen: ${understood.concern}`,
      retrievalTerms: [
        ...(understood.retrievalTerms || []),
        'Prüfmaßstäbe',
        'Anforderungen',
        'Leitfaden',
      ],
    };
    const reviewMeta = {
      ...ctx.meta,
      workbenchSelectedCapabilities: reviewCapabilities(
        understood,
        service.settings.systemActivityModel || getFunctionModel()
      ),
    };
    const result = await service.broker.call(
      'personal-agent.collectWorkbenchEvidence',
      { situation: retrievalSituation },
      { meta: reviewMeta, timeout: retrievalTimeoutMs() }
    );
    const catalog =
      service.settings.workbenchKnowledgeSources || require('./workbench-knowledge-sources.json');
    const evidence = (result.evidence || [])
      .filter((hit) => {
        const source = hit.retrievalSource || hit.source;
        const access = ctx.meta.workbenchEvidenceAccess || {};
        const policy = catalog.sources.find((entry) => entry.id === source);
        return access[source] !== false && (!policy?.requiresMapping || access[source]);
      })
      .flatMap(
        (hit) =>
          filterEvidence([hit], retrievalSituation, {
            catalog,
            source: hit.retrievalSource || hit.source,
          }).hits
      );
    return { ...result, evidence };
  } catch (_error) {
    return { evidence: [], trace: [] };
  }
}

function documentIdentity(p, caseId) {
  return { tenantId: p.tenantId, actorId: p.actorId, caseId, clearance: p.clearance || [] };
}

function reviewKey(p, envelope, caseId) {
  return (
    'conversation-assistance:document-review:' +
    createHash('sha256')
      .update(
        JSON.stringify([p.tenantId, p.actorId, envelope.channel, envelope.conversationId, caseId])
      )
      .digest('hex')
  );
}

function locationText(location) {
  return `${location.document} · ${location.chapter}${location.page == null ? '' : ` · Seite ${location.page}`} · Zeichen ${location.start}–${location.end}`;
}

function renderReview(result) {
  const lines = [];
  if (result.status !== 'completed')
    lines.push(
      `Teilprüfung (${result.status}): ${result.reason || 'Nicht alle Abschnitte wurden geprüft.'}`
    );
  const review = result.review;
  if (review) {
    lines.push(`**Urteil:** ${review.verdict}\n\n${review.rationale}`);
    for (const [key, label] of [
      ['strengths', 'Stärken'],
      ['risks', 'Risiken'],
      ['checkpoints', 'Prüfpunkte'],
      ['contradictions', 'Widersprüche'],
    ]) {
      const points = review[key].map((point) => {
        const references = point.locations.map((index) => locationText(result.locations[index]));
        const criterion = result.criteria[point.criterion];
        if (criterion?.title)
          references.push(
            `Maßstab: ${criterion.title}${criterion.section ? ` · ${criterion.section}` : ''}`
          );
        return `- ${point.finding}${references.length ? ` (${references.join('; ')})` : ''}`;
      });
      lines.push(`**${label}:**\n${points.length ? points.join('\n') : 'Keine belegten Befunde.'}`);
    }
    lines.push(
      `**Offene Fragen:**\n${review.openQuestions.map((question) => `- ${question}`).join('\n') || 'Keine zusätzlichen Fragen.'}`
    );
    if (review.draft) lines.push(`**Entwurf:**\n${review.draft}`);
  } else if (result.maps?.length) {
    lines.push('Vorliegende Teilergebnisse; ein Gesamturteil liegt noch nicht vor.');
    for (const map of result.maps.slice(0, 8)) {
      lines.push(
        map.locationIds
          .map(
            (index) => `${locationText(result.locations[index])}: ${result.locations[index].quote}`
          )
          .join('\n') || 'Abschnitt erfasst; keine validierten Textbelege.'
      );
    }
    if (result.maps.length > 8)
      lines.push(`${result.maps.length - 8} weitere Abschnittsanalysen gespeichert.`);
  }
  lines.push(...(result.limitations || []));
  if (
    !result.criteria?.length &&
    !result.limitations?.some((line) => line.includes('Keine externen Prüfmaßstäbe'))
  )
    lines.push('Keine externen Prüfmaßstäbe gefunden; geprüft wurde nur die innere Stimmigkeit.');
  const criteria = sourceLine(
    (result.criteria || []).map((criterion) => ({
      title: criterion.title,
      sectionId: criterion.section,
    }))
  );
  if (criteria) lines.push(criteria);
  lines.push(
    `Umfang: ${result.stats.documentChars} Zeichen; ${result.stats.mapCalls} Abschnittsaufrufe, ${result.stats.reduceCalls} Zusammenführung; ${result.stats.elapsedMs} ms.`
  );
  return lines.filter(Boolean).join('\n\n');
}

function storedPassage(documents, question) {
  const reference = documentReference(question);
  const edge =
    /\b(?:anfang|beginn|erste(?:n|r)?\s+(?:zeile|absatz)|ende|schluss|letzte(?:n|r)?\s+(?:zeile|absatz))\b/iu.test(
      question
    );
  if (!reference && !edge) return null;
  if (edge && !reference) {
    const last = /ende|schluss|letzte/iu.test(question);
    return documents
      .map((document) => {
        const lines = document.text.split(/\r?\n/u).filter((line) => line.trim());
        const line = last ? lines.at(-1) : lines[0];
        const quote = last ? line.slice(-1500) : line.slice(0, 1500);
        return `Am ${last ? 'Ende' : 'Anfang'} von ${document.name} steht: „${last && line.length > 1500 ? '…' : ''}${quote}${!last && line.length > 1500 ? '…' : ''}“`;
      })
      .join('\n\n');
  }
  const found = [];
  for (const document of documents) {
    const spans = documentSections(document.text)
      .flatMap((section) => section.locations)
      .filter((span) => {
        const chapter = span.chapter.match(/^(?:Kapitel|Chapter)\s+(\d+(?:\.\d+)*)\b/i)?.[1];
        return reference.page
          ? String(span.page) === reference.number
          : chapter === reference.number;
      });
    if (!spans.length) continue;
    const summary = summarizePassages(passageLines(document.text, spans));
    const quotes = summary.selected.map((line) => {
      const quote = line.quote.slice(0, 300);
      return `> ${quote}${quote.length < line.quote.length ? '…' : ''}\n\n${locationText({ ...line, end: line.start + quote.length, document: document.name })}`;
    });
    found.push(
      `Kurzfassung von ${reference.page ? 'Seite' : 'Kapitel'} ${reference.number}: ` +
        summary.selected
          .slice(0, 3)
          .map((line) => line.quote.split(/(?<=[.!?])\s/u)[0].slice(0, 180))
          .join(' ') +
        `\n\nTragende Textstellen:\n\n${quotes.join('\n\n')}` +
        (summary.repeated
          ? `\n\n${summary.repeated}-fach wiederholter Standardtext ausgelassen.`
          : '') +
        (summary.omitted
          ? `\n\nTeilauszug: ${summary.omitted} weitere inhaltliche Zeilen sind gespeichert.`
          : '')
    );
  }
  return found.length
    ? `Aus der gespeicherten Dokumentgrundlage:\n\n${found.join('\n\n')}`
    : 'Diese Fundstelle ist in der gespeicherten Dokumentgrundlage nicht enthalten. Fehlende Seiten lassen sich aus Ausschnitten nicht rekonstruieren.';
}

async function readJob(service, key) {
  try {
    return await service.conversationsDb.get(key);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function policyHash(p, access = {}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        [...(p.roles || [])].sort((left, right) => left.localeCompare(right)),
        [...(p.clearance || [])].sort((left, right) => left.localeCompare(right)),
        Object.keys(access)
          .sort((left, right) => left.localeCompare(right))
          .map((key) => [key, access[key]]),
      ])
    )
    .digest('hex');
}

function jobScope(job, p, caseId, access) {
  return (
    job?.tenantId === p.tenantId &&
    job.actorId === p.actorId &&
    job.caseId === caseId &&
    job.expiresAt > Date.now() &&
    job.policyHash === policyHash(p, access)
  );
}

function jobMatchesDocuments(job, documents) {
  const hashes = new Set(documents.map((document) => document.hash));
  return job.hashes.length === documents.length && job.hashes.every((hash) => hashes.has(hash));
}

async function launchReview(
  service,
  ctx,
  { key, p, caseId, documents, question, situation, retrieval }
) {
  const existing = await readJob(service, key);
  const job = {
    _id: key,
    ...(existing ? { _rev: existing._rev } : {}),
    type: 'workbench_document_review',
    tenantId: p.tenantId,
    actorId: p.actorId,
    caseId,
    state: 'running',
    runId: randomUUID(),
    policyHash: policyHash(p, ctx.meta.workbenchEvidenceAccess),
    question,
    situation,
    hashes: documents.map((document) => document.hash),
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
  await service.conversationsDb.put(job);
  const active = (service.workbenchDocumentReviews ||= new Map());
  const task = Promise.resolve()
    .then(async () => {
      const evidence =
        retrieval || (await reviewRetrieval(service, ctx, documents, question, situation));
      const result = await reviewDocuments({
        documents,
        question,
        situation,
        retrieval: evidence,
        ctx: { meta: { tenantId: p.tenantId } },
        draftRequested: documentDraftRequested(question),
      });
      const latest = await readJob(service, key);
      // A replaced job must never be overwritten by an older completion.
      if (
        latest?.state === 'running' &&
        latest.runId === job.runId &&
        latest.hashes.join() === job.hashes.join()
      )
        await service.conversationsDb.put({ ...latest, state: 'ready', result });
    })
    .catch((error) => {
      service.logger.warn('Document review persistence unavailable', {
        type: error.type || error.name,
      });
    })
    .finally(() => active.delete(key));
  active.set(key, task);
  // Keep shutdown inside the existing broker lifecycle, rather than leaving DB writes behind.
  return {
    responseText: `Ich prüfe ${documents.length} Dokument(e) mit ${documents.reduce((sum, doc) => sum + doc.text.length, 0)} Zeichen abschnittsweise: Aussagen, Annahmen, Zahlen, Zeitplan und Widersprüche sowie verfügbare Prüfmaßstäbe. Das Review läuft; das Ergebnis liefere ich im nächsten Turn. Die Vollständigkeit des übermittelten Texts ist ${documents.every((doc) => doc.completeness === 'full') ? 'bestätigt' : 'nicht bestätigt'}.`,
    pending: true,
  };
}

async function documentReply(
  service,
  ctx,
  {
    p,
    envelope,
    caseId,
    situation,
    retrieval,
    asked = [],
    conversationReplyRequested = false,
    meta = ctx.meta,
    access,
    selectedCapabilities = [],
  }
) {
  if (!caseId) return null;
  ctx = Object.assign(Object.create(ctx), {
    meta: {
      ...meta,
      tenantId: p.tenantId,
      workbenchEvidenceAccess: access,
      workbenchEvidenceSources: null,
      workbenchSelectedCapabilities: selectedCapabilities.map((entry) =>
        typeof entry === 'string' ? entry : entry.capability
      ),
      workbenchEvidenceCaseId: caseId,
    },
  });
  const identity = documentIdentity(p, caseId);
  let attached = [];
  if (envelope.documents?.length)
    attached = await attachDocuments(service.store, identity, envelope.documents, {
      logger: service.logger,
    });
  const added = attached.filter((entry) => !entry.duplicate).length;
  const storageNote = added ? `${added} Dokument(e) als Fallgrundlage gespeichert.` : '';
  const documents = await loadDocuments(service.store, identity);
  if (!documents.length) return null;
  const question = envelope.userRequest;
  if (
    (conversationReplyRequested &&
      !isReviewRequest(question) &&
      !documentDraftRequested(question)) ||
    ['orientation', 'knowledge', 'assistance', 'filing'].includes(situation.conversationShape)
  ) {
    const reply = await require('./workbench-understanding').answer({
      situation,
      asked,
      tenantId: p.tenantId,
      message: question,
      retrieval: {
        evidence: documents.slice(0, 3).map((doc) => ({
          source: doc.name,
          retrievalSource: 'documents',
          value: doc.text.slice(0, 1200),
          metadata: { name: doc.name },
        })),
      },
      logger: service.logger,
    });
    reply.responseText = [reply.responseText, storageNote].filter(Boolean).join('\n\n');
    return { responseText: reply.responseText, conversationReply: reply };
  }
  const reviewRequested = isReviewRequest(question) || documentDraftRequested(question);
  if (!reviewRequested && !/\b(?:ergebnis|review|prüfung|pruefung)\b/iu.test(question)) {
    const table = documents.some((document) =>
      require('./workbench-document-question').documentTable(document.text)
    );
    const answer =
      (!table && storedPassage(documents, question)) ||
      (
        await require('./workbench-document-question').documentQuestion(documents, question, {
          tenantId: p.tenantId,
          logger: service.logger,
        })
      )?.responseText;
    if (answer) return { responseText: [answer, storageNote].filter(Boolean).join('\n\n') };
  }
  const passage = storedPassage(documents, envelope.userRequest);
  if (passage) return { responseText: passage };
  const key = reviewKey(p, envelope, caseId);
  const job = await readJob(service, key);
  const visible = jobScope(job, p, caseId, access) && jobMatchesDocuments(job, documents);
  if (jobScope(job, p, caseId, access) && !visible) {
    if (service.workbenchDocumentReviews?.has(key))
      return {
        responseText:
          'Die vorherige Dokumentprüfung läuft noch. Die neue Dokumentgrundlage ist gespeichert und wird im nächsten Turn erneut geprüft.',
        pending: true,
      };
    return launchReview(service, ctx, {
      key,
      p,
      caseId,
      documents,
      question:
        isReviewRequest(envelope.userRequest) || documentDraftRequested(envelope.userRequest)
          ? envelope.userRequest
          : job.question,
      situation,
      retrieval: null,
    });
  }
  if (visible && !added && !documentDraftRequested(envelope.userRequest)) {
    if (job.state === 'ready') {
      await service.conversationsDb.put({ ...job, state: 'delivered' });
      return { responseText: renderReview(job.result), result: job.result };
    }
    if (job.state === 'running') {
      if (!service.workbenchDocumentReviews?.has(key))
        return launchReview(service, ctx, {
          key,
          p,
          caseId,
          documents,
          question: job.question,
          situation,
          retrieval,
        });
      return {
        responseText:
          'Die Dokumentprüfung läuft noch. Das Ergebnis folgt im nächsten Turn; noch liegt kein vollständiges Urteil vor.',
        pending: true,
      };
    }
  }
  if (!isReviewRequest(envelope.userRequest) && !documentDraftRequested(envelope.userRequest))
    return storageNote ? { responseText: storageNote } : null;
  const options = reviewOptions();
  const maps = documents.reduce(
    (sum, document) => sum + documentSections(document.text, options.chunkChars).length,
    0
  );
  // Even a single provider request can consume the remaining HTTP budget. Run reviews
  // outside the turn consistently; this also avoids relying on guessed provider latency.
  if (maps > 0 && service.workbenchDocumentReviews?.has(key))
    return {
      responseText: 'Die Dokumentprüfung läuft bereits. Das Ergebnis folgt im nächsten Turn.',
      pending: true,
    };
  if (maps > 0)
    return launchReview(service, ctx, {
      key,
      p,
      caseId,
      documents,
      question: envelope.userRequest,
      situation,
      retrieval,
    });
  return null;
}

async function documentFollowup(service, { p, envelope, caseId, access }) {
  if (!caseId || envelope.documents?.length || documentDraftRequested(envelope.userRequest))
    return null;
  const documents = await loadDocuments(service.store, documentIdentity(p, caseId));
  if (!documents.length) return null;
  if (
    !isReviewRequest(envelope.userRequest) &&
    !/\b(?:ergebnis|review|prüfung|pruefung)\b/iu.test(envelope.userRequest)
  ) {
    const table = documents.some((document) =>
      require('./workbench-document-question').documentTable(document.text)
    );
    if (table)
      return require('./workbench-document-question').documentQuestion(
        documents,
        envelope.userRequest,
        { tenantId: p.tenantId, logger: service.logger }
      );
  }
  const passage = storedPassage(documents, envelope.userRequest);
  if (passage) return { responseText: passage };
  const job = await readJob(service, reviewKey(p, envelope, caseId));
  if (!job && !isReviewRequest(envelope.userRequest))
    return require('./workbench-document-question').documentQuestion(
      documents,
      envelope.userRequest,
      { tenantId: p.tenantId, logger: service.logger }
    );
  if (!jobScope(job, p, caseId, access) || !jobMatchesDocuments(job, documents)) return null;
  if (job.state === 'ready') {
    await service.conversationsDb.put({ ...job, state: 'delivered' });
    return { responseText: renderReview(job.result), result: job.result };
  }
  return job.state === 'running' && service.workbenchDocumentReviews?.has(job._id)
    ? {
        responseText:
          'Die Dokumentprüfung läuft noch. Das Ergebnis folgt im nächsten Turn; noch liegt kein vollständiges Urteil vor.',
        pending: true,
      }
    : null;
}

function cleanDocumentHistory(messages = []) {
  return messages.map((turn) => ({ ...turn, content: documentInput(turn.content).question }));
}

function documentResponseFields(reply, events) {
  return reply
    ? {
        documentReview: reply.result
          ? { status: reply.result.status, stats: reply.result.stats }
          : { status: reply.pending ? 'pending' : 'stored' },
        pendingEvents: (events.unacknowledged || events.pending || 0) + (reply.pending ? 1 : 0),
      }
    : {};
}

function documentAnswer(reply) {
  return {
    responseText: reply.responseText,
    draft: reply.result?.review?.draft || '',
    questions: [],
    evidence: [],
    evidenceTrace: {},
    answerAttempts: 0,
    answerStatus: reply.pending ? 'pending_review' : 'document_answer',
  };
}

async function documentFollowupResponse(
  service,
  { p, envelope, conversation, state, started, access, previousShape }
) {
  if (['orientation', 'knowledge', 'assistance', 'filing'].includes(previousShape)) return null;
  if (!state || state.disposition === 'discarded') return null;
  const reply = await documentFollowup(service, {
    p,
    envelope,
    caseId: conversation.cetCaseId,
    access,
  });
  if (!reply) return null;
  const events = await service.eventSummary(p, conversation.cetCaseId, {
    clientId: envelope.asyncDelivery?.clientId,
  });
  return {
    ...service.chatResponse(
      'answer',
      {
        cetCaseId: conversation.cetCaseId,
        caseStateVersion: state.caseStateVersion,
        responseText: reply.responseText,
      },
      events,
      null
    ),
    state: 'assistance',
    nonBinding: true,
    ...documentResponseFields(reply, events),
    latencyMs: Math.round(performance.now() - started),
  };
}

module.exports = {
  reviewCapabilities,
  initialDocumentSituation,
  documentFollowupResponse,
  documentResponseFields,
  documentAnswer,
  documentIdentity,
  documentReply,
  documentFollowup,
  renderReview,
  storedPassage,
  cleanDocumentHistory,
};
