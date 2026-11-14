CREATE TABLE IF NOT EXISTS management_topics (
  topic_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  business_goal TEXT,
  owner_agent TEXT NOT NULL,
  participating_agents_json TEXT NOT NULL DEFAULT '[]',
  current_state TEXT NOT NULL,
  next_step TEXT,
  expected_progress_at INTEGER,
  impact_statement TEXT,
  last_substantive_progress_at INTEGER,
  matrix_room_ref TEXT,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  source_task_refs_json TEXT NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_decisions (
  decision_id TEXT PRIMARY KEY,
  topic_id TEXT,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  decision_class TEXT NOT NULL,
  question TEXT NOT NULL,
  reason_human_required TEXT NOT NULL,
  recommendation TEXT,
  options_json TEXT NOT NULL,
  consequences_json TEXT NOT NULL,
  deadline INTEGER,
  non_decision_effect TEXT,
  execution_scope_json TEXT,
  excluded_scope_json TEXT,
  status TEXT NOT NULL,
  classifier_label TEXT NOT NULL,
  classifier_reasons_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  first_projected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_board, source_task_id)
);

CREATE TABLE IF NOT EXISTS agent_briefs (
  agent_id TEXT PRIMARY KEY,
  reporting_period_start INTEGER NOT NULL,
  reporting_period_end INTEGER NOT NULL,
  current_goal TEXT,
  active_topic_refs_json TEXT NOT NULL DEFAULT '[]',
  outcomes_json TEXT NOT NULL DEFAULT '[]',
  next_actions_json TEXT NOT NULL DEFAULT '[]',
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  needs_management_json TEXT NOT NULL DEFAULT '[]',
  last_substantive_progress_at INTEGER,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  outcome_id TEXT PRIMARY KEY,
  topic_id TEXT,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  outcome_type TEXT NOT NULL,
  statement TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  occurred_at INTEGER NOT NULL,
  counterparty TEXT,
  economic_relevance TEXT,
  confidence REAL NOT NULL,
  UNIQUE(source_board, source_task_id, outcome_type, statement)
);

CREATE TABLE IF NOT EXISTS wakeups (
  wakeup_id TEXT PRIMARY KEY,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  wake_at INTEGER NOT NULL,
  why_scheduled TEXT NOT NULL,
  next_action_on_wake TEXT NOT NULL,
  signal_required TEXT,
  auto_close_after INTEGER,
  owner_agent TEXT NOT NULL,
  status TEXT NOT NULL,
  last_signal_at INTEGER,
  UNIQUE(source_board, source_task_id)
);

CREATE TABLE IF NOT EXISTS classification_audit (
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  projected_at INTEGER NOT NULL,
  label TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  classifier_version TEXT NOT NULL,
  overridden_by TEXT,
  override_reason TEXT,
  PRIMARY KEY(source_board, source_task_id, projected_at)
);

CREATE TABLE IF NOT EXISTS cockpit_events (
  event_id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  actor TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projection_boards (
  board TEXT PRIMARY KEY,
  projected_at INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projection_objects (
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  PRIMARY KEY(object_type, object_id)
);

CREATE TABLE IF NOT EXISTS projection_objects_v2 (
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  PRIMARY KEY(object_type, object_id, source_board, source_task_id)
);
INSERT OR IGNORE INTO projection_objects_v2
  SELECT object_type, object_id, source_board, source_task_id FROM projection_objects;
DROP TABLE projection_objects;
ALTER TABLE projection_objects_v2 RENAME TO projection_objects;
CREATE INDEX IF NOT EXISTS projection_objects_source
  ON projection_objects(source_board, source_task_id);

CREATE TABLE IF NOT EXISTS agent_briefs_v3 (
  agent_id TEXT PRIMARY KEY,
  reporting_period_start INTEGER NOT NULL,
  reporting_period_end INTEGER NOT NULL,
  current_goal TEXT,
  active_topic_refs_json TEXT NOT NULL DEFAULT '[]',
  outcomes_json TEXT NOT NULL DEFAULT '[]',
  next_actions_json TEXT NOT NULL DEFAULT '[]',
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  needs_management_json TEXT NOT NULL DEFAULT '[]',
  last_substantive_progress_at INTEGER,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  brief_status TEXT NOT NULL DEFAULT 'empty',
  empty_state_reason TEXT,
  updated_at INTEGER NOT NULL
);
INSERT OR REPLACE INTO agent_briefs_v3 (
  agent_id, reporting_period_start, reporting_period_end, current_goal,
  active_topic_refs_json, outcomes_json, next_actions_json, dependencies_json,
  risks_json, needs_management_json, last_substantive_progress_at,
  evidence_refs_json, brief_status, empty_state_reason, updated_at
)
SELECT
  agent_id, reporting_period_start, reporting_period_end, current_goal,
  active_topic_refs_json, outcomes_json, next_actions_json, dependencies_json,
  risks_json, needs_management_json, last_substantive_progress_at,
  evidence_refs_json,
  CASE
    WHEN active_topic_refs_json = '[]' AND outcomes_json = '[]' THEN 'empty'
    WHEN last_substantive_progress_at IS NULL THEN 'active_without_substantive_progress'
    ELSE 'current'
  END,
  CASE
    WHEN active_topic_refs_json = '[]' AND outcomes_json = '[]'
      THEN 'Keine aktiven Managementthemen oder belegten Ergebnisse im Berichtszeitraum.'
    WHEN last_substantive_progress_at IS NULL
      THEN 'Aktive Themen sind sichtbar, aber im Berichtszeitraum ist kein belegter substantieller Fortschritt vorhanden.'
    ELSE NULL
  END,
  updated_at
FROM agent_briefs;
DROP TABLE agent_briefs;
ALTER TABLE agent_briefs_v3 RENAME TO agent_briefs;

ALTER TABLE governance_decisions
  ADD COLUMN source_refs_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS digest_items (
  digest_id TEXT PRIMARY KEY,
  day_bucket TEXT NOT NULL,
  source_board TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  topic_id TEXT,
  category TEXT NOT NULL,
  disposition TEXT NOT NULL,
  signal TEXT NOT NULL,
  material INTEGER NOT NULL DEFAULT 0,
  recommendation TEXT,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  provenance_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  UNIQUE(source_board, source_task_id)
);
CREATE INDEX IF NOT EXISTS digest_items_observed
  ON digest_items(observed_at DESC, digest_id);

CREATE TABLE IF NOT EXISTS projection_runs (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  projected_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  lag_seconds INTEGER,
  fingerprint TEXT,
  error_code TEXT
);
ALTER TABLE projection_runs ADD COLUMN error_code TEXT;
CREATE INDEX IF NOT EXISTS projection_runs_started ON projection_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS projection_source_health (
  source_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  last_event_at INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  source_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projection_checkpoint (
  checkpoint_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 6;
