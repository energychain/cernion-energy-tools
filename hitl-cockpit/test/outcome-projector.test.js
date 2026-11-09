'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evaluateOutcome, projectOutcomes } = require('../lib/outcome-projector');

function task(overrides = {}) {
  return {
    id: 't_fixture',
    board: 'fixture',
    title: 'Fixture',
    body: '',
    result: '',
    comments: [],
    attachments: [],
    status: 'done',
    completed_at: 1700000000,
    ...overrides,
  };
}

test('accepts explicitly typed external impact only with material evidence and time', () => {
  const result = evaluateOutcome(
    task({
      result: [
        'OUTCOME_TYPE: offer_sent',
        'OUTCOME_STATEMENT: Angebot an Stadtwerk versendet',
        'OUTCOME_EVIDENCE: message-id:<offer-4711@example.org>',
        'OUTCOME_OCCURRED_AT: 2026-11-08T10:15:00Z',
        'OUTCOME_COUNTERPARTY: Stadtwerk Beispiel',
      ].join('\n'),
    })
  );
  assert.equal(result.accepted, true);
  assert.equal(result.outcome.outcome_type, 'offer_sent');
  assert.equal(result.outcome.statement, 'Angebot an Stadtwerk versendet');
  assert.deepEqual(JSON.parse(result.outcome.evidence_refs_json), [
    'message-id:<offer-4711@example.org>',
  ]);
  assert.equal(result.outcome.counterparty, 'Stadtwerk Beispiel');
});

test('rejects internal activity, unproven completion, and internal offer creation', () => {
  assert.equal(
    evaluateOutcome(task({ result: 'Bericht erstellt', attachments: [{ id: 'a1' }] })).reason,
    'no_outcome_signal'
  );
  assert.equal(
    evaluateOutcome(
      task({
        result: 'OUTCOME_TYPE: payment_received\nOUTCOME_STATEMENT: Zahlung eingegangen',
      })
    ).reason,
    'material_evidence_missing'
  );
  assert.equal(
    evaluateOutcome(
      task({
        result:
          'OUTCOME_TYPE: offer_created\nOUTCOME_EVIDENCE: offer-id:off-1\nOUTCOME_STATEMENT: Angebot erstellt',
      })
    ).reason,
    'internal_precursor'
  );
  assert.equal(
    evaluateOutcome(
      task({
        status: 'ready',
        result:
          'OUTCOME_TYPE: meeting_agreed\nOUTCOME_EVIDENCE: meeting-id:meet-1\nOUTCOME_STATEMENT: Termin vereinbart',
      })
    ).reason,
    'source_not_completed'
  );
});

test('infers a supported external outcome only when evidence is present', () => {
  const accepted = evaluateOutcome(
    task({ result: 'Termin bestätigt. meeting-id:meet-2026-11-08' })
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.outcome.outcome_type, 'meeting_agreed');
  assert.equal(accepted.outcome.confidence, 0.9);

  const rejected = evaluateOutcome(task({ result: 'Termin bestätigt.' }));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'material_evidence_missing');
});

test('accepts evidenced case closure as a final outcome', () => {
  const result = evaluateOutcome(
    task({
      result:
        'OUTCOME_TYPE: customer_case_resolved\nOUTCOME_FINAL: true\nOUTCOME_STATEMENT: Kundenfall fallabschließend gelöst\nOUTCOME_EVIDENCE: case-id:case-9921',
    })
  );
  assert.equal(result.accepted, true);
  assert.equal(result.outcome.outcome_type, 'customer_case_resolved');
});

test('deduplicates CRM and Kanban mirrors by type and external evidence identity', () => {
  const result = projectOutcomes([
    task({
      board: 'crm',
      id: 'crm-1',
      result:
        'OUTCOME_TYPE: human_reply_received\nOUTCOME_STATEMENT: Kunde hat geantwortet\nOUTCOME_EVIDENCE: message-id:reply-88',
    }),
    task({
      board: 'felix',
      id: 'kanban-1',
      result:
        'OUTCOME_TYPE: human_reply_received\nOUTCOME_STATEMENT: Persönliche Kundenantwort mit konkreter Rückfrage erhalten\nOUTCOME_EVIDENCE: message-id:reply-88',
    }),
  ]);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].source_board, 'felix');
  assert.match(result.outcomes[0].statement, /konkreter Rückfrage/);
  assert.ok(
    !JSON.parse(result.outcomes[0].evidence_refs_json).some((ref) => /^kanban:/i.test(ref))
  );
});

test('does not use attachments or task references as automatic proof', () => {
  const result = evaluateOutcome(
    task({
      result: 'OUTCOME_TYPE: release_live\nOUTCOME_STATEMENT: Release live',
      attachments: [{ id: 'screenshot-1', filename: 'live.png' }],
    })
  );
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'material_evidence_missing');
});

test('does not infer outcomes from task prompts, research links, or comments', () => {
  const result = evaluateOutcome(
    task({
      title: 'Prüfe, ob ein Termin vereinbart werden kann',
      body: 'Recherchequelle https://example.org und mögliches payment received Signal',
      result: 'Analyse abgeschlossen',
      comments: [{ body: 'Später eventuell öffentliche Seite veröffentlicht' }],
    })
  );
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'no_outcome_signal');
});

test('maps an evidenced legacy published_asset result to the public outcome class', () => {
  const result = evaluateOutcome(
    task({ result: 'Status: published_asset\nLive: https://example.org/articles/energy' })
  );
  assert.equal(result.accepted, true);
  assert.equal(result.outcome.outcome_type, 'public_asset_published');
  assert.deepEqual(JSON.parse(result.outcome.evidence_refs_json), [
    'https://example.org/articles/energy',
  ]);
});
