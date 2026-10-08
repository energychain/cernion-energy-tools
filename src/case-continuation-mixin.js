'use strict';

const { principal, deny } = require('./domain-router-policy');
const { normalizeIdentifiers, rawContentAllowed } = require('./case-linking');
const { sameStrongSubject, openCase } = require('./case-continuation');
const { randomUUID } = require('node:crypto');

module.exports = {
  actions: {
    'cases.continuationCandidates': {
      visibility: 'protected',
      params: { identifiers: { type: 'array', max: 20, items: 'object' } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const types = this.casePolicy(p).identifierTypes;
        const identifiers = normalizeIdentifiers(ctx.params.identifiers, types);
        const states = (await this.visibleStates(p))
          .filter(
            (state) =>
              openCase(state) && sameStrongSubject(identifiers, state.typedIdentifiers, types)
          )
          .sort(
            (a, b) =>
              String(b.updatedAt).localeCompare(String(a.updatedAt)) ||
              a.cetCaseId.localeCompare(b.cetCaseId)
          );
        const items = [];
        for (const state of states)
          items.push({
            ...(await this.readCaseSummary(p, state)),
            own: state.actorId === p.actorId,
            canContinue: rawContentAllowed(p, state),
            updatedAt: state.updatedAt,
          });
        return { items };
      },
    },
    'cases.mergeConfirmed': {
      visibility: 'protected',
      params: {
        cetCaseId: 'string',
        sourceCaseIds: { type: 'array', min: 1, max: 20, items: 'string' },
        confirmed: { type: 'boolean' },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        if (ctx.params.confirmed !== true) deny('Explicit merge confirmation required');
        const target = await this.loadCase(p, ctx.params.cetCaseId);
        if (!openCase(target)) deny('Open case required');
        const types = this.casePolicy(p).identifierTypes;
        const sources = [];
        for (const id of new Set(ctx.params.sourceCaseIds)) {
          const source = await this.loadCase(p, id);
          if (source.mergedInto === target.cetCaseId) continue;
          if (
            id === target.cetCaseId ||
            !openCase(source) ||
            !sameStrongSubject(target.typedIdentifiers, source.typedIdentifiers, types, true)
          )
            deny('Only identical open cases in the authenticated tenant can be merged');
          sources.push(source);
        }
        for (const source of sources) {
          // Retain the complete source as evidence; never delete its document or journal.
          const entryId = randomUUID();
          await this.auditCaseAccess(p, target, 'corrected', entryId, source.cetCaseId, {
            decision: 'merge_confirmed',
          });
          target.mergedCases = [
            ...(target.mergedCases || []).filter((item) => item.cetCaseId !== source.cetCaseId),
            { cetCaseId: source.cetCaseId, snapshot: source, entryId },
          ];
          target.sensitivityFlags = [
            ...new Set([...target.sensitivityFlags, ...source.sensitivityFlags]),
          ];
          target.caseStateVersion++;
          await this.saveState(p, target);
          source.mergedInto = target.cetCaseId;
          source.caseStateVersion++;
          await this.saveState(p, source);
        }
        return {
          merged: sources.map((source) => source.cetCaseId),
          cetCaseId: target.cetCaseId,
          caseStateVersion: target.caseStateVersion,
        };
      },
    },
  },
};
