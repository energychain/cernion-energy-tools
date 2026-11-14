PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assistant_conversations (
  conversation_id TEXT PRIMARY KEY,
  object_type TEXT,
  object_id TEXT,
  hermes_session_name TEXT NOT NULL,
  hermes_session_id TEXT,
  hermes_session_messages INTEGER NOT NULL DEFAULT 0 CHECK (hermes_session_messages >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((object_type IS NULL AND object_id IS NULL) OR
         (object_type IS NOT NULL AND object_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_one_active_object_conversation
  ON assistant_conversations(object_type, object_id)
  WHERE status = 'active' AND object_type IS NOT NULL AND object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assistant_messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(conversation_id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  client_message_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(conversation_id, client_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_client_message_global
  ON assistant_messages(client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_messages_conversation
  ON assistant_messages(conversation_id, created_at, message_id);

CREATE TABLE IF NOT EXISTS assistant_context_envelopes (
  context_envelope_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(conversation_id),
  object_type TEXT,
  object_id TEXT,
  fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_context_conversation
  ON assistant_context_envelopes(conversation_id, created_at, context_envelope_id);

CREATE TABLE IF NOT EXISTS assistant_runs (
  run_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(conversation_id),
  client_message_id TEXT NOT NULL UNIQUE,
  user_message_id TEXT NOT NULL REFERENCES assistant_messages(message_id),
  assistant_message_id TEXT REFERENCES assistant_messages(message_id),
  context_envelope_id TEXT REFERENCES assistant_context_envelopes(context_envelope_id),
  hermes_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted','running','completed','failed','cancelled')),
  error_code TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_runs_conversation
  ON assistant_runs(conversation_id, created_at, run_id);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_one_running_per_conversation
  ON assistant_runs(conversation_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS assistant_summaries (
  conversation_id TEXT PRIMARY KEY REFERENCES assistant_conversations(conversation_id),
  content TEXT NOT NULL,
  through_message_id TEXT NOT NULL REFERENCES assistant_messages(message_id),
  message_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_action_proposals (
  proposal_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(conversation_id),
  message_id TEXT NOT NULL REFERENCES assistant_messages(message_id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'record_feedback', 'delegate', 'create_followup', 'schedule_wakeup',
    'prepare_decision', 'mark_no_action'
  )),
  target_type TEXT,
  target_id TEXT,
  payload_json TEXT NOT NULL,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('low', 'medium', 'high')),
  scope_status TEXT NOT NULL CHECK (scope_status IN ('covered', 'unknown', 'denied')),
  status TEXT NOT NULL CHECK (status IN (
    'shadow', 'confirmed', 'executing', 'executed', 'failed', 'rejected', 'expired'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((target_type IS NULL AND target_id IS NULL) OR
         (target_type IS NOT NULL AND target_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS assistant_proposals_conversation
  ON assistant_action_proposals(conversation_id, created_at, proposal_id);
CREATE INDEX IF NOT EXISTS assistant_proposals_status
  ON assistant_action_proposals(status, updated_at, proposal_id);

CREATE TABLE IF NOT EXISTS assistant_action_receipts (
  receipt_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES assistant_action_proposals(proposal_id),
  source_board TEXT,
  source_task_id TEXT,
  matrix_room_id TEXT,
  matrix_event_id TEXT,
  before_fingerprint TEXT,
  after_fingerprint TEXT,
  readback_json TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  CHECK ((source_board IS NULL AND source_task_id IS NULL) OR
         (source_board IS NOT NULL AND source_task_id IS NOT NULL)),
  CHECK ((matrix_room_id IS NULL AND matrix_event_id IS NULL) OR
         (matrix_room_id IS NOT NULL AND matrix_event_id IS NOT NULL))
);

CREATE TRIGGER IF NOT EXISTS assistant_receipts_no_update
BEFORE UPDATE ON assistant_action_receipts BEGIN
  SELECT RAISE(ABORT, 'assistant_action_receipts_append_only');
END;
CREATE TRIGGER IF NOT EXISTS assistant_receipts_no_delete
BEFORE DELETE ON assistant_action_receipts BEGIN
  SELECT RAISE(ABORT, 'assistant_action_receipts_append_only');
END;

CREATE TABLE IF NOT EXISTS assistant_events (
  event_id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES assistant_conversations(conversation_id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_events_conversation
  ON assistant_events(conversation_id, occurred_at, event_id);

CREATE TRIGGER IF NOT EXISTS assistant_events_no_update
BEFORE UPDATE ON assistant_events BEGIN
  SELECT RAISE(ABORT, 'assistant_events_append_only');
END;
CREATE TRIGGER IF NOT EXISTS assistant_events_no_delete
BEFORE DELETE ON assistant_events BEGIN
  SELECT RAISE(ABORT, 'assistant_events_append_only');
END;

CREATE TABLE IF NOT EXISTS assistant_reconciliation_items (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES assistant_action_proposals(proposal_id),
  stage TEXT NOT NULL CHECK (stage IN ('kanban', 'matrix', 'result')),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'write_unknown', 'readback_mismatch', 'matrix_pending',
    'matrix_unknown', 'resolved', 'cancelled'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error_code TEXT,
  expected_fingerprint TEXT,
  matrix_room_id TEXT,
  matrix_event_id TEXT,
  owner TEXT NOT NULL,
  details_json TEXT NOT NULL,
  escalated_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(proposal_id, stage)
);
CREATE INDEX IF NOT EXISTS assistant_reconciliation_due
  ON assistant_reconciliation_items(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS assistant_reconciliation_events (
  event_id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES assistant_reconciliation_items(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_reconciliation_event_item
  ON assistant_reconciliation_events(reconciliation_id, occurred_at, event_id);
CREATE TRIGGER IF NOT EXISTS assistant_reconciliation_events_no_update
BEFORE UPDATE ON assistant_reconciliation_events BEGIN
  SELECT RAISE(ABORT, 'assistant_reconciliation_events_append_only');
END;
CREATE TRIGGER IF NOT EXISTS assistant_reconciliation_events_no_delete
BEFORE DELETE ON assistant_reconciliation_events BEGIN
  SELECT RAISE(ABORT, 'assistant_reconciliation_events_append_only');
END;

CREATE TABLE IF NOT EXISTS assistant_results (
  result_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES assistant_action_proposals(proposal_id),
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(conversation_id),
  parent_result_id TEXT REFERENCES assistant_results(result_id),
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('matrix', 'hint')),
  source_event_id TEXT,
  result_status TEXT NOT NULL CHECK (result_status IN (
    'completed', 'blocked', 'needs_decision', 'continuing'
  )),
  statement TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  next_step TEXT,
  responsible_agent TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  outcome_candidate_json TEXT,
  management_decision_json TEXT,
  correlation_status TEXT NOT NULL CHECK (correlation_status IN ('verified', 'hint')),
  verification_status TEXT NOT NULL CHECK (verification_status IN (
    'awaiting_acceptance', 'needs_reconciliation', 'accepted', 'corrected', 'continued',
    'ended', 'rejected'
  )),
  operator_decision TEXT,
  kanban_readback_json TEXT,
  reply_message_id TEXT REFERENCES assistant_messages(message_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_kind, source_event_id),
  UNIQUE(proposal_id, occurred_at, statement)
);
CREATE INDEX IF NOT EXISTS assistant_results_conversation
  ON assistant_results(conversation_id, created_at, result_id);
CREATE INDEX IF NOT EXISTS assistant_results_proposal
  ON assistant_results(proposal_id, created_at, result_id);

CREATE TABLE IF NOT EXISTS assistant_result_rounds (
  round_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES assistant_results(result_id),
  parent_round_id TEXT REFERENCES assistant_result_rounds(round_id),
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  action TEXT NOT NULL CHECK (action IN ('correct', 'continue')),
  instruction TEXT NOT NULL,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  linked_task_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE(result_id, round_number)
);

CREATE TABLE IF NOT EXISTS assistant_handoff_bindings (
  proposal_id TEXT PRIMARY KEY REFERENCES assistant_action_proposals(proposal_id),
  responsible_agent TEXT NOT NULL,
  expected_sender TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS assistant_handoff_bindings_no_update
BEFORE UPDATE ON assistant_handoff_bindings BEGIN
  SELECT RAISE(ABORT, 'handoff_binding_immutable');
END;
CREATE TRIGGER IF NOT EXISTS assistant_handoff_bindings_no_delete
BEFORE DELETE ON assistant_handoff_bindings BEGIN
  SELECT RAISE(ABORT, 'handoff_binding_immutable');
END;
CREATE TABLE IF NOT EXISTS assistant_result_operations (
  operation_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES assistant_results(result_id),
  action TEXT NOT NULL CHECK (action IN ('accept','end','correct','continue')),
  request_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  instruction TEXT NOT NULL,
  audit_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('result_pending','write_unknown','applied')),
  write_started INTEGER NOT NULL DEFAULT 0 CHECK (write_started IN (0,1)),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  receipt_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_one_pending_result_operation
  ON assistant_result_operations(result_id) WHERE status <> 'applied';
PRAGMA user_version = 10;
