'use strict';

const { resolveFunctions, normalizePhrase } = require('./function-resolver');
const { getFunctionModel } = require('./function-model');
const { principal } = require('./domain-router-policy');
const { reference } = require('./function-coverage');

// Recognition only. No model call, execution, or independent function matching.
function recognizeCorrection(message) {
  const text = String(message || '')
    .trim()
    .replace(/^(?:bitte|please)\s+/i, '');
  if (/^(?:mach das rückgängig|rückgängig|undo(?: that)?|revert that)[.!?\s]*$/i.test(text))
    return { type: 'undo' };
  if (/^(?:ja(?:,? richtig)?|richtig|bestätigt|bestätigen|yes|correct|confirm)[.!\s]*$/i.test(text))
    return { type: 'confirm' };
  if (/^(?:nein|abbrechen|no|cancel)[.!\s]*$/i.test(text)) return { type: 'cancel' };
  const gapReaction = text.match(
    /^(L-\d+|(?:die )?lücken(?:liste)?(?: für| zu)?\s+.+?)\s+(erledigt|ignorieren)[.!]*$/i
  );
  if (gapReaction)
    return {
      type: 'gap',
      identifier: text.match(/\bL-\d+\b/i)?.[0].toUpperCase(),
      description: gapReaction[1].replace(/^(?:die )?lücken(?:liste)?(?: für| zu)?\s+/i, ''),
      kind: gapReaction[2].toLowerCase() === 'ignorieren' ? 'gap_ignore' : 'gap_done',
    };
  const preferences = [
    [/^(?:keine hinweise mehr|no more notices|turn off notices)[.!\s]*$/i, 'off'],
    [/^(?:nur vorschläge|only proposals)[.!\s]*$/i, 'proposals_only'],
    [/^(?:alle hinweise|all notices)[.!\s]*$/i, 'all'],
  ];
  for (const [pattern, preference] of preferences)
    if (pattern.test(text)) return { type: 'preference', preference };
  if (
    /\b(?:v-\d+|vorschlag|proposal)\b/i.test(text) &&
    /annehmen|nehme.+an|nimm.+an|akzeptier|accept|approve|ist falsch|is wrong|ablehnen|lehn.+ab|reject/i.test(
      text
    )
  )
    return {
      type: 'proposal',
      identifier: text.match(/\bV-\d+\b/i)?.[0].toUpperCase(),
      description: text
        .replace(/^(?:accept|approve|reject|nimm|lehne)\s+/i, '')
        .replace(/^(?:den |the )?(?:vorschlag|proposal)(?: zum| zur| zu| about| for)?\s*/i, '')
        .replace(
          /\s*(?:nehme ich an|akzeptiere ich|ist falsch|is wrong|I accept|I reject|an|ab)[.!]*$/i,
          ''
        )
        .trim(),
      outcome: /ist falsch|is wrong|ablehnen|lehn.+ab|reject/i.test(text) ? 'rejected' : 'accepted',
    };
  if (
    /^(?:das hängt nicht zusammen|das gehört dazu|those are unrelated|these belong together)[.!\s]*$/i.test(
      text
    )
  )
    return {
      type: 'function',
      target: 'neighbor',
      correction: { weight: /nicht|unrelated/i.test(text) ? 0 : 1 },
      phrase: '',
      neighborPhrase: '',
    };
  if (
    /^(?:das macht bei uns niemand[,;]?\s*übernimm das|nobody handles this[,;]?\s*take over)[.!\s]*$/i.test(
      text
    )
  )
    return { type: 'function', target: 'activation', correction: { cet: true }, phrase: '' };
  const patterns = [
    [
      'coverage',
      { score: 1 },
      /^(?:ich übernehme\s*:?\s*(.+?)|das übernehme ich\s*[:–-]\s*(.+?)|(.+?) mache ab jetzt ich|(.+?) liegt jetzt bei mir)[.!]*$/i,
    ],
    [
      'coverage',
      { score: 1 },
      /^(?:ich kümmere mich (?:selbst|allein) um (.+?)|(.+?) übernehme ich(?: selbst)?|(?:leave|hand) (.+?) to me|I(?:'ll| will) take care of (.+?) myself)[.!]*$/i,
    ],
    [
      'activation',
      { cet: false },
      /^(?:(?:you|CET) (?:don't|do not) have to (?:worry about|take care of) (.+?)|für (.+?) brauchst du nichts zu tun|(.+?) ist nicht (?:deine|CETs) aufgabe)[.!]*$/i,
    ],
    [
      'agent',
      { kind: 'pin' },
      /^(?:nimm (.+?) in (?:dein|das) inventar auf|set (.+?) to inventory|put (.+?) on (?:the )?inventory)[.!]*$/i,
    ],
    [
      'coverage',
      { score: 1 },
      /^(?:das (?:mache|erledige|übernehme) ich (?:selbst|allein)|I(?:'ll| will) (?:handle|do|take care of) (?:this|that) myself)\s*[:–-]\s*(.+?)[.!]*$/i,
    ],
    [
      'activation',
      { cet: false },
      /^(?:darum (?:musst|brauchst) du dich nicht (?:mehr )?(?:zu )?kümmern|(?:you|CET) (?:need not|don't need to|do not need to|shouldn't) (?:handle|take care of) (?:this|that))\s*[:–-]\s*(.+?)[.!]*$/i,
    ],
    [
      'agent',
      { kind: 'pin' },
      /^(?:nimm (.+?) (?:ins|in das) inventar auf|setze (.+?) (?:auf|ins) inventar|(?:put|place|set) (.+?) (?:in|into|on) (?:the )?inventory|add (.+?) to (?:the )?inventory)[.!]*$/i,
    ],
    [
      'coverage',
      { score: 1 },
      /^(?:für (.+?) bin ich (?:selbst )?zuständig|(.+?) erledige ich selbst|I am responsible for (.+?))[.!]*$/i,
    ],
    [
      'activation',
      { cet: false },
      /^(?:lass (.+?) bitte in Ruhe|du brauchst dich nicht (?:mehr )?um (.+?) zu kümmern|don't (?:handle|take care of) (.+?))[.!]*$/i,
    ],
    [
      'activation',
      { cet: true },
      /^(?:kümmer(?:e)? dich (?:bitte )?um (.+?)|CET soll (.+?) übernehmen|can you take care of (.+?))[.!?]*$/i,
    ],
    [
      'coverage',
      { score: 1 },
      /^(?:das mache ich selbst|ich (?:mache|übernehme|erledige) (.+?) (?:selbst|allein)|I (?:handle|do|take care of) (.+?) myself)(?:[.!]|$)/i,
    ],
    [
      'coverage',
      { score: 0 },
      /^(?:damit habe ich nichts zu tun|(?:mit |für )?(.+?) (?:habe ich nichts zu tun|bin ich nicht zuständig)|I (?:have nothing to do with|am not responsible for) (.+?))[.!]*$/i,
    ],
    [
      'activation',
      { cet: false },
      /^(?:darum musst du dich nicht kümmern|(?:um )?(.+?) (?:musst du dich nicht kümmern|soll CET sich nicht (?:mehr )?kümmern)|(?:you|CET) (?:should not|don't|do not|no longer need to) (?:handle|take care of) (.+?))[.!]*$/i,
    ],
    [
      'activation',
      { cet: false },
      /^(?:kümmere dich nicht (?:mehr )?um|stop (?:handling|working on)) (.+?)[.!]*$/i,
    ],
    [
      'activation',
      { cet: true },
      /^(?:übernimm(?: das)?|take over|(?:please )?handle)\s*(.*?)[.!]*$/i,
    ],
    ['agent', { kind: 'retain' }, /^(?:behalte (.+?) bei|(?:keep|retain) (.+?))[.!]*$/i],
    [
      'agent',
      { kind: 'unretain' },
      /^(?:behalte (.+?) nicht (?:mehr )?bei|(?:unretain|stop retaining) (.+?))[.!]*$/i,
    ],
    [
      'agent',
      { kind: 'pin' },
      /^(?:markiere (.+?) als inventar|(?:pin|add to inventory) (.+?))[.!]*$/i,
    ],
    [
      'agent',
      { kind: 'unpin' },
      /^(?:entferne (.+?) aus dem inventar|(?:unpin|remove from inventory) (.+?))[.!]*$/i,
    ],
  ];
  const neighbor = text.match(
    /^(.+?) (?:hängt nicht mit|gehört zu|is not related to|is related to) (.+?)(?: zusammen)?[.!]*$/i
  );
  if (neighbor)
    return {
      type: 'function',
      target: 'neighbor',
      correction: { weight: /nicht|not/i.test(text) ? 0 : 1 },
      phrase: neighbor[1],
      neighborPhrase: neighbor[2],
    };
  for (const [target, correction, pattern] of patterns) {
    const match = text.match(pattern);
    if (match)
      return {
        type: 'function',
        target,
        correction,
        phrase: match.slice(1).find(Boolean) || '',
      };
  }
  return null;
}
function isCorrectionTurn(message) {
  return !!recognizeCorrection(message);
}
function confirmation(pending) {
  const c = pending.correction;
  const meanings = {
    retain: 'beibehalten',
    unretain: 'nicht mehr beibehalten',
    pin: 'als Inventar markieren',
    unpin: 'aus dem Inventar entfernen',
  };
  let effect;
  if (pending.type === 'proposal')
    effect = `Vorschlag „${pending.label}“ ${pending.outcome === 'accepted' ? 'annehmen' : 'als falsch ablehnen'}`;
  else if (pending.type === 'gap')
    effect = `Lückenliste „${pending.label}“ ${pending.kind === 'gap_ignore' ? 'bis zur Inhaltsänderung ignorieren' : 'bei der nächsten Beobachtung auf Erledigung prüfen'}`;
  else if (pending.type === 'preference')
    effect = `Hinweis-Präferenz auf ${pending.preference} setzen`;
  else if (pending.type === 'undo') effect = `Korrektur für „${pending.label}“ rückgängig machen`;
  else if (pending.target === 'coverage')
    effect = `deine Abdeckung für „${pending.label}“ auf ${c.score === 1 ? 'selbst zuständig' : 'nicht zuständig'} setzen`;
  else if (pending.target === 'activation')
    effect = `CET soll sich ${c.cet ? '' : 'nicht mehr '}um „${pending.label}“ kümmern`;
  else if (pending.target === 'neighbor')
    effect = `„${pending.label}“ und „${pending.neighborLabel}“ ${c.weight ? 'zusammengehörig' : 'nicht zusammengehörig'} behandeln`;
  else effect = `„${pending.label}“ ${meanings[c.kind]}`;
  return `Ich verstehe: ${effect} – richtig? Bitte antworte mit Ja oder Nein.`;
}
// Contract seam for #723. Absence fails closed: never manufacture V identifiers.
async function resolveNoticeRef(ctx, identifier, tenantId) {
  try {
    return await ctx.call('notices.resolveRef', {
      tenantId,
      actorId: principal(ctx).actorId,
      ref: identifier,
    });
  } catch (error) {
    if (error.type === 'SERVICE_NOT_FOUND' || error.type === 'SERVICE_NOT_AVAILABLE') return null;
    throw error;
  }
}
async function handleCorrectionTurn(
  ctx,
  envelope,
  store,
  { model = getFunctionModel(), allowUnmatchedConfirmation = false } = {}
) {
  const p = principal(ctx, ctx.params);
  const memoryId = `correction-conversation-${reference(p.actorId, envelope.channel, envelope.conversationId)}`;
  const saved = await store.getTurnMemory({ tenantId: p.tenantId, caseId: memoryId });
  const memory = saved?.memory || {};
  let intent = recognizeCorrection(envelope.userRequest);
  if (!intent && memory.pending?.candidates) {
    const selected = resolveFunctions(envelope.userRequest, { model });
    if (
      selected.status === 'resolved' &&
      (!memory.pending.candidates.length ||
        memory.pending.candidates.some(
          (candidate) => candidate.functionId === selected.matches[0].functionId
        ))
    ) {
      intent = {
        ...memory.pending,
        candidates: undefined,
        ...(memory.pending.awaitingNeighbor
          ? { neighborPhrase: selected.matches[0].label }
          : { phrase: selected.matches[0].label }),
      };
    }
  }
  const save = () =>
    store.saveTurnMemory({ tenantId: p.tenantId, actorId: p.actorId, caseId: memoryId, memory });
  const reply = (responseText) => ({ mode: 'correction', responseText });
  if (!intent) {
    if (memory.pending) {
      delete memory.pending;
      await save();
    }
    return null;
  }
  if (intent.type === 'cancel') {
    delete memory.pending;
    await save();
    return reply('Keine Korrektur übernommen.');
  }
  if (intent.type === 'confirm') {
    const pending = memory.pending;
    if (!pending && allowUnmatchedConfirmation) return null;
    if (!pending || pending.candidates)
      return reply('Es liegt keine eindeutig aufgelöste Korrektur zur Bestätigung vor.');
    if (
      pending.target === 'agent' &&
      ['pin', 'unpin'].includes(pending.correction?.kind) &&
      !p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role))
    ) {
      const responseText = 'Das kann nur eine Administratorin bzw. ein Administrator festlegen.';
      await ctx.call('journal.append', {
        tenantId: p.tenantId,
        functionId: pending.correction.functionId,
        kind: 'decided',
        summary: `Inventarkorrektur abgelehnt: ${responseText}`,
        refs: [],
      });
      delete memory.pending;
      await save();
      return reply(responseText);
    }
    let result;
    if (pending.type === 'proposal')
      result = await ctx.call('shared-service-agent.resolveProposal', {
        tenantId: p.tenantId,
        ref: pending.ref,
        outcome: pending.outcome,
      });
    else if (pending.type === 'gap')
      result = await ctx.call('shared-service-learning.confirm', {
        tenantId: p.tenantId,
        target: 'gap',
        correctionId: pending.correctionId,
        correction: {
          functionId: pending.functionId,
          gapRef: pending.ref,
          contentHash: pending.contentHash,
          kind: pending.kind,
        },
      });
    else if (pending.type === 'preference')
      result = await ctx.call('notices.setPreference', {
        tenantId: p.tenantId,
        actorId: p.actorId,
        preference: pending.preference,
      });
    else if (pending.type === 'undo')
      result = await ctx.call('shared-service-learning.undo', {
        tenantId: p.tenantId,
        correctionId: pending.correctionId,
      });
    else
      result = await ctx.call('shared-service-learning.confirm', {
        tenantId: p.tenantId,
        target: pending.target,
        correction: pending.correction,
        correctionId: pending.correctionId,
      });
    if (result.correctionId && !['undo', 'gap'].includes(pending.type))
      memory.lastCorrection = { ...pending, correctionId: result.correctionId };
    if (pending.type === 'undo') delete memory.lastCorrection;
    delete memory.pending;
    await save();
    return reply(
      pending.type === 'undo' ? 'Korrektur rückgängig gemacht.' : 'Bestätigt und übernommen.'
    );
  }
  if (intent.type === 'undo') {
    if (!memory.lastCorrection)
      return reply('In diesem Gespräch liegt keine rücknehmbare Korrektur vor.');
    memory.pending = { ...memory.lastCorrection, type: 'undo' };
  } else if (intent.type === 'proposal') {
    const proposals = await ctx.call('shared-service-agent.proposals', { tenantId: p.tenantId });
    const notice = intent.identifier
      ? await resolveNoticeRef(ctx, intent.identifier, p.tenantId)
      : null;
    const matches = intent.identifier
      ? proposals.filter(
          (item) =>
            item.ref ===
            (notice?.proposalRef || (notice?.kind === 'proposal' ? notice.objectRef : null))
        )
      : proposals.filter((item) =>
          normalizePhrase(item.summary).includes(normalizePhrase(intent.description))
        );
    if (matches.length !== 1) {
      delete memory.pending;
      await save();
      return reply(
        'Welchen sichtbaren Vorschlag meinst du? Bitte nenne seine eindeutige Beschreibung oder Kennung.'
      );
    }
    memory.pending = { ...intent, ref: matches[0].ref, label: matches[0].summary };
  } else if (intent.type === 'gap') {
    const gaps = await ctx.call('shared-service-agent.gapLists', { tenantId: p.tenantId });
    const notice = intent.identifier
      ? await resolveNoticeRef(ctx, intent.identifier, p.tenantId)
      : null;
    let matches = intent.identifier
      ? gaps.filter((item) => notice?.kind === 'gap' && item.ref === notice.objectRef)
      : gaps.filter((item) =>
          normalizePhrase(item.summary).includes(normalizePhrase(intent.description))
        );
    if (!intent.identifier && !matches.length) {
      const resolution = resolveFunctions(intent.description, { model });
      if (resolution.status === 'resolved')
        matches = gaps.filter((item) => item.functionId === resolution.matches[0].functionId);
    }
    if (matches.length !== 1) {
      delete memory.pending;
      await save();
      return reply(
        'Welche sichtbare Lückenliste meinst du? Bitte nenne ihre eindeutige Beschreibung oder Kennung.'
      );
    }
    memory.pending = {
      ...intent,
      ...matches[0],
      label: matches[0].summary,
      correctionId: require('node:crypto').randomUUID(),
    };
  } else if (intent.type === 'preference') memory.pending = intent;
  else {
    const phrase = intent.phrase || memory.lastFunctionLabel;
    if (!phrase) {
      memory.pending = { ...intent, candidates: [] };
      await save();
      return reply('Welche Funktion meinst du? Bitte nenne ihre Bezeichnung.');
    }
    const resolution = resolveFunctions(phrase, { model });
    if (resolution.status !== 'resolved') {
      memory.pending = { ...intent, candidates: resolution.matches };
      await save();
      return reply(
        `Welche Funktion meinst du? ${resolution.matches
          .slice(0, 5)
          .map((item) => item.label)
          .join('; ')}. Bitte wiederhole die Korrektur mit der eindeutigen Bezeichnung.`
      );
    }
    const fn = resolution.matches[0];
    memory.pending = {
      ...intent,
      label: fn.label,
      correctionId: require('node:crypto').randomUUID(),
      correction: { ...intent.correction, functionId: fn.functionId },
    };
    if (intent.target === 'neighbor') {
      const neighbor = resolveFunctions(intent.neighborPhrase, { model });
      if (neighbor.status !== 'resolved' || neighbor.matches[0].functionId === fn.functionId) {
        memory.pending = {
          ...intent,
          phrase: fn.label,
          awaitingNeighbor: true,
          candidates: neighbor.status === 'resolved' ? [] : neighbor.matches,
        };
        await save();
        return reply(
          `Welche zweite Funktion meinst du? ${neighbor.matches
            .slice(0, 5)
            .map((item) => item.label)
            .join('; ')}.`
        );
      }
      memory.pending.correction.neighborId = neighbor.matches[0].functionId;
      memory.pending.neighborLabel = neighbor.matches[0].label;
    }
    memory.lastFunctionLabel = fn.label;
  }
  await save();
  return reply(confirmation(memory.pending));
}
module.exports = { recognizeCorrection, isCorrectionTurn, handleCorrectionTurn, resolveNoticeRef };
