'use strict';

/**
 * Shared Moleculer mixin of a domain pack (micro-agent tier, Phase 0). A pack contributes its
 * subject matter as data and functions; the mixin owns the uniform contract, so no pack writes
 * its own lifecycle, validation or time budget.
 *
 *   mixins: [createDomainPackMixin({
 *     pack: 'example', label: '…', description: '…',
 *     functionDomains: ['…'], functionServices: ['…'],      // link to the function model
 *     objectKinds: [{ kind, label, description, detect?(text) → [{ value, quote }] }],
 *     expanders: { [kind]: async (ctx, object, context) → partial finding },
 *     playbooks: [{ from: kind, next: (finding, object) → [object] }],
 *   })]
 *
 * Actions (all read-only):
 * - `describe`: what the pack understands (for the registry and the recognizer);
 * - `detect`: deterministic recognition of the pack's formats in a text;
 * - `expand`: one object → one finding, normalized to the contract, within its budget;
 * - `plan`: follow-up objects of a finding from the pack's playbooks (second stage).
 *
 * An expander never writes: packs wrap read actions of existing services. A failing or slow
 * expander returns an empty finding with its reason, never an error that stops the turn.
 */

const { normalizeFinding, normalizeObject, CONCERN_KIND } = require('./contract');

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_DETECTED = 20;
const MAX_FOLLOW_UPS = 4;

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('expander_timeout')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createDomainPackMixin({
  pack,
  label,
  description,
  functionDomains = [],
  functionServices = [],
  objectKinds = [],
  expanders = {},
  playbooks = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!pack || !label || !description)
    throw new Error('A domain pack needs pack, label and description.');
  const kinds = objectKinds.map(({ kind, label: kindLabel, description: kindDescription }) => ({
    kind,
    label: kindLabel,
    description: kindDescription,
  }));
  const handled = [...new Set([...Object.keys(expanders)])];
  const manifest = {
    pack,
    label,
    description,
    functionDomains,
    functionServices,
    objectKinds: kinds,
    expands: handled,
    concern: Boolean(expanders[CONCERN_KIND]),
  };
  return {
    metadata: { microAgent: manifest },
    actions: {
      describe: {
        visibility: 'public',
        handler() {
          return manifest;
        },
      },
      detect: {
        visibility: 'public',
        params: { text: { type: 'string', optional: true } },
        handler(ctx) {
          const value = String(ctx.params.text || '');
          const found = [];
          for (const entry of objectKinds) {
            if (typeof entry.detect !== 'function') continue;
            let hits = [];
            try {
              hits = entry.detect(value) || [];
            } catch (error) {
              this.logger.warn(`Micro-agent ${pack} detect ${entry.kind} failed: ${error.message}`);
            }
            for (const hit of hits) {
              // Deterministic recognition only counts what literally occurs in the text.
              if (!hit?.value || !value.includes(hit.quote || hit.value)) continue;
              found.push(
                normalizeObject(
                  {
                    kind: entry.kind,
                    value: hit.value,
                    label: hit.label,
                    provenance: { origin: 'message', quote: hit.quote || hit.value },
                    confidence: 1,
                  },
                  found.length
                )
              );
              if (found.length >= MAX_DETECTED) return found;
            }
          }
          return found;
        },
      },
      expand: {
        visibility: 'public',
        params: {
          object: { type: 'object' },
          context: { type: 'object', optional: true },
          budget: { type: 'object', optional: true },
        },
        async handler(ctx) {
          const object = normalizeObject(ctx.params.object);
          const expander = expanders[object.kind];
          const started = Date.now();
          if (!expander)
            return {
              ...normalizeFinding({}, { pack, objectId: object.objectId }).finding,
              skipped: 'kind_not_handled',
            };
          const limit = Math.min(Number(ctx.params.budget?.timeoutMs) || timeoutMs, timeoutMs);
          try {
            const raw = await withTimeout(
              Promise.resolve(expander.call(this, ctx, object, ctx.params.context || {})),
              limit
            );
            const { finding, dropped } = normalizeFinding(
              { ...raw, elapsedMs: Date.now() - started },
              { pack, objectId: object.objectId }
            );
            if (dropped.length)
              this.logger.info(`Micro-agent ${pack} contract dropped parts`, { dropped });
            return { ...finding, dropped: dropped.length };
          } catch (error) {
            this.logger.warn(`Micro-agent ${pack} expand ${object.kind} failed: ${error.message}`);
            return {
              ...normalizeFinding({}, { pack, objectId: object.objectId }).finding,
              elapsedMs: Date.now() - started,
              failed: error.message === 'expander_timeout' ? 'timeout' : 'error',
            };
          }
        },
      },
      plan: {
        visibility: 'public',
        params: { finding: { type: 'object' }, object: { type: 'object', optional: true } },
        handler(ctx) {
          const next = [];
          for (const playbook of playbooks) {
            if (ctx.params.object?.kind && playbook.from !== ctx.params.object.kind) continue;
            let objects = [];
            try {
              objects = playbook.next(ctx.params.finding, ctx.params.object) || [];
            } catch (error) {
              this.logger.warn(`Micro-agent ${pack} playbook failed: ${error.message}`);
            }
            for (const object of objects) {
              next.push(
                normalizeObject(
                  {
                    ...object,
                    provenance: { origin: 'finding', ref: ctx.params.finding?.objectId },
                  },
                  next.length
                )
              );
              if (next.length >= MAX_FOLLOW_UPS) return next;
            }
          }
          return next;
        },
      },
    },
  };
}

module.exports = { createDomainPackMixin, DEFAULT_TIMEOUT_MS };
