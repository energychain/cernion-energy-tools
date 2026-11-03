'use strict';

// Role proposals (#1019 A1–A3): coverage and stated responsibilities become graded role rows per
// function; people confirm or correct their own row in the chat; a fully answered proposal becomes
// a VDMI matrix. Coverage stays the signal, VDMI the record. Roles never grant access.
const { createHash, randomUUID } = require('node:crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const signals = require('../src/role-signals');

const NOMINATE_MIN = 0.5;
const ASK_COOLDOWN_MS = 24 * 3600 * 1000;
const MAX_ROWS = 12;
const MAX_EVIDENCE = 10;

const docId = (tenantId, functionId) =>
  `rp:${encodeURIComponent(tenantId)}:${encodeURIComponent(functionId)}`;
const rowKey = (actorRef) => `${actorRef.actorType}:${actorRef.actorId}`;
const admin = (p) => {
  if (!p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role)))
    deny('Admin role required');
};

// Presenter contract (#1058): the admin list and the own rows share one allowlisted scalar
// vocabulary. Stored arrays become counts or joined labels; actor ids, evidence refs, the answer
// basis, conversation ids and document ids never leave the service. Order is presentation only.
const PRESENTER = {
  contract: 'role_proposal_presenter_contract',
  safety: 'protected_read_only_role_proposal_projection',
  notice:
    'Gelernte Rollen sind beratende organisatorische Hinweise – keine Rechtevergabe, keine Bewertung von Personen und keine Prozessfreigabe.',
};
const MAX_PRESENTED = 200;
const ROLE_ORDER = ['V', 'D', 'M', 'I'];
const ROLE_DISPLAY = {
  V: 'V = Verantwortlich',
  D: 'D = Durchführend',
  M: 'M = Mitwirkend',
  I: 'I = Informiert',
};
const ORIGIN_LABEL = {
  coverage: 'Beobachtete Abdeckung',
  knowledge_answer: 'Genannte Zuständigkeit',
};
const ANSWERED = ['confirmed', 'corrected', 'rejected'];
const bounded = (value, max) => String(value ?? '').slice(0, max);
const roleIndex = (role) => (ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : 4);
const confidenceBand = (value) =>
  value >= 0.75 ? 'high' : value >= NOMINATE_MIN ? 'medium' : 'low';
// Tie-break for rows with the same display label; never returned.
const subjectKey = (actorRef) =>
  createHash('sha256').update(`${actorRef.actorType}:${actorRef.actorId}`).digest('hex');
// Positive follow-up: what enables the next human review of this row (no bare negative verdict).
const rowFollowUp = (row, self) => {
  const verdict = row.confirmation?.verdict;
  if (!(row.evidence || []).length && !(row.origins || []).length)
    return {
      positiveFollowUp:
        'Ein belegter Hinweis (beobachtete Abdeckung oder genannte Zuständigkeit) ermöglicht die nächste Prüfung.',
      nextSafeGate: 'role_bearing_evidence',
    };
  if (verdict === 'pending')
    return {
      positiveFollowUp: self
        ? 'Ihre eigene Rückmeldung im Chat ordnet diese Rolle ein.'
        : 'Die Rückmeldung der eingetragenen Person im Chat ordnet diese Rolle ein.',
      nextSafeGate: 'own_confirmation_in_chat',
    };
  if (verdict === 'stated')
    return {
      positiveFollowUp:
        'Genannte Zuständigkeit; die Bestätigung einer Person mit dieser Rolle macht sie verlässlich.',
      nextSafeGate: 'human_review_of_stated_responsibility',
    };
  if (verdict === 'rejected')
    return {
      positiveFollowUp: 'Weitere belegte Hinweise zur Rolle ermöglichen die nächste Prüfung.',
      nextSafeGate: 'role_bearing_evidence',
    };
  return {
    positiveFollowUp:
      'Selbst eingeordnet; eine erneute Rückmeldung der Person kann die Rolle ändern.',
    nextSafeGate: 'none_open',
  };
};
const proposalFollowUp = (doc, pendingCount) => {
  if (doc.state === 'confirmed')
    return doc.vdmiMatrixId
      ? {
          positiveFollowUp:
            'Als Ad-hoc-VDMI-Matrix festgehalten; die Übernahme als Muster bleibt eine menschliche Entscheidung.',
          nextSafeGate: 'human_template_nomination',
        }
      : {
          positiveFollowUp:
            'Bestätigt; das Festhalten als VDMI-Matrix ermöglicht die Übernahme als Muster.',
          nextSafeGate: 'vdmi_record_review',
        };
  if (pendingCount)
    return {
      positiveFollowUp: `${pendingCount} offene Rückmeldung(en) der eingetragenen Personen schließen den Vorschlag ab.`,
      nextSafeGate: 'own_confirmation_in_chat',
    };
  if (doc.state === 'nominated')
    return {
      positiveFollowUp: 'Eine bestätigte oder genannte V- oder D-Rolle schließt den Vorschlag ab.',
      nextSafeGate: 'accountable_or_performing_role',
    };
  return {
    positiveFollowUp:
      'Mehr beobachtete Abdeckung oder eine genannte Zuständigkeit macht daraus einen Vorschlag zur Rückfrage.',
    nextSafeGate: 'role_bearing_evidence',
  };
};

module.exports = {
  name: 'role-proposals',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'ROLE_PROPOSALS_DB_PATH',
      defaultDbPath: './data/role-proposals',
    }),
  ],
  actions: {
    // Protected presenter reads (#1058): side-effect free; tenant, admin and own-row scope stay
    // server-owned. A row is { proposalId, functionId, label, state, vdmiLinked, rowOrdinal,
    // actorDisplayLabel, actorDisplayStatus (self|stated_label|redacted), actorType, role,
    // roleLabel, confidenceBand (high|medium|low), originLabel, originCount, confirmationVerdict,
    // confirmationAt, evidenceCount, positiveFollowUp, nextSafeGate }. Confirmed and vdmiLinked
    // are lifecycle readback only and grant nothing.
    list: {
      rest: 'GET /',
      openapi: {
        summary: 'Role proposals per function with confidence and confirmation (admin)',
        description:
          'Protected read-only presenter (role_proposal_presenter_contract, tenant admin only): { contract, safety, scope: "tenant_admin", notice, proposals[], rows[] }, all scalar. A proposal is { proposalId, functionId, label, state, rowCount, pendingCount, answeredCount, statedCount, vdmiLinked, vdmiMatrixId, positiveFollowUp, nextSafeGate }; rows use the same row vocabulary as /mine. No actor ids, evidence refs, answer basis or conversation ids. Proposals are ordered by label and functionId, rows by V/D/M/I and display label – presentation only, never a ranking. Learned roles are advisory and grant no access rights.',
        tags: ['Role proposals'],
        parameters: [{ in: 'query', name: 'state', schema: { type: 'string' } }],
      },
      params: { state: { type: 'string', optional: true, max: 40 } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        admin(p);
        const docs = this.presentationOrder(
          (await this.proposals(p.tenantId)).filter(
            (doc) => !ctx.params.state || doc.state === ctx.params.state
          )
        );
        return {
          ...PRESENTER,
          scope: 'tenant_admin',
          proposals: docs.map((doc) => this.presentProposal(doc)),
          rows: docs.flatMap((doc) => this.presentRows(doc, doc.rows, p)),
        };
      },
    },
    // Own rows only: "wofür bin ich eingetragen" without seeing other people's rows.
    mine: {
      rest: 'GET /mine',
      openapi: {
        summary: 'Role rows of the calling person',
        description:
          'Protected read-only presenter (role_proposal_presenter_contract): { contract, safety, scope: "own_rows", notice, rows[] } with the same scalar row vocabulary as the admin list, filtered server-side to the authenticated person. Learned roles are advisory and grant no access rights.',
        tags: ['Role proposals'],
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const own = (row) =>
          row.actorRef.actorType === 'user' && row.actorRef.actorId === p.actorId;
        return {
          ...PRESENTER,
          scope: 'own_rows',
          rows: this.presentationOrder(await this.proposals(p.tenantId)).flatMap((doc) =>
            this.presentRows(doc, doc.rows.filter(own), p)
          ),
        };
      },
    },
    // Internal: refresh from coverage for the given functions (or all covered ones).
    refresh: {
      visibility: 'protected',
      params: { functionIds: { type: 'array', items: 'string', optional: true, max: 50 } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        return this.refresh(p.tenantId, ctx.params.functionIds);
      },
    },
    // Internal: the next own row of the calling person to confirm, as one inline question.
    selectAsk: {
      visibility: 'protected',
      params: {
        conversationId: { type: 'string', max: 300 },
        functionIds: { type: 'array', items: 'string', optional: true, default: [] },
        register: { type: 'string', optional: true, max: 10 },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        await this.refresh(
          p.tenantId,
          ctx.params.functionIds.length ? ctx.params.functionIds : null,
          {
            actorId: p.actorId,
          }
        );
        const now = Date.now();
        const current = new Set(ctx.params.functionIds);
        // Only a role in the task of this turn is asked about; a question about unrelated work
        // would open a new topic (one real question per turn, UAT A-F05).
        if (!current.size) return null;
        const open = (await this.proposals(p.tenantId))
          .filter((doc) => doc.state === 'nominated')
          .flatMap((doc) =>
            doc.rows
              .filter(
                (row) =>
                  current.has(doc.functionId) &&
                  row.actorRef.actorType === 'user' &&
                  row.actorRef.actorId === p.actorId &&
                  row.confirmation.verdict === 'pending' &&
                  (!row.askedAt || now - Date.parse(row.askedAt) > ASK_COOLDOWN_MS)
              )
              .map((row) => ({ doc, row }))
          )
          // The most certain proposal of this turn's task first.
          .sort((a, b) => b.row.confidence - a.row.confidence);
        if (!open.length) return null;
        const { doc, row } = open[0];
        await this.mutate(p.tenantId, doc.functionId, (latest) => ({
          ...latest,
          rows: latest.rows.map((item) =>
            rowKey(item.actorRef) === rowKey(row.actorRef)
              ? {
                  ...item,
                  askedAt: new Date(now).toISOString(),
                  askedIn: ctx.params.conversationId,
                }
              : item
          ),
        }));
        return signals.askText(
          { ...row, functionId: doc.functionId },
          doc.label,
          ctx.params.register
        );
      },
    },
    // Internal: a reply that may answer an earlier role question of this person.
    answer: {
      visibility: 'protected',
      params: {
        message: { type: 'string', max: 4000 },
        functionIds: { type: 'array', items: 'string', max: 5 },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const results = [];
        for (const functionId of ctx.params.functionIds) {
          const doc = await this.db.get(docId(p.tenantId, functionId)).catch(() => null);
          const row = doc?.rows.find(
            (item) =>
              item.actorRef.actorType === 'user' &&
              item.actorRef.actorId === p.actorId &&
              item.confirmation.verdict === 'pending' &&
              item.askedAt
          );
          if (!row) continue;
          const reading = await signals
            .readAnswer({
              message: ctx.params.message,
              question: `Rolle bei „${doc.label}“: ${signals.ROLE_LABEL[row.role]}?`,
              proposedRole: row.role,
              tenantId: p.tenantId,
              broker: this.broker,
            })
            .catch(() => null);
          if (!reading) continue;
          results.push(await this.confirmRow(ctx, p, functionId, row.actorRef, reading));
        }
        return results;
      },
    },
  },
  events: {
    // A stated responsibility (#997 contact need) names who is accountable.
    'knowledge.answered.v1': {
      async handler(ctx) {
        const event = ctx.params || {};
        const register = this.broker.getLocalService('knowledge-needs');
        if (!event.tenantId || typeof register?.answeredNeeds !== 'function') return;
        const need = (await register.answeredNeeds(event.tenantId)).find(
          (item) => item.needId === event.needId
        );
        if (need?.kind !== 'contact') return;
        const answer = (need.answers || []).find((item) => item.answerId === event.answerId);
        if (!answer?.value) return;
        for (const functionId of need.functionIds || [])
          await this.addSignals(event.tenantId, [
            signals.statedSignal({
              functionId,
              value: answer.value,
              answerId: answer.answerId,
              actorId: answer.actorId,
              at: answer.at || new Date().toISOString(),
            }),
          ]);
      },
    },
  },
  methods: {
    async proposals(tenantId) {
      const start = `rp:${encodeURIComponent(tenantId)}:`;
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: start,
        endkey: `${start}￿`,
      });
      return result.rows
        .map((row) => row.doc)
        .filter((doc) => doc.tenantId === tenantId && doc.type === 'role_proposal');
    },
    async refresh(tenantId, functionIds, { actorId } = {}) {
      const coverage = this.broker.getLocalService('function-coverage');
      if (typeof coverage?.coverageRows !== 'function') return [];
      // Only functions this person covers, or the requested ones, to stay cheap per turn.
      const scope =
        functionIds ||
        (actorId
          ? (await coverage.coverageRows(tenantId, { actorId })).map((row) => row.functionId)
          : null);
      if (scope && !scope.length) return [];
      const rows = await coverage.coverageRows(tenantId, scope ? { functionIds: scope } : {});
      return this.addSignals(tenantId, signals.coverageSignals(rows));
    },
    // Merge signals into the proposal rows of their function; one D per proposal.
    async addSignals(tenantId, list) {
      const byFunction = new Map();
      for (const signal of list) {
        const entries = byFunction.get(signal.functionId) || [];
        entries.push(signal);
        byFunction.set(signal.functionId, entries);
      }
      const changed = [];
      for (const [functionId, entries] of byFunction) {
        const next = await this.mutate(tenantId, functionId, (doc) => {
          const rows = new Map(doc.rows.map((row) => [rowKey(row.actorRef), row]));
          for (const signal of entries) {
            const key = rowKey(signal.actorRef);
            const existing = rows.get(key);
            const confirmed = existing && existing.confirmation.verdict !== 'pending';
            const evidence = [...(existing?.evidence || []), ...signal.evidence]
              .filter(
                (item, index, all) =>
                  all.findIndex((other) => other.kind === item.kind && other.ref === item.ref) ===
                  index
              )
              .slice(-MAX_EVIDENCE);
            rows.set(key, {
              actorRef: signal.actorRef,
              // A person's confirmed or corrected role is not overwritten by observation.
              role: confirmed ? existing.role : signal.suggestedRole,
              confidence: confirmed
                ? existing.confidence
                : Math.max(existing?.confidence || 0, signal.confidence),
              origins: [...new Set([...(existing?.origins || []), signal.origin])],
              evidence,
              confirmation: existing?.confirmation || {
                // A stated responsibility of a team or label counts as stated, not as pending.
                verdict: signal.actorRef.actorType === 'user' ? 'pending' : 'stated',
              },
              ...(existing?.askedAt ? { askedAt: existing.askedAt } : {}),
            });
          }
          const ordered = this.singlePerformer([...rows.values()]).slice(0, MAX_ROWS);
          return { ...doc, rows: ordered, state: this.stateFor(doc, ordered) };
        });
        for (const signal of entries)
          await this.broker.emit('vdmi.role.signal.v1', { tenantId, ...signal });
        if (next) changed.push(this.view(next));
      }
      return changed;
    },
    // Keep the strongest performer as D; others observed as performing contribute.
    singlePerformer(rows) {
      const performers = rows
        .filter((row) => row.role === 'D')
        .sort(
          (a, b) =>
            Number(
              b.confirmation.verdict === 'confirmed' || b.confirmation.verdict === 'corrected'
            ) -
              Number(
                a.confirmation.verdict === 'confirmed' || a.confirmation.verdict === 'corrected'
              ) || b.confidence - a.confidence
        );
      const keep = performers[0] && rowKey(performers[0].actorRef);
      return rows
        .map((row) =>
          row.role === 'D' &&
          rowKey(row.actorRef) !== keep &&
          row.confirmation.verdict === 'pending'
            ? { ...row, role: 'M' }
            : row
        )
        .sort((a, b) => b.confidence - a.confidence);
    },
    stateFor(doc, rows) {
      const people = rows.filter((row) => row.actorRef.actorType === 'user');
      const answered = (row) =>
        ['confirmed', 'corrected', 'rejected'].includes(row.confirmation.verdict);
      const holding = rows.filter(
        (row) =>
          ['V', 'D'].includes(row.role) &&
          ['confirmed', 'corrected', 'stated'].includes(row.confirmation.verdict)
      );
      if (people.length && people.every(answered) && holding.length) return 'confirmed';
      if (rows.some((row) => row.confidence >= NOMINATE_MIN)) return 'nominated';
      return 'observed';
    },
    async confirmRow(ctx, p, functionId, actorRef, reading) {
      const next = await this.mutate(p.tenantId, functionId, (doc) => {
        const rows = doc.rows.map((row) =>
          rowKey(row.actorRef) === rowKey(actorRef)
            ? {
                ...row,
                role: reading.role,
                confidence: reading.verdict === 'rejected' ? 0 : 1,
                confirmation: {
                  verdict: reading.verdict,
                  basis: reading.basis,
                  at: new Date().toISOString(),
                },
              }
            : row
        );
        const ordered = this.singlePerformer(rows);
        return { ...doc, rows: ordered, state: this.stateFor(doc, ordered) };
      });
      if (next?.state === 'confirmed' && !next.vdmiMatrixId) return this.record(ctx, p, next);
      return next && this.view(next);
    },
    // A confirmed proposal becomes an ad-hoc VDMI matrix (the record); the proposal links it.
    async record(ctx, p, doc) {
      if (!this.broker.getLocalService('vdmi')) return this.view(doc);
      const actors = (role) =>
        doc.rows
          .filter(
            (row) =>
              row.role === role &&
              ['confirmed', 'corrected', 'stated'].includes(row.confirmation.verdict)
          )
          .map((row) => ({ ...row.actorRef, confidence: row.confidence, origins: row.origins }));
      try {
        const created = await ctx.call('vdmi.create', {
          processId: `function:${doc.functionId}`,
          name: doc.label.slice(0, 200),
          scope: 'role-proposal',
          tasks: [
            {
              taskId: 'task-01',
              taskName: doc.label.slice(0, 200),
              phase: 'execution',
              verantwortlich: actors('V'),
              durchfuehrend: actors('D').slice(0, 1),
              mitwirkend: actors('M'),
              information: actors('I'),
              dependsOn: [],
              blocks: [],
              hitlRequired: false,
              hitlItemId: null,
              executionTrace: [],
            },
          ],
        });
        const next = await this.mutate(p.tenantId, doc.functionId, (latest) => ({
          ...latest,
          vdmiMatrixId: created?.matrix?.id || null,
        }));
        return this.view(next);
      } catch (error) {
        this.logger.warn('Role proposal not recorded in VDMI', error.message);
        return this.view(doc);
      }
    },
    async mutate(tenantId, functionId, change) {
      const _id = docId(tenantId, functionId);
      for (let attempt = 0; attempt < 4; attempt++) {
        const existing = await this.db.get(_id).catch(() => null);
        const base = existing || {
          _id,
          type: 'role_proposal',
          proposalId: randomUUID(),
          tenantId,
          functionId,
          label: this.label(functionId),
          rows: [],
          state: 'observed',
          createdAt: new Date().toISOString(),
        };
        const next = { ...change(base), updatedAt: new Date().toISOString() };
        try {
          const { rev } = await this.db.put(next);
          const saved = { ...next, _rev: rev };
          if (
            !existing ||
            existing.state !== saved.state ||
            JSON.stringify(existing.rows) !== JSON.stringify(saved.rows)
          )
            await this.broker.emit('vdmi.role.proposal.changed.v1', {
              tenantId,
              ...this.view(saved),
            });
          return saved;
        } catch (error) {
          if (error.status !== 409) throw error;
        }
      }
      return null;
    },
    // Readable name: the responsibility need's label (#997), else the function label without
    // technical separators; never a raw identifier in the chat.
    label(functionId) {
      const need = require('../knowledge-needs.json').needs.find(
        (item) => item.kind === 'contact' && (item.functionIds || []).includes(functionId)
      );
      if (need?.label) return need.label;
      const fn = require('../src/function-model')
        .getFunctionModel()
        .functions.find((item) => item.functionId === functionId);
      // The model's German display label, never the technical one.
      if (fn?.displayLabel) return fn.displayLabel;
      return String(fn?.label || functionId)
        .replace(/^fn-/u, '')
        .replace(/[_-]+/gu, ' ')
        .trim();
    },
    // Rows of a function for routing (A3): only answered or stated rows count as a role.
    async rolesFor(tenantId, functionIds) {
      const result = {};
      for (const functionId of functionIds || []) {
        const doc = await this.db.get(docId(tenantId, functionId)).catch(() => null);
        if (!doc) continue;
        result[functionId] = doc.rows
          .filter((row) => ['confirmed', 'corrected', 'stated'].includes(row.confirmation.verdict))
          .map((row) => ({ actorRef: row.actorRef, role: row.role }));
      }
      return result;
    },
    view(doc) {
      const { _id, _rev, type, tenantId, ...rest } = doc;
      return rest;
    },
    // Presentation order only (label, functionId), bounded; never a ranking.
    presentationOrder(docs) {
      return [...docs]
        .sort(
          (a, b) =>
            String(a.label).localeCompare(String(b.label), 'de') ||
            String(a.functionId).localeCompare(String(b.functionId))
        )
        .slice(0, MAX_PRESENTED);
    },
    presentProposal(doc) {
      const count = (verdicts) =>
        doc.rows.filter((row) => verdicts.includes(row.confirmation?.verdict)).length;
      const pendingCount = count(['pending']);
      return {
        proposalId: doc.proposalId,
        functionId: doc.functionId,
        label: bounded(doc.label, 200),
        state: doc.state,
        rowCount: doc.rows.length,
        pendingCount,
        answeredCount: count(ANSWERED),
        statedCount: count(['stated']),
        vdmiLinked: Boolean(doc.vdmiMatrixId),
        vdmiMatrixId: doc.vdmiMatrixId ? bounded(doc.vdmiMatrixId, 120) : null,
        ...proposalFollowUp(doc, pendingCount),
      };
    },
    // A person is shown as themself or redacted (no directory label is approved here); a stated
    // responsibility is shown by its stated label.
    actorDisplay(actorRef, p) {
      if (actorRef.actorType === 'user')
        return actorRef.actorId === p.actorId
          ? { label: 'Sie selbst', status: 'self' }
          : { label: 'Person (Anzeigename nicht freigegeben)', status: 'redacted' };
      if (actorRef.actorType === 'label')
        return { label: bounded(actorRef.actorId, 80), status: 'stated_label' };
      return { label: 'Eintrag (nicht freigegeben)', status: 'redacted' };
    },
    presentRows(doc, rows, p) {
      return rows
        .map((row) => ({ row, display: this.actorDisplay(row.actorRef, p) }))
        .sort(
          (a, b) =>
            roleIndex(a.row.role) - roleIndex(b.row.role) ||
            a.display.label.localeCompare(b.display.label, 'de') ||
            subjectKey(a.row.actorRef).localeCompare(subjectKey(b.row.actorRef))
        )
        .map(({ row, display }, index) => {
          const origins = [...new Set(row.origins || [])];
          return {
            proposalId: doc.proposalId,
            functionId: doc.functionId,
            label: bounded(doc.label, 200),
            state: doc.state,
            vdmiLinked: Boolean(doc.vdmiMatrixId),
            rowOrdinal: index + 1,
            actorDisplayLabel: display.label,
            actorDisplayStatus: display.status,
            actorType: ['user', 'label'].includes(row.actorRef.actorType)
              ? row.actorRef.actorType
              : 'other',
            role: ROLE_ORDER.includes(row.role) ? row.role : null,
            roleLabel: ROLE_DISPLAY[row.role] || 'Rolle offen',
            confidenceBand: confidenceBand(Number(row.confidence) || 0),
            originLabel: origins
              .map((origin) => ORIGIN_LABEL[origin] || 'Sonstige Quelle')
              .sort((a, b) => a.localeCompare(b, 'de'))
              .join(' + '),
            originCount: origins.length,
            confirmationVerdict: row.confirmation?.verdict || 'pending',
            confirmationAt: row.confirmation?.at ? bounded(row.confirmation.at, 40) : null,
            evidenceCount: (row.evidence || []).length,
            ...rowFollowUp(row, display.status === 'self'),
          };
        });
    },
  },
};
