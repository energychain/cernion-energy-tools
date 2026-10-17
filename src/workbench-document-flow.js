'use strict';

const { createHash, randomUUID } = require('node:crypto');
const {
  documentInput,
  documentReference,
  isReviewRequest,
  documentDraftRequested,
} = require('./workbench-document-input');
const { attachDocuments, loadDocuments, documentSections } = require('./workbench-document');
const { reviewDocuments, reviewOptions, beforeDeadline } = require('./workbench-review');
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
      previous: require('./workbench-turn-scope').persistentSituation(situation),
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
    return { ...result, evidence, situation: understood };
  } catch (_error) {
    return { evidence: [], trace: [], situation: understood };
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
      result.reason && !/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/u.test(result.reason)
        ? result.reason
        : 'Nicht alle Abschnitte konnten geprüft werden. Die fehlenden Abschnitte sind unten genannt.'
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
  lines.push(
    ...(result.limitations || []).map((line) =>
      line.replace(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu, (code) =>
        code.includes('QUOTA') ? 'Modellengpass' : 'Prüfung derzeit nicht möglich'
      )
    )
  );
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
  if (Number.isFinite(result.stats?.documentChars))
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
    const job = await service.conversationsDb.get(key);
    if (job.state !== 'running') return job;
    const deadline = job.deadlineAt || job.expiresAt - 30 * 60 * 1000 + reviewOptions().timeoutMs;
    const expired = deadline <= Date.now();
    if (!expired && service.workbenchDocumentReviews?.has(key)) return job;
    return finishReview(
      service,
      job,
      failedReview(job, {
        type: expired ? 'WORKBENCH_REVIEW_TIMEOUT' : 'WORKBENCH_REVIEW_INTERRUPTED',
      })
    );
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

function reviewResultRequested(question) {
  return (
    /^(?:(?:was|wie)\s+(?:ist|lautet)\s+(?:das\s+)?)?(?:das\s+)?ergebnis(?:\s+bitte)?[.!?]?$/iu.test(
      String(question).trim()
    ) ||
    (/\b(?:review|prüfung|pruefung|dokumentprüfung|dokumentpruefung)\b/iu.test(question) &&
      /\b(?:ergebnis|stand|status|fertig|abgeschlossen|läuft|laeuft|weit)\b/iu.test(question))
  );
}

function failedReview(job, error) {
  const timeout = error.type === 'WORKBENCH_REVIEW_TIMEOUT';
  const interrupted = error.type === 'WORKBENCH_REVIEW_INTERRUPTED';
  return {
    status: timeout ? 'timeout' : 'failed',
    reason: timeout
      ? 'Die Dokumentprüfung wurde nach Ablauf ihres Zeitbudgets abgebrochen. Ein vollständiges Urteil liegt nicht vor.'
      : interrupted
        ? 'Die Dokumentprüfung wurde unterbrochen. Ein vollständiges Urteil liegt nicht vor.'
        : require('./workbench-llm-errors').quotaMessage(error) ||
          'Die Dokumentprüfung ist fehlgeschlagen. Ein vollständiges Urteil liegt nicht vor.',
    maps: [],
    criteria: [],
    stats: {
      documentChars: job.documentChars,
      mapCalls: 0,
      reduceCalls: 0,
      elapsedMs: Math.max(0, Date.now() - (job.startedAt || Date.now())),
    },
  };
}

async function finishReview(service, job, result) {
  const timedOut =
    result.status === 'timeout' ||
    result.gaps?.some((gap) => gap.reason === 'WORKBENCH_REVIEW_TIMEOUT');
  const settled = timedOut
    ? {
        ...result,
        status: 'timeout',
        reason: failedReview(job, { type: 'WORKBENCH_REVIEW_TIMEOUT' }).reason,
      }
    : result;
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await service.conversationsDb.get(job._id);
    if (latest.state !== 'running' || latest.runId !== job.runId) return latest;
    const next = {
      ...latest,
      state: settled.status === 'completed' ? 'ready' : 'failed',
      completedAt: Date.now(),
      result: settled,
    };
    try {
      const saved = await service.conversationsDb.put(next);
      return { ...next, _rev: saved.rev };
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }
}

async function launchReview(
  service,
  ctx,
  { key, p, caseId, documents, question, situation, retrieval }
) {
  const existing = await readJob(service, key);
  const options = reviewOptions();
  const started = performance.now();
  const deadline = started + options.timeoutMs;
  const job = {
    _id: key,
    ...(existing ? { _rev: existing._rev } : {}),
    type: 'workbench_document_review',
    tenantId: p.tenantId,
    actorId: p.actorId,
    caseId,
    state: 'running',
    startedAt: Date.now(),
    deadlineAt: Date.now() + options.timeoutMs,
    documentChars: documents.reduce((sum, doc) => sum + doc.text.length, 0),
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
    .then(() =>
      beforeDeadline(async () => {
        const evidence =
          retrieval || (await reviewRetrieval(service, ctx, documents, question, situation));
        // Preflight shares the job budget; a late provider response cannot start another phase.
        const remaining = Math.ceil(deadline - performance.now());
        if (remaining <= 0)
          throw Object.assign(new Error('Review timeout'), { type: 'WORKBENCH_REVIEW_TIMEOUT' });
        const latest = await readJob(service, key);
        if (latest?.runId !== job.runId || latest.state !== 'running')
          return failedReview(job, { type: 'WORKBENCH_REVIEW_INTERRUPTED' });
        return reviewDocuments(
          {
            documents,
            question,
            situation: evidence.situation || situation,
            retrieval: evidence,
            ctx: { meta: { tenantId: p.tenantId } },
            draftRequested: documentDraftRequested(question),
          },
          { ...options, timeoutMs: remaining }
        );
      }, deadline)
    )
    .then((result) => finishReview(service, job, result))
    .catch(async (error) => {
      require('./workbench-llm-errors').logLlmError(service.logger, 'review', error);
      return finishReview(service, job, failedReview(job, error));
    })
    .catch((error) => {
      service.logger.warn('Document review persistence unavailable', {
        type: error.type || error.name,
      });
    })
    .finally(() => {
      // Completion of an older run must not remove the replacement run's lifecycle handle.
      if (active.get(key) === task) active.delete(key);
    });
  active.set(key, task);
  // Keep shutdown inside the existing broker lifecycle, rather than leaving DB writes behind.
  return {
    responseText: `Ich prüfe ${documents.length} Dokument(e) mit ${documents.reduce((sum, doc) => sum + doc.text.length, 0)} Zeichen abschnittsweise: Aussagen, Annahmen, Zahlen, Zeitplan und Widersprüche sowie verfügbare Prüfmaßstäbe. Das Review läuft. Du kannst nach dem Stand der Prüfung fragen oder das Gespräch fortsetzen. Die Vollständigkeit des übermittelten Texts ist ${documents.every((doc) => doc.completeness === 'full') ? 'bestätigt' : 'nicht bestätigt'}.`,
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
  if (envelope.documentKnowledgeReceipt) return { responseText: envelope.documentKnowledgeReceipt };
  const documents = await loadDocuments(service.store, identity, {
    broker: service.broker,
    roles: p.roles,
  });
  if (!documents.length) return null;
  const question = envelope.userRequest;
  if (envelope.documents?.length) {
    const previousJob = await readJob(service, reviewKey(p, envelope, caseId));
    if (
      !isReviewRequest(question) &&
      !documentDraftRequested(question) &&
      jobScope(previousJob, p, caseId, access) &&
      !jobMatchesDocuments(previousJob, documents)
    )
      return {
        responseText:
          'Die neue Dokumentgrundlage ist gespeichert. Eine weitere Prüfung nutzt diesen Stand.',
        pending: previousJob.state === 'running',
      };
  }
  if (
    (situation.roleContextUpdated && situation.roleStatement?.roleOnly) ||
    situation.personAssessment?.applicable
  )
    return null;
  if (
    !isReviewRequest(question) &&
    !documentDraftRequested(question) &&
    situation.missingInformation?.some(
      (item) => (item.reason === 'purpose' || item.kind === 'role') && !item.answered
    )
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
  if (!reviewRequested && !reviewResultRequested(question)) {
    const table = documents.some((document) =>
      require('./workbench-document-question').documentTable(document.text)
    );
    const passage = !table && storedPassage(documents, question);
    const reply = passage
      ? { responseText: passage }
      : await require('./workbench-document-question').documentQuestion(documents, question, {
          tenantId: p.tenantId,
          logger: service.logger,
          internalContext: [situation.concern, situation.situation],
          conversationContext: situation.conversationContext,
          conversationPreferences: situation.conversationPreferences,
        });
    if (reply?.responseText)
      return {
        ...reply,
        responseText: [reply.responseText, storageNote].filter(Boolean).join('\n\n'),
      };
  }
  if (!reviewRequested && !reviewResultRequested(question)) return null;
  const passage = storedPassage(documents, envelope.userRequest);
  if (passage) return { responseText: passage };
  const key = reviewKey(p, envelope, caseId);
  const job = await readJob(service, key);
  const visible = jobScope(job, p, caseId, access) && jobMatchesDocuments(job, documents);
  if (jobScope(job, p, caseId, access) && !visible) {
    if (service.workbenchDocumentReviews?.has(key))
      return {
        responseText:
          'Die vorherige Dokumentprüfung läuft noch. Die neue Dokumentgrundlage ist gespeichert Eine weitere Prüfung nutzt diesen Stand.',
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
    if (['ready', 'failed'].includes(job.state)) {
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
          'Die Dokumentprüfung läuft noch. Noch liegt kein vollständiges Urteil vor; du kannst das Gespräch fortsetzen.',
        pending: true,
      };
    }
  }
  if (!isReviewRequest(envelope.userRequest) && !documentDraftRequested(envelope.userRequest))
    return storageNote ? { responseText: storageNote } : null;
  const maps = documents.reduce((sum, document) => sum + documentSections(document.text).length, 0);
  // Even a single provider request can consume the remaining HTTP budget. Run reviews
  // outside the turn consistently; this also avoids relying on guessed provider latency.
  if (maps > 0 && service.workbenchDocumentReviews?.has(key))
    return {
      responseText:
        'Die Dokumentprüfung läuft bereits. Du kannst nach dem Stand der Prüfung fragen oder das Gespräch fortsetzen.',
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
  const documents = await loadDocuments(service.store, documentIdentity(p, caseId), {
    broker: service.broker,
    roles: p.roles,
  });
  if (!documents.length) return null;
  const passage = storedPassage(documents, envelope.userRequest);
  if (passage) return { responseText: passage };
  if (!reviewResultRequested(envelope.userRequest)) return null;
  const job = await readJob(service, reviewKey(p, envelope, caseId));
  if (!jobScope(job, p, caseId, access) || !jobMatchesDocuments(job, documents)) return null;
  if (['ready', 'failed', 'delivered'].includes(job.state)) {
    if (job.state !== 'delivered')
      await service.conversationsDb.put({ ...job, state: 'delivered' });
    return { responseText: renderReview(job.result), result: job.result };
  }
  return job.state === 'running' && service.workbenchDocumentReviews?.has(job._id)
    ? {
        responseText:
          'Die Dokumentprüfung läuft noch. Noch liegt kein vollständiges Urteil vor; du kannst das Gespräch fortsetzen.',
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
    metadata: { degraded: false, ...reply.metadata },
  };
}

async function documentFollowupResponse(
  service,
  { p, envelope, conversation, state, started, access, previousShape }
) {
  if (
    ['orientation', 'knowledge', 'assistance', 'filing'].includes(previousShape) &&
    !reviewResultRequested(envelope.userRequest)
  )
    return null;
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
