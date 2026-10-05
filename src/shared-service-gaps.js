'use strict';

const { randomUUID } = require('node:crypto');
const { principal, deny } = require('./domain-router-policy');
const { getNeighbors } = require('./function-model');
const { resolveRecords } = require('./function-activation-records');
const { signalKey } = require('./signal-projection');
const { compareCanonicalStrings } = require('./canonical-order');

const cleanLabel = (value) =>
  String(value)
    .replace(/[\u0000-\u001f]/g, ' ')
    .slice(0, 180);

function gapPart(operationId, signals, limit) {
  const gaps = signals.filter((s) => s.state === 'gap' && s.context);
  if (!gaps.length) return null;
  const details = gaps.filter((s) => s.kind === 'finding');
  const rows = details.length ? details : gaps.filter((s) => s.kind !== 'count');
  const labels = [
    ...new Set(
      (rows.length ? rows : gaps).map((s) =>
        cleanLabel(s.kind === 'state' ? s.value || s.label : s.label)
      )
    ),
  ].sort(compareCanonicalStrings);
  return {
    operationId,
    labels: labels.slice(0, limit),
    contentHash: signalKey(
      gaps
        .map((s) => [s.signalId, s.label, s.value])
        .sort((a, b) => compareCanonicalStrings(a[0], b[0]))
    ),
    // Aggregate fields survive the removal of individual missing entries.
    sources: (gaps.some((s) => s.kind === 'count' || s.kind === 'state')
      ? gaps.filter((s) => s.kind === 'count' || s.kind === 'state')
      : gaps
    ).map((s) => s.signalId),
    signalRefs: gaps.map((s) => s.signalId).slice(0, limit),
  };
}

function closedPart(part, signals) {
  return (
    part.sources.length > 0 &&
    part.sources.every((id) => signals.some((s) => s.signalId === id && s.state === 'ok'))
  );
}

const methods = {
  async visibleGap(ctx, p, agent, gap) {
    const notices = this.broker.getLocalService('notices');
    try {
      return (
        !!notices &&
        (await notices.canSeeGap(ctx, p, {
          kind: 'gap',
          agentId: agent.agentId,
          functionId: agent.functionId,
          objectRef: gap.ref,
          contentHash: gap.contentHash,
        }))
      );
    } catch {
      return false;
    }
  },
  async gapRecipients(doc, agent) {
    const activation = this.broker.getLocalService('activation');
    const state = await activation?.readDocument(agent.tenantId);
    const related = new Set([
      agent.functionId,
      ...getNeighbors(agent.functionId, {
        model: this.model,
        overlay: state?.neighborCorrections || [],
        minWeight: activation?.settings.minWeight ?? 0,
      }).map((edge) => edge.functionId),
    ]);
    return [
      ...new Set(
        resolveRecords(doc.coverage, this.model)
          .filter(
            (row) => related.has(row.functionId) && row.score >= this.settings.coverageThreshold
          )
          .map((row) => row.actorId)
      ),
    ]
      .sort(compareCanonicalStrings)
      .slice(0, this.settings.maxCoverageRecords);
  },
  async flushGapFeedback(doc, agent, gap) {
    if (!gap.pendingFeedback) return;
    const resolved = resolveRecords([agent], this.model);
    if (resolved.length !== 1) return;
    const feedback = gap.pendingFeedback;
    if (!feedback.emitted) {
      await this.broker.emit('shared-agent.feedback.v1', {
        tenantId: agent.tenantId,
        agentId: agent.agentId,
        functionId: resolved[0].functionId,
        outcome: feedback.outcome,
        ref: feedback.ref,
        at: new Date(this.now()).toISOString(),
      });
      feedback.emitted = true;
      await this.save(doc);
    }
    await this.deliverJournal(agent, {
      entryId: `feedback-${feedback.ref}`,
      tenantId: agent.tenantId,
      agentId: agent.agentId,
      functionId: resolved[0].functionId,
      kind: 'decided',
      summary: `Gap list feedback: ${feedback.outcome}.`,
      refs: [],
      at: new Date(this.now()).toISOString(),
    });
    gap.pendingFeedback = null;
    await this.save(doc);
  },
  async publishGapNotice(doc, agent, gap) {
    if (!gap.pendingNotice || gap.state !== 'open' || gap.ignoredHash === gap.contentHash) return;
    await this.broker.emit('shared-agent.gaps.changed.v1', {
      tenantId: agent.tenantId,
      agentId: agent.agentId,
      functionId: agent.functionId,
      gapRef: gap.ref,
      contentHash: gap.contentHash,
      eventId: signalKey(gap.ref, gap.contentHash),
    });
    gap.pendingNotice = false;
    await this.save(doc);
  },
  async updateGapLists(doc, agent, observations, context) {
    if (!context || !observations.length) return;
    agent.gapLists ||= [];
    const contextKey = signalKey({ kind: context.kind, ref: context.ref });
    let gap = agent.gapLists.find((row) => row.contextKey === contextKey && row.state === 'open');
    for (const saved of agent.gapLists) await this.flushGapFeedback(doc, agent, saved);
    const parts = new Map((gap?.parts || []).map((part) => [part.operationId, part]));
    for (const { operationId, signals } of observations) {
      if (
        !signals.length ||
        !signals.every(
          (signal) => signal.context?.kind === context.kind && signal.context?.ref === context.ref
        )
      )
        continue;
      const part = gapPart(operationId, signals, this.settings.maxGapLabels);
      if (part) parts.set(operationId, part);
      else if (parts.has(operationId) && closedPart(parts.get(operationId), signals))
        parts.delete(operationId);
    }
    if (!gap && !parts.size) return;
    if (!gap) {
      // Never evict open work to make room. Completed associations are compacted.
      if (agent.gapLists.filter((row) => row.state === 'open').length >= this.settings.maxGapLists)
        return;
      agent.gapLists = agent.gapLists
        .filter((row) => row.state === 'open' || row.pendingFeedback)
        .slice(-(this.settings.maxGapLists - 1));
      gap = {
        ref: randomUUID(),
        contextKey,
        context: { kind: context.kind, ref: context.ref },
        state: 'open',
        parts: [],
        delivered: false,
        used: false,
        recipients: await this.gapRecipients(doc, agent),
      };
      agent.gapLists.push(gap);
    }
    const ordered = [...parts.values()].sort((a, b) =>
      compareCanonicalStrings(a.operationId, b.operationId)
    );
    const fingerprint = signalKey(ordered.map((part) => [part.operationId, part.contentHash]));
    if (fingerprint === gap.fingerprint) {
      const recipients = await this.gapRecipients(doc, agent);
      if (JSON.stringify(recipients) !== JSON.stringify(gap.recipients)) {
        // Reuse the content event identity: already notified people stay deduped,
        // newly qualifying people can receive the existing open work.
        if (recipients.some((actorId) => !gap.recipients.includes(actorId)))
          gap.pendingNotice = true;
        gap.recipients = recipients;
        await this.save(doc);
      }
      return this.publishGapNotice(doc, agent, gap);
    }
    const contentHash = signalKey(gap.ref, gap.contentHash || null, fingerprint);
    gap.fingerprint = fingerprint;
    gap.parts = ordered;
    gap.labels = [...new Set(ordered.flatMap((part) => part.labels))]
      .sort(compareCanonicalStrings)
      .slice(0, this.settings.maxGapLabels);
    gap.contentHash = contentHash;
    gap.ignoredHash = null;
    gap.completionRequested = false;
    gap.pendingNotice = parts.size > 0;
    gap.recipients = await this.gapRecipients(doc, agent);
    if (!parts.size) {
      gap.state = 'completed';
      if (gap.delivered && !gap.used) {
        gap.used = true;
        gap.pendingFeedback = { outcome: 'used', ref: gap.ref };
      }
    }
    await this.save(doc);
    await this.flushGapFeedback(doc, agent, gap);
    await this.publishGapNotice(doc, agent, gap);
  },
  async correctGap(ctx) {
    const p = principal(ctx, ctx.params);
    const doc = await this.readDocument(p.tenantId);
    doc.agents = this.resolvedAgents(doc.agents);
    const agent = doc.agents.find((row) =>
      row.gapLists?.some((gap) => gap.ref === ctx.params.gapRef)
    );
    const gap = agent?.gapLists.find((row) => row.ref === ctx.params.gapRef);
    // An identical ignore retry is harmless, but never accepts a stale confirmation.
    if (
      !gap ||
      agent.functionId !== ctx.params.functionId ||
      gap.contentHash !== ctx.params.contentHash ||
      !gap.recipients.includes(p.actorId)
    )
      deny('Gap list not accessible');
    await this.flushGapFeedback(doc, agent, gap);
    if (gap.ignoredHash === gap.contentHash && ctx.params.kind === 'gap_ignore')
      return { applied: true };
    if (!(await this.visibleGap(ctx, p, agent, gap))) deny('Gap list not visible');
    if (ctx.params.kind === 'gap_ignore') {
      gap.ignoredHash = gap.contentHash;
      gap.pendingNotice = false;
      gap.pendingFeedback = { outcome: 'rejected', ref: `${gap.ref}:ignored:${gap.contentHash}` };
    } else gap.completionRequested = true;
    await this.save(doc);
    await this.flushGapFeedback(doc, agent, gap);
    return { applied: true, state: gap.state, verificationPending: !!gap.completionRequested };
  },
};

module.exports = { gapPart, closedPart, methods };
