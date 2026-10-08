'use strict';

const { randomUUID } = require('node:crypto');
const { Errors } = require('moleculer');
const { principal, authorize, deny } = require('./domain-router-policy');
const { caseSummary, tenantCasePolicy, identifierQueryMatches } = require('./case-linking');
const { resolvedTouches, project, reference } = require('./function-coverage');
const modelApi = require('./function-model');

module.exports = {
  actions: {
    'cases.searchIdentifiers': {
      visibility: 'protected',
      params: { query: { type: 'string', min: 1, max: 8000 } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const types = this.casePolicy(p).identifierTypes;
        const items = [];
        for (const state of await this.visibleStates(p)) {
          if (identifierQueryMatches(state, ctx.params.query, types))
            items.push(await this.readCaseSummary(p, state));
        }
        return { items };
      },
    },
    'cases.correctLink': {
      visibility: 'protected',
      params: {
        cetCaseId: 'string',
        targetCaseId: { type: 'string', optional: true },
        decision: { type: 'enum', values: ['confirmed', 'rejected', 'undo'] },
        caseStateVersion: { type: 'number', integer: true },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadCase(p, ctx.params.cetCaseId);
        if (state.actorId !== p.actorId) deny('Only the case owner can correct links');
        if (state.caseStateVersion !== ctx.params.caseStateVersion)
          throw new Errors.MoleculerClientError('Case version conflict', 409);
        const undo = ctx.params.decision === 'undo';
        const history = state.caseLinkCorrections || [];
        const previous = history.findLast(
          (item) =>
            item.actorId === p.actorId &&
            item.decision !== 'undo' &&
            !history.some((entry) => entry.undoOf === item.entryId)
        );
        if (undo && !previous)
          throw new Errors.MoleculerClientError('No case link correction to undo', 422);
        const targetCaseId = undo ? previous.targetCaseId : ctx.params.targetCaseId;
        const target = await this.loadCase(p, targetCaseId, { summaryOnly: true });
        const current = state.relatedCases.find((item) => item.cetCaseId === targetCaseId);
        const entry = {
          entryId: randomUUID(),
          kind: 'corrected',
          actorId: p.actorId,
          targetCaseId,
          decision: ctx.params.decision,
          previous: current || null,
          ...(undo ? { undoOf: previous.entryId } : {}),
          at: new Date().toISOString(),
        };
        await this.auditCaseAccess(p, state, 'corrected', entry.entryId, target.cetCaseId, {
          decision: entry.decision,
          ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
        });
        state.relatedCases = state.relatedCases.filter((item) => item.cetCaseId !== targetCaseId);
        const replacement = undo
          ? previous.previous
          : {
              cetCaseId: targetCaseId,
              relationshipType: 'same_subject',
              decision: ctx.params.decision,
              confidence: ctx.params.decision === 'confirmed' ? 1 : 0,
              reason: 'person_correction',
            };
        if (replacement) state.relatedCases.push(replacement);
        state.caseLinkCorrections = [...history, entry];
        state.caseStateVersion++;
        await this.saveState(p, state);
        return {
          corrected: true,
          correctionId: entry.entryId,
          caseStateVersion: state.caseStateVersion,
        };
      },
    },
  },
  methods: {
    casePolicy(p) {
      return tenantCasePolicy(p.tenantId, this.settings.tenantRegistryFile);
    },
    async resolveCaseTeam(p) {
      // Coverage adds a team relation, never roles or sensitivity clearance.
      const coverage = this.broker.getLocalService('function-coverage');
      p.caseVisibility = this.casePolicy(p).caseVisibility;
      p.teamActorIds = [];
      if (!coverage) return;
      const model = coverage.settings.model || modelApi.getFunctionModel();
      const groups = new Map();
      for (const doc of resolvedTouches(await coverage.documents(p.tenantId), model)) {
        const now = coverage.settings.clock();
        if (doc.expiresAt <= now || doc.at > now) continue;
        const key = reference(doc.actorId, doc.functionId);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(doc);
      }
      const rows = [...groups.values()]
        .map((docs) => project(docs, coverage.settings.clock(), coverage.config))
        .filter((row) => row.score >= 0.5);
      const functions = new Set(
        rows.filter((row) => row.actorId === p.actorId).map((row) => row.functionId)
      );
      p.teamActorIds = rows
        .filter((row) => functions.has(row.functionId))
        .map((row) => row.actorId);
    },
    async auditCaseAccess(
      p,
      state,
      kind = 'observed',
      entryId = randomUUID(),
      targetCaseId,
      correction
    ) {
      // The existing case event database is the journal for cases without a
      // resolved function. Audit persistence must succeed before exposing content.
      await this.eventsDb.put({
        _id: `case-audit:${entryId}`,
        entryId,
        tenantId: p.tenantId,
        actorId: p.actorId,
        cetCaseId: state.cetCaseId,
        ...(targetCaseId ? { targetCaseId } : {}),
        ...(correction ? { correction } : {}),
        kind,
        summary: kind === 'corrected' ? 'Fallverknüpfung korrigiert.' : 'Fremden Fall gelesen.',
        at: new Date().toISOString(),
      });
    },
    async readCaseSummary(p, state) {
      authorize(p, state);
      if (state.actorId !== p.actorId) await this.auditCaseAccess(p, state);
      return caseSummary(state);
    },
  },
};
