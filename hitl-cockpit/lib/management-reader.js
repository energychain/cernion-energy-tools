'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildProjectionHealth } = require('./projection-health');

const PRIVATE_BOARD = 'twl-netze-private';
const PRIVATE_SENSITIVITIES = [
  'twl-private',
  'twl-netze-private',
  'private-quarantine',
  'private',
  'unclear',
  'mixed-sensitive',
];

const PYTHON_READER = String.raw`
import json, sqlite3, sys
request=json.loads(sys.stdin.read())
database=request['database']
uri='file:'+database+'?mode=ro'
con=sqlite3.connect(uri, uri=True, timeout=5)
con.row_factory=sqlite3.Row
con.execute('PRAGMA query_only=ON')

private_board=request['privateBoard']
private_sensitivities=request['privateSensitivities']
private_placeholders=','.join(['?']*len(private_sensitivities))
public_topic="sensitivity NOT IN ("+private_placeholders+") AND source_task_refs_json NOT LIKE ?"
public_topic_params=private_sensitivities+['%"board":"'+private_board+'"%']
open_decision="LOWER(d.status) NOT IN ('done','completed','closed','resolved','rejected','cancelled','archived')"
decision_select="SELECT d.*, t.matrix_room_ref AS matrix_room_ref, t.artifact_refs_json AS topic_artifact_refs_json"

def rows(sql, params=()):
    return [dict(row) for row in con.execute(sql, params).fetchall()]

def scalar(sql, params=()):
    row=con.execute(sql, params).fetchone()
    return row[0] if row else 0

def pagination():
    return (request.get('limit', 50), request.get('offset', 0))

def like_term(value):
    escaped=value.lower().replace('!', '!!').replace('%', '!%').replace('_', '!_')
    return '%'+escaped+'%'

def has_table(name):
    return con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None

def health_rows():
    runs=rows('SELECT * FROM projection_runs ORDER BY started_at DESC, rowid DESC LIMIT 20') if has_table('projection_runs') else []
    sources=rows('SELECT * FROM projection_source_health ORDER BY source_id') if has_table('projection_source_health') else []
    return runs,sources

operation=request['operation']
if operation == 'metadata':
    board=con.execute('SELECT COUNT(*), COALESCE(SUM(source_count),0), COALESCE(MAX(projected_at),0) FROM projection_boards').fetchone()
    health_runs,health_sources=health_rows()
    output={'boardCount':board[0], 'sourceCount':board[1], 'projectedAt':board[2], 'runs':health_runs, 'sources':health_sources}
elif operation == 'health':
    health_runs,health_sources=health_rows()
    output={'runs':health_runs, 'sources':health_sources}
elif operation in ('overview', 'summary'):
    decision_filter=open_decision+" AND d.source_board != ? AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    decision_params=[private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    outcome_filter="o.source_board != ? AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    outcome_params=[private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    output={
      'counts':{
        'topics':scalar('SELECT COUNT(*) FROM management_topics WHERE '+public_topic, public_topic_params),
        'decisions':scalar('SELECT COUNT(*) FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+decision_filter, decision_params),
        'outcomes':scalar('SELECT COUNT(*) FROM outcomes o LEFT JOIN management_topics t ON t.topic_id=o.topic_id WHERE '+outcome_filter, outcome_params),
        'departments':scalar('SELECT COUNT(*) FROM agent_briefs'),
      },
      'decisions':rows(decision_select+' FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+decision_filter+' ORDER BY CASE WHEN d.deadline IS NULL THEN 1 ELSE 0 END, d.deadline, d.updated_at DESC LIMIT 5', decision_params),
      'recentOutcomes':rows('SELECT o.* FROM outcomes o LEFT JOIN management_topics t ON t.topic_id=o.topic_id WHERE '+outcome_filter+' ORDER BY o.occurred_at DESC LIMIT 8', outcome_params),
      'activeTopics':rows("SELECT * FROM management_topics WHERE "+public_topic+" AND current_state NOT IN ('done','completed','archived','cancelled') AND (current_state != 'scheduled' OR (expected_progress_at IS NOT NULL AND expected_progress_at <= ?)) ORDER BY COALESCE(last_substantive_progress_at,0) DESC LIMIT 8", public_topic_params+[request['now']]),
    }
elif operation == 'decisions':
    limit,offset=pagination()
    filter_sql="d.source_board != ? AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    params=[private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    if request.get('decisionClass'):
        filter_sql += ' AND d.decision_class=?'; params.append(request['decisionClass'])
    if request.get('status'):
        filter_sql += ' AND d.status=?'; params.append(request['status'])
    else:
        filter_sql += ' AND '+open_decision
    if request.get('query'):
        filter_sql += " AND (LOWER(d.question) LIKE ? ESCAPE '!' OR LOWER(COALESCE(d.recommendation,'')) LIKE ? ESCAPE '!')"
        term=like_term(request['query']); params.extend([term,term])
    total=scalar('SELECT COUNT(*) FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql, params)
    output={'count':total, 'items':rows(decision_select+' FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql+' ORDER BY CASE WHEN d.deadline IS NULL THEN 1 ELSE 0 END, d.deadline, d.updated_at DESC LIMIT ? OFFSET ?', params+[limit,offset])}
elif operation == 'decision':
    filter_sql="d.decision_id=? AND d.source_board != ? AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    params=[request['id'],private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    found=rows(decision_select+' FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql, params)
    output={'item':found[0] if found else None}
elif operation == 'topics':
    limit,offset=pagination()
    filter_sql=public_topic; params=list(public_topic_params)
    if request.get('owner'):
        filter_sql += ' AND owner_agent=?'; params.append(request['owner'])
    if request.get('state'):
        filter_sql += ' AND current_state=?'; params.append(request['state'])
    if request.get('query'):
        filter_sql += " AND (LOWER(title) LIKE ? ESCAPE '!' OR LOWER(COALESCE(business_goal,'')) LIKE ? ESCAPE '!')"
        term=like_term(request['query']); params.extend([term,term])
    total=scalar('SELECT COUNT(*) FROM management_topics WHERE '+filter_sql, params)
    output={'count':total, 'items':rows('SELECT * FROM management_topics WHERE '+filter_sql+' ORDER BY COALESCE(last_substantive_progress_at,0) DESC, title LIMIT ? OFFSET ?', params+[limit,offset])}
elif operation == 'topic':
    found=rows('SELECT * FROM management_topics WHERE topic_id=? AND '+public_topic, [request['id']]+public_topic_params)
    output={'item':found[0] if found else None}
elif operation == 'departments':
    department_sql=(
      "SELECT b.*, "
      "json_array_length(b.active_topic_refs_json) AS active_topic_count, "
      "json_array_length(b.outcomes_json) AS outcome_count, "
      "json_array_length(b.needs_management_json) AS decision_count, "
      "json_array_length(b.risks_json) AS risk_count "
      "FROM agent_briefs b WHERE 1=1 __AGENT_FILTER__ "
      "ORDER BY CASE b.agent_id "
      "WHEN 'Rhajaina' THEN 1 WHEN 'Felix' THEN 2 WHEN 'Anja' THEN 3 "
      "WHEN 'Viki' THEN 4 WHEN 'Cori' THEN 5 WHEN 'DevOps' THEN 6 "
      "WHEN 'Infrastructure' THEN 7 ELSE 99 END, b.agent_id"
    )
    department_params=[]
    if request.get('id'):
        department_sql=department_sql.replace('__AGENT_FILTER__', 'AND LOWER(b.agent_id)=LOWER(?)')
        department_params.append(request['id'])
    else:
        department_sql=department_sql.replace('__AGENT_FILTER__', '')
    found=rows(department_sql, department_params)
    output={'item':found[0] if request.get('id') and found else None, 'items':found if not request.get('id') else []}
elif operation in ('outcome', 'outcomes'):
    limit,offset=pagination()
    filter_sql="o.source_board != ? AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    params=[private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    if operation == 'outcome':
        filter_sql='o.outcome_id=? AND '+filter_sql; params=[request['id']]+params
        found=rows('SELECT o.* FROM outcomes o LEFT JOIN management_topics t ON t.topic_id=o.topic_id WHERE '+filter_sql, params)
        output={'item':found[0] if found else None}
    else:
        total=scalar('SELECT COUNT(*) FROM outcomes o LEFT JOIN management_topics t ON t.topic_id=o.topic_id WHERE '+filter_sql, params)
        output={'count':total, 'items':rows('SELECT o.* FROM outcomes o LEFT JOIN management_topics t ON t.topic_id=o.topic_id WHERE '+filter_sql+' ORDER BY o.occurred_at DESC LIMIT ? OFFSET ?', params+[limit,offset])}
elif operation in ('risk', 'risks'):
    limit,offset=pagination()
    filter_sql=open_decision+" AND d.source_board != ? AND (d.decision_class='scope_violation' OR d.classifier_label='RISK_ESCALATION') AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    params=[private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    if operation == 'risk':
        filter_sql='d.decision_id=? AND '+filter_sql; params=[request['id']]+params
        found=rows('SELECT d.* FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql, params)
        output={'item':found[0] if found else None}
    else:
        total=scalar('SELECT COUNT(*) FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql, params)
        output={'count':total, 'items':rows('SELECT d.* FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql+' ORDER BY d.updated_at DESC LIMIT ? OFFSET ?', params+[limit,offset])}
elif operation in ('wakeup', 'wakeups'):
    limit,offset=pagination()
    params=[private_board]
    if operation == 'wakeup':
        found=rows('SELECT * FROM wakeups WHERE wakeup_id=? AND source_board != ?', [request['id']]+params)
        output={'item':found[0] if found else None}
    else:
        total=scalar('SELECT COUNT(*) FROM wakeups WHERE source_board != ?', params)
        output={'count':total, 'items':rows('SELECT * FROM wakeups WHERE source_board != ? ORDER BY wake_at LIMIT ? OFFSET ?', params+[limit,offset])}
elif operation == 'digest':
    limit,offset=pagination()
    filter_sql="d.source_board != ? AND (t.topic_id IS NULL OR ("+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
    params=[private_board]+private_sensitivities+['%"board":"'+private_board+'"%']
    if request.get('query'):
        filter_sql += " AND (LOWER(d.signal) LIKE ? ESCAPE '!' OR LOWER(d.category) LIKE ? ESCAPE '!')"
        term=like_term(request['query']); params.extend([term,term])
    total=scalar('SELECT COUNT(*) FROM digest_items d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql, params)
    output={'count':total, 'items':rows('SELECT d.* FROM digest_items d LEFT JOIN management_topics t ON t.topic_id=d.topic_id WHERE '+filter_sql+' ORDER BY d.observed_at DESC, d.digest_id LIMIT ? OFFSET ?', params+[limit,offset])}
elif operation == 'telemetry':
    label_rows=rows('SELECT label,COUNT(*) AS count FROM classification_audit WHERE source_board != ? GROUP BY label ORDER BY label', [private_board])
    board=con.execute('SELECT COUNT(*), COALESCE(SUM(source_count),0), COALESCE(MAX(projected_at),0) FROM projection_boards WHERE board != ?', (private_board,)).fetchone()
    output={'classification':{row['label']:row['count'] for row in label_rows}, 'boardCount':board[0], 'sourceCount':board[1], 'projectedAt':board[2]}
else:
    raise RuntimeError('unknown management read operation')
print(json.dumps(output, ensure_ascii=False))
`;

function parseJsonFields(row) {
  const parsed = { ...row };
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.endsWith('_json')) continue;
    const outputKey = key.slice(0, -5);
    try {
      parsed[outputKey] = JSON.parse(value || 'null');
    } catch (_) {
      parsed[outputKey] = null;
    }
    delete parsed[key];
  }
  return parsed;
}

function normalizeResult(value) {
  if (Array.isArray(value)) return value.map(normalizeResult);
  if (!value || typeof value !== 'object') return value;
  const parsed = parseJsonFields(value);
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => [key, normalizeResult(item)])
  );
}

function boundedInteger(value, fallback, maximum) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return Math.min(number, maximum);
}

class ManagementReader {
  constructor(options = {}) {
    if (!options.database) throw new Error('management database is required');
    this.database = path.resolve(options.database);
    this.pythonBin = options.pythonBin || 'python3';
  }

  read(operation, options = {}) {
    if (!fs.existsSync(this.database)) {
      const error = new Error('management_projection_unavailable');
      error.code = 'PROJECTION_UNAVAILABLE';
      throw error;
    }
    const request = {
      operation,
      database: this.database,
      id: options.id || null,
      privateBoard: PRIVATE_BOARD,
      privateSensitivities: PRIVATE_SENSITIVITIES,
      limit: boundedInteger(options.limit, 50, 100),
      offset: boundedInteger(options.offset, 0, 1000000),
      decisionClass: options.decisionClass || null,
      status: options.status || null,
      owner: options.owner || null,
      state: options.state || null,
      query: String(options.query || '').slice(0, 200),
      now: Math.floor(Date.now() / 1000),
    };
    const result = spawnSync(this.pythonBin, ['-c', PYTHON_READER], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const error = new Error(
        (result.stderr || result.stdout || 'management_read_failed').slice(0, 1000)
      );
      error.code = 'PROJECTION_READ_FAILED';
      throw error;
    }
    const output = normalizeResult(JSON.parse(result.stdout));
    if (operation === 'metadata' || operation === 'health') {
      const health = buildProjectionHealth({
        now: request.now,
        staleAfterSeconds: options.staleAfterSeconds,
        runs: output.runs,
        sources: output.sources,
      });
      if (operation === 'health') return health;
      delete output.runs;
      delete output.sources;
      output.health = health;
    }
    return output;
  }
}

module.exports = {
  ManagementReader,
  PRIVATE_BOARD,
  PRIVATE_SENSITIVITIES,
  boundedInteger,
  normalizeResult,
};
