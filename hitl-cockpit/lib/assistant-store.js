'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA_PATH = path.join(__dirname, 'assistant-schema.sql');
const SCHEMA_VERSION = 6;
const SCHEMA = fs.readFileSync(SCHEMA_PATH, 'utf8');

const PYTHON_STORE = String.raw`
import json, os, sqlite3, sys, uuid
r=json.loads(sys.stdin.read()); db=r['database']
os.makedirs(os.path.dirname(os.path.abspath(db)), mode=0o700, exist_ok=True)
flags=os.O_CREAT|os.O_WRONLY
if hasattr(os,'O_CLOEXEC'): flags|=os.O_CLOEXEC
if hasattr(os,'O_NOFOLLOW'): flags|=os.O_NOFOLLOW
fd=os.open(db,flags,0o600); os.close(fd); os.chmod(db,0o600)
con=sqlite3.connect(db,timeout=10); con.row_factory=sqlite3.Row; con.execute('PRAGMA foreign_keys=ON')
def one(q,p=()):
    row=con.execute(q,p).fetchone(); return dict(row) if row else None
def rows(q,p=()): return [dict(x) for x in con.execute(q,p).fetchall()]
def event(e): con.execute('INSERT INTO assistant_events VALUES (?,?,?,?,?)',(e['id'],e.get('conversationId'),e['eventType'],json.dumps(e.get('payload',{}),ensure_ascii=False,sort_keys=True),e['occurredAt']))
def message(m):
    cid=m.get('clientMessageId')
    if cid:
        old=one('SELECT * FROM assistant_messages WHERE client_message_id=?',(cid,))
        if old:
            if old['conversation_id']!=m['conversationId'] or old['role']!=m['role'] or old['content']!=m['content']: raise RuntimeError('client_message_id_conflict')
            return old
    con.execute('INSERT INTO assistant_messages VALUES (?,?,?,?,?,?)',(m['id'],m['conversationId'],m['role'],m['content'],cid,m['createdAt']))
    return one('SELECT * FROM assistant_messages WHERE message_id=?',(m['id'],))
version=con.execute('PRAGMA user_version').fetchone()[0]
if version>r['schemaVersion']: raise RuntimeError('assistant database schema is newer than this application')
if version<r['schemaVersion']:
    try:
        tables={x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conversation_columns={x[1] for x in con.execute('PRAGMA table_info(assistant_conversations)')} if 'assistant_conversations' in tables else set()
        run_columns={x[1] for x in con.execute('PRAGMA table_info(assistant_runs)')} if 'assistant_runs' in tables else set()
        migrations=[]
        if 'assistant_conversations' in tables and 'hermes_session_messages' not in conversation_columns: migrations.append('ALTER TABLE assistant_conversations ADD COLUMN hermes_session_messages INTEGER NOT NULL DEFAULT 0 CHECK (hermes_session_messages >= 0)')
        if 'assistant_runs' in tables and 'lease_owner' not in run_columns: migrations.append('ALTER TABLE assistant_runs ADD COLUMN lease_owner TEXT')
        if 'assistant_runs' in tables and 'lease_expires_at' not in run_columns: migrations.append('ALTER TABLE assistant_runs ADD COLUMN lease_expires_at INTEGER')
        migration=(';\n'.join(migrations)+';\n') if migrations else ''
        con.executescript('BEGIN IMMEDIATE;\n'+migration+r['schema'])
        if 'assistant_runs' in tables:
            legacy_running=rows("SELECT run_id,conversation_id,updated_at FROM assistant_runs WHERE status='running' AND (lease_owner IS NULL OR lease_expires_at IS NULL)")
            for x in legacy_running:
                c=con.execute("UPDATE assistant_runs SET status='failed',error_code='assistant_server_restarted',lease_owner=NULL,lease_expires_at=NULL WHERE run_id=? AND status='running' AND (lease_owner IS NULL OR lease_expires_at IS NULL)",(x['run_id'],))
                if c.rowcount==1: event({'id':'event_'+str(uuid.uuid4()),'conversationId':x['conversation_id'],'eventType':'run_failed','payload':{'runId':x['run_id'],'code':'assistant_server_restarted'},'occurredAt':x['updated_at']})
        if con.execute('PRAGMA user_version').fetchone()[0]!=r['schemaVersion']: raise RuntimeError('assistant database schema version mismatch')
        con.commit()
    except Exception: con.rollback(); raise
a=r['action']; out=None
if a=='initialize': out={'schemaVersion':r['schemaVersion']}
elif a=='create_conversation':
    x=r['item']
    try:
        con.execute('INSERT INTO assistant_conversations(conversation_id,object_type,object_id,hermes_session_name,hermes_session_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',(x['id'],x.get('objectType'),x.get('objectId'),x['sessionName'],x.get('sessionId'),'active',x['createdAt'],x['createdAt'])); con.commit()
    except sqlite3.IntegrityError as e:
        con.rollback()
        if 'object_type' in str(e) or 'assistant_one_active' in str(e): raise RuntimeError('active_object_conversation_exists')
        raise
    out=one('SELECT * FROM assistant_conversations WHERE conversation_id=?',(x['id'],))
elif a=='get_conversation': out=one('SELECT * FROM assistant_conversations WHERE conversation_id=?',(r['id'],))
elif a=='list_conversations': out=rows('SELECT * FROM assistant_conversations WHERE status=? ORDER BY updated_at DESC,conversation_id',(r.get('status','active'),))
elif a=='advance_session':
    con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_conversations WHERE conversation_id=?',(r['id'],))
        if not current: raise RuntimeError('conversation_not_found')
        if current['hermes_session_name']!=r['expectedSessionName'] or current['hermes_session_id']!=r.get('expectedSessionId'): raise RuntimeError('conversation_session_changed')
        message_count=1 if r.get('rotate') else current['hermes_session_messages']+1
        con.execute('UPDATE assistant_conversations SET hermes_session_name=?,hermes_session_id=?,hermes_session_messages=?,updated_at=? WHERE conversation_id=?',(r['sessionName'],r['sessionId'],message_count,r['now'],r['id']))
        out=one('SELECT * FROM assistant_conversations WHERE conversation_id=?',(r['id'],)); con.commit()
    except Exception: con.rollback(); raise
elif a=='close_conversation':
    c=con.execute("UPDATE assistant_conversations SET status='closed',updated_at=? WHERE conversation_id=? AND status='active'",(r['now'],r['id']))
    if c.rowcount!=1: raise RuntimeError('active_conversation_not_found')
    con.commit(); out={'closed':True}
elif a=='append_message':
    con.execute('BEGIN IMMEDIATE')
    try: out=message(r['item']); con.commit()
    except Exception: con.rollback(); raise
elif a=='create_run':
    x=r['run']; m=r['message']; con.execute('BEGIN IMMEDIATE')
    try:
        old=one('SELECT * FROM assistant_runs WHERE client_message_id=?',(x['clientMessageId'],))
        if old:
            existing=one('SELECT * FROM assistant_messages WHERE message_id=?',(old['user_message_id'],))
            if existing['conversation_id']!=m['conversationId'] or existing['content']!=m['content']: raise RuntimeError('client_message_id_conflict')
            out={'run':old,'message':existing,'deduplicated':True}
        else:
            saved=message(m)
            con.execute('INSERT INTO assistant_runs(run_id,conversation_id,client_message_id,user_message_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',(x['id'],x['conversationId'],x['clientMessageId'],saved['message_id'],'accepted',x['createdAt'],x['createdAt']))
            event(r['event']); out={'run':one('SELECT * FROM assistant_runs WHERE run_id=?',(x['id'],)),'message':saved,'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='recover_interrupted_runs':
    con.execute('BEGIN IMMEDIATE')
    try:
        interrupted=rows("SELECT run_id,conversation_id,status,lease_owner FROM assistant_runs WHERE (status='accepted' AND updated_at<=?) OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?) ORDER BY created_at,run_id",(r['acceptedBefore'],r['now']))
        recovered=0
        for x in interrupted:
            if x['status']=='accepted': c=con.execute("UPDATE assistant_runs SET status='failed',error_code=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE run_id=? AND status='accepted' AND updated_at<=?",(r['errorCode'],r['now'],x['run_id'],r['acceptedBefore']))
            else: c=con.execute("UPDATE assistant_runs SET status='failed',error_code=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE run_id=? AND status='running' AND lease_owner IS ? AND lease_expires_at IS NOT NULL AND lease_expires_at<=?",(r['errorCode'],r['now'],x['run_id'],x['lease_owner'],r['now']))
            if c.rowcount==1:
                recovered+=1; event({'id':'event_'+str(uuid.uuid4()),'conversationId':x['conversation_id'],'eventType':'run_failed','payload':{'runId':x['run_id'],'code':r['errorCode']},'occurredAt':r['now']})
        con.commit(); out={'recovered':recovered}
    except Exception: con.rollback(); raise
elif a=='claim_run':
    con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],))
        if not current: raise RuntimeError('run_not_found')
        if current['status']=='running':
            if current['lease_owner']==r['owner'] or (current['lease_expires_at'] is not None and current['lease_expires_at']<=r['now']):
                c=con.execute("UPDATE assistant_runs SET lease_owner=?,lease_expires_at=?,context_envelope_id=COALESCE(?,context_envelope_id),updated_at=? WHERE run_id=? AND status='running' AND (lease_owner=? OR lease_expires_at<=?)",(r['owner'],r['leaseExpiresAt'],r.get('contextEnvelopeId'),r['now'],r['id'],r['owner'],r['now']))
                out={'claimed':c.rowcount==1,'run':one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],))}
            else: out={'claimed':False,'run':current}
        elif current['status']!='accepted': out={'claimed':False,'run':current}
        elif one("SELECT run_id FROM assistant_runs WHERE conversation_id=? AND status='running' AND run_id<>?",(current['conversation_id'],r['id'])): out={'claimed':False,'run':current}
        else:
            con.execute("UPDATE assistant_runs SET status='running',context_envelope_id=?,lease_owner=?,lease_expires_at=?,updated_at=? WHERE run_id=? AND status='accepted'",(r.get('contextEnvelopeId'),r['owner'],r['leaseExpiresAt'],r['now'],r['id']))
            event(r['event']); out={'claimed':True,'run':one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],))}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='update_run':
    fields=['status=?','updated_at=?']; vals=[r['status'],r['now']]
    if r['status'] in ('completed','failed','cancelled'): fields.extend(['lease_owner=NULL','lease_expires_at=NULL'])
    for key,col in [('assistantMessageId','assistant_message_id'),('contextEnvelopeId','context_envelope_id'),('hermesSessionId','hermes_session_id'),('errorCode','error_code')]:
        if key in r: fields.append(col+'=?'); vals.append(r.get(key))
    where='run_id=? AND status=?'; vals.extend([r['id'],r['expectedStatus']])
    if r.get('expectedOwner') is not None:
        where+=' AND lease_owner=?'; vals.append(r['expectedOwner'])
        if r['status'] in ('completed','failed','cancelled'): where+=' AND lease_expires_at>?'; vals.append(r['now'])
    c=con.execute('UPDATE assistant_runs SET '+','.join(fields)+' WHERE '+where,vals)
    if c.rowcount==1 and r.get('event'): event(r['event'])
    con.commit(); out=one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],))
elif a=='complete_run':
    con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],))
        if not current or current['status']!='running': raise RuntimeError('run_not_running')
        if current['lease_owner']!=r['owner']: raise RuntimeError('run_not_owned')
        if current['lease_expires_at'] is None or current['lease_expires_at']<=r['now']: raise RuntimeError('run_lease_expired')
        session=one('SELECT * FROM assistant_conversations WHERE conversation_id=?',(r['conversationId'],))
        if not session: raise RuntimeError('conversation_not_found')
        if session['hermes_session_name']!=r['expectedSessionName'] or session['hermes_session_id']!=r.get('expectedSessionId'): raise RuntimeError('conversation_session_changed')
        saved=message(r['message'])
        message_count=1 if r.get('rotate') else session['hermes_session_messages']+1
        con.execute('UPDATE assistant_conversations SET hermes_session_name=?,hermes_session_id=?,hermes_session_messages=?,updated_at=? WHERE conversation_id=?',(r['sessionName'],r['sessionId'],message_count,r['now'],r['conversationId']))
        c=con.execute("UPDATE assistant_runs SET status='completed',assistant_message_id=?,hermes_session_id=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE run_id=? AND status='running' AND lease_owner=? AND lease_expires_at>?",(saved['message_id'],r['sessionId'],r['now'],r['id'],r['owner'],r['now']))
        if c.rowcount!=1: raise RuntimeError('run_lease_expired')
        for x in r.get('events',[]): event(x)
        out={'run':one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],)),'message':saved,'conversation':one('SELECT * FROM assistant_conversations WHERE conversation_id=?',(r['conversationId'],))}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='get_run': out=one('SELECT * FROM assistant_runs WHERE run_id=?',(r['id'],))
elif a=='get_run_client': out=one('SELECT * FROM assistant_runs WHERE client_message_id=?',(r['clientMessageId'],))
elif a=='list_pending_runs': out=rows("SELECT * FROM assistant_runs WHERE status IN ('accepted','running') ORDER BY conversation_id, CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at,run_id")
elif a=='save_context':
    x=r['item']; con.execute('INSERT INTO assistant_context_envelopes VALUES (?,?,?,?,?,?,?)',(x['id'],x['conversationId'],x.get('objectType'),x.get('objectId'),x['fingerprint'],json.dumps(x['payload'],ensure_ascii=False,sort_keys=True),x['createdAt'])); con.commit(); out={'id':x['id']}
elif a=='save_summary':
    x=r['item']; con.execute('INSERT INTO assistant_summaries VALUES (?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET content=excluded.content,through_message_id=excluded.through_message_id,message_count=excluded.message_count,updated_at=excluded.updated_at',(x['conversationId'],x['content'],x['throughMessageId'],x['messageCount'],x['updatedAt'])); con.commit(); out=one('SELECT * FROM assistant_summaries WHERE conversation_id=?',(x['conversationId'],))
elif a=='get_summary': out=one('SELECT * FROM assistant_summaries WHERE conversation_id=?',(r['conversationId'],))
elif a=='create_proposal':
    x=r['item']; payload=json.dumps(x['payload'],ensure_ascii=False,sort_keys=True,separators=(',',':')); con.execute('BEGIN IMMEDIATE')
    try:
        old=one('SELECT * FROM assistant_action_proposals WHERE idempotency_key=?',(x['idempotencyKey'],))
        if old:
            same=(old['conversation_id']==x['conversationId'] and old['message_id']==x['messageId'] and old['action_type']==x['actionType'] and old['target_type']==x.get('targetType') and old['target_id']==x.get('targetId') and old['payload_json']==payload and old['risk_class']==x['riskClass'] and old['scope_status']==x['scopeStatus'])
            if not same: raise RuntimeError('proposal_idempotency_conflict')
            out={'proposal':old,'deduplicated':True}
        else:
            con.execute('INSERT INTO assistant_action_proposals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',(x['id'],x['conversationId'],x['messageId'],x['actionType'],x.get('targetType'),x.get('targetId'),payload,x['riskClass'],x['scopeStatus'],'shadow',x['idempotencyKey'],x['createdAt'],x['createdAt']))
            event(r['event']); out={'proposal':one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['id'],)),'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='get_proposal': out=one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(r['id'],))
elif a=='get_proposal_idempotency': out=one('SELECT * FROM assistant_action_proposals WHERE idempotency_key=?',(r['idempotencyKey'],))
elif a=='list_proposals':
    clauses=[]; vals=[]
    if r.get('conversationId') is not None: clauses.append('conversation_id=?'); vals.append(r['conversationId'])
    if r.get('status') is not None: clauses.append('status=?'); vals.append(r['status'])
    where=(' WHERE '+' AND '.join(clauses)) if clauses else ''
    out=rows('SELECT * FROM assistant_action_proposals'+where+' ORDER BY created_at,proposal_id',vals)
elif a=='update_proposal_status':
    transitions={'shadow':('confirmed','rejected','expired'),'confirmed':('executing','rejected','expired'),'executing':('failed',),'executed':(),'failed':(),'rejected':(),'expired':()}
    con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(r['id'],))
        if not current: raise RuntimeError('proposal_not_found')
        if current['status']==r['status']: out={'proposal':current,'changed':False}
        else:
            if r.get('expectedStatus') is not None and current['status']!=r['expectedStatus']: raise RuntimeError('proposal_status_changed')
            if r['status'] not in transitions.get(current['status'],()): raise RuntimeError('invalid_proposal_status_transition')
            c=con.execute('UPDATE assistant_action_proposals SET status=?,updated_at=? WHERE proposal_id=? AND status=?',(r['status'],r['now'],r['id'],current['status']))
            if c.rowcount!=1: raise RuntimeError('proposal_status_changed')
            event(r['event']); out={'proposal':one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(r['id'],)),'changed':True}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='save_receipt':
    x=r['item']; readback=json.dumps(x['readback'],ensure_ascii=False,sort_keys=True,separators=(',',':')); con.execute('BEGIN IMMEDIATE')
    try:
        proposal=one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['proposalId'],))
        if not proposal: raise RuntimeError('proposal_not_found')
        old=one('SELECT * FROM assistant_action_receipts WHERE proposal_id=?',(x['proposalId'],))
        if old:
            same=(old['source_board']==x.get('sourceBoard') and old['source_task_id']==x.get('sourceTaskId') and old['matrix_room_id']==x.get('matrixRoomId') and old['matrix_event_id']==x.get('matrixEventId') and old['before_fingerprint']==x.get('beforeFingerprint') and old['after_fingerprint']==x.get('afterFingerprint') and old['readback_json']==readback and old['executed_at']==x['executedAt'])
            if not same: raise RuntimeError('proposal_receipt_conflict')
            out={'receipt':old,'proposal':proposal,'deduplicated':True}
        else:
            if proposal['status']!='executing': raise RuntimeError('proposal_not_executing')
            con.execute('INSERT INTO assistant_action_receipts VALUES (?,?,?,?,?,?,?,?,?,?)',(x['id'],x['proposalId'],x.get('sourceBoard'),x.get('sourceTaskId'),x.get('matrixRoomId'),x.get('matrixEventId'),x.get('beforeFingerprint'),x.get('afterFingerprint'),readback,x['executedAt']))
            c=con.execute("UPDATE assistant_action_proposals SET status='executed',updated_at=? WHERE proposal_id=? AND status='executing'",(x['executedAt'],x['proposalId']))
            if c.rowcount!=1: raise RuntimeError('proposal_status_changed')
            event(r['event']); out={'receipt':one('SELECT * FROM assistant_action_receipts WHERE receipt_id=?',(x['id'],)),'proposal':one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['proposalId'],)),'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='get_receipt': out=one('SELECT * FROM assistant_action_receipts WHERE receipt_id=?',(r['id'],))
elif a=='get_receipt_proposal': out=one('SELECT * FROM assistant_action_receipts WHERE proposal_id=?',(r['proposalId'],))
elif a=='append_event': event(r['item']); con.commit(); out={'id':r['item']['id']}
elif a=='append_transaction':
    con.execute('BEGIN IMMEDIATE')
    try:
        saved=[message(x) for x in r.get('messages',[])]
        for x in r.get('events',[]): event(x)
        con.commit(); out={'messages':saved,'eventCount':len(r.get('events',[]))}
    except Exception: con.rollback(); raise
elif a=='read_messages':
    limit=max(1,min(int(r.get('limit',100)),200)); cursor=r.get('cursor')
    if cursor: out=rows('SELECT * FROM assistant_messages WHERE conversation_id=? AND (created_at>? OR (created_at=? AND message_id>?)) ORDER BY created_at,message_id LIMIT ?',(r['conversationId'],cursor['createdAt'],cursor['createdAt'],cursor['id'],limit))
    else: out=rows('SELECT * FROM assistant_messages WHERE conversation_id=? ORDER BY created_at,message_id LIMIT ?',(r['conversationId'],limit))
elif a=='read_recent_messages':
    limit=max(1,min(int(r.get('limit',100)),200)); out=list(reversed(rows('SELECT * FROM assistant_messages WHERE conversation_id=? AND (created_at<? OR (created_at=? AND message_id<?)) ORDER BY created_at DESC,message_id DESC LIMIT ?',(r['conversationId'],r['beforeCreatedAt'],r['beforeCreatedAt'],r['beforeId'],limit))))
elif a=='read_message': out=one('SELECT * FROM assistant_messages WHERE message_id=?',(r['id'],))
elif a=='read_events': out=rows('SELECT * FROM assistant_events '+('WHERE conversation_id=? ' if r.get('conversationId') else '')+'ORDER BY occurred_at,event_id',((r['conversationId'],) if r.get('conversationId') else ()))
elif a=='read_context': out=one('SELECT * FROM assistant_context_envelopes WHERE context_envelope_id=?',(r['id'],))
elif a=='read_schema_metadata': out={'tables':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")],'conversationColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_conversations)')],'runColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_runs)')],'proposalColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_action_proposals)')],'eventTriggers':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='assistant_events' ORDER BY name")],'receiptTriggers':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='assistant_action_receipts' ORDER BY name")],'indexes':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")]}
else: raise RuntimeError('unknown assistant store action')
con.close(); os.chmod(db,0o600); print(json.dumps(out,ensure_ascii=False))
`;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
function conversation(row) {
  return (
    row && {
      id: row.conversation_id,
      objectType: row.object_type,
      objectId: row.object_id,
      sessionName: row.hermes_session_name,
      sessionId: row.hermes_session_id,
      sessionMessageCount: row.hermes_session_messages,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}
function message(row) {
  return (
    row && {
      id: row.message_id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      clientMessageId: row.client_message_id,
      createdAt: row.created_at,
    }
  );
}
function run(row) {
  return (
    row && {
      id: row.run_id,
      runId: row.run_id,
      conversationId: row.conversation_id,
      clientMessageId: row.client_message_id,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id,
      contextEnvelopeId: row.context_envelope_id,
      hermesSessionId: row.hermes_session_id,
      status: row.status,
      errorCode: row.error_code,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}
function summary(row) {
  return (
    row && {
      conversationId: row.conversation_id,
      content: row.content,
      throughMessageId: row.through_message_id,
      messageCount: row.message_count,
      updatedAt: row.updated_at,
    }
  );
}
function proposal(row) {
  return (
    row && {
      id: row.proposal_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      actionType: row.action_type,
      targetType: row.target_type,
      targetId: row.target_id,
      payload: JSON.parse(row.payload_json),
      riskClass: row.risk_class,
      scopeStatus: row.scope_status,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}
function receipt(row) {
  return (
    row && {
      id: row.receipt_id,
      proposalId: row.proposal_id,
      sourceBoard: row.source_board,
      sourceTaskId: row.source_task_id,
      matrixRoomId: row.matrix_room_id,
      matrixEventId: row.matrix_event_id,
      beforeFingerprint: row.before_fingerprint,
      afterFingerprint: row.after_fingerprint,
      readback: JSON.parse(row.readback_json),
      executedAt: row.executed_at,
    }
  );
}

class AssistantStore {
  constructor(options = {}) {
    if (!options.database) throw new Error('assistant database is required');
    this.database = path.resolve(options.database);
    this.pythonBin = options.pythonBin || 'python3';
  }
  #execute(action, extra = {}) {
    const result = spawnSync(this.pythonBin, ['-c', PYTHON_STORE], {
      input: JSON.stringify({
        action,
        database: this.database,
        schema: SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        ...extra,
      }),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error((result.stderr || result.stdout || 'assistant_store_failed').slice(0, 2000));
    return JSON.parse(result.stdout);
  }
  initialize() {
    return this.#execute('initialize');
  }
  createConversation(input = {}) {
    const createdAt = input.createdAt || nowSeconds();
    const cid = input.id || id('conversation');
    return conversation(
      this.#execute('create_conversation', {
        item: {
          id: cid,
          objectType: input.objectType || null,
          objectId: input.objectId || null,
          sessionName: input.sessionName || `assistant-${cid}`,
          sessionId: input.sessionId || null,
          createdAt,
        },
      })
    );
  }
  getConversation(value) {
    return conversation(this.#execute('get_conversation', { id: value }));
  }
  listConversations() {
    return this.#execute('list_conversations').map(conversation);
  }
  advanceConversationSession(input) {
    return conversation(
      this.#execute('advance_session', {
        id: input.conversationId,
        expectedSessionName: input.expectedSessionName,
        expectedSessionId: input.expectedSessionId || null,
        sessionName: input.sessionName,
        sessionId: input.sessionId,
        rotate: input.rotate === true,
        now: nowSeconds(),
      })
    );
  }
  closeConversation(value) {
    return this.#execute('close_conversation', { id: value, now: nowSeconds() });
  }
  messageItem(input) {
    return {
      id: input.id || id('message'),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      clientMessageId: input.clientMessageId || null,
      createdAt: input.createdAt || nowSeconds(),
    };
  }
  eventItem(input) {
    return {
      id: input.id || id('event'),
      conversationId: input.conversationId || null,
      eventType: input.eventType,
      payload: input.payload || {},
      occurredAt: input.occurredAt || nowSeconds(),
    };
  }
  appendMessage(input) {
    return message(this.#execute('append_message', { item: this.messageItem(input) }));
  }
  createRun(input) {
    const createdAt = input.createdAt || nowSeconds();
    const result = this.#execute('create_run', {
      message: this.messageItem({
        id: input.userMessageId,
        conversationId: input.conversationId,
        role: 'user',
        content: input.text,
        clientMessageId: input.clientMessageId,
        createdAt,
      }),
      run: {
        id: input.id || id('run'),
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId,
        createdAt,
      },
      event: this.eventItem({
        conversationId: input.conversationId,
        eventType: 'run_accepted',
        payload: { clientMessageId: input.clientMessageId },
        occurredAt: createdAt,
      }),
    });
    return {
      run: run(result.run),
      message: message(result.message),
      deduplicated: result.deduplicated,
    };
  }
  recoverInterruptedRuns(options = {}) {
    const now = options.now || nowSeconds();
    const staleAfterSeconds = Math.max(1, Number(options.staleAfterSeconds) || 300);
    return this.#execute('recover_interrupted_runs', {
      now,
      acceptedBefore: now - staleAfterSeconds,
      errorCode: options.errorCode || 'assistant_server_restarted',
    });
  }
  claimRun(value, contextEnvelopeId, options = {}) {
    const existing = this.getRun(value);
    const now = options.now || nowSeconds();
    const owner = String(options.owner || '');
    const leaseSeconds = Math.max(1, Number(options.leaseSeconds) || 300);
    if (!owner) throw new Error('lease_owner_required');
    const result = this.#execute('claim_run', {
      id: value,
      contextEnvelopeId,
      owner,
      now,
      leaseExpiresAt: now + leaseSeconds,
      event: this.eventItem({
        conversationId: existing.conversationId,
        eventType: 'run_running',
        payload: { runId: value },
      }),
    });
    return { claimed: result.claimed, run: run(result.run) };
  }
  updateRun(value, status, fields = {}) {
    const current = this.getRun(value);
    if (!current) throw new Error('run_not_found');
    return run(
      this.#execute('update_run', {
        id: value,
        status,
        now: nowSeconds(),
        expectedStatus: fields.expectedStatus || current.status,
        expectedOwner: fields.expectedOwner || null,
        ...fields,
        event: this.eventItem({
          conversationId: fields.conversationId,
          eventType: `run_${status}`,
          payload: { runId: value },
        }),
      })
    );
  }
  getRun(value) {
    return run(this.#execute('get_run', { id: value }));
  }
  getRunByClientMessageId(value) {
    return run(this.#execute('get_run_client', { clientMessageId: value }));
  }
  listPendingRuns() {
    return this.#execute('list_pending_runs').map(run);
  }
  completeRun(input) {
    const events = [
      this.eventItem({
        conversationId: input.conversationId,
        eventType: 'run_completed',
        payload: { runId: input.runId },
      }),
    ];
    if (input.rotate) {
      events.push(
        this.eventItem({
          conversationId: input.conversationId,
          eventType: 'session_rotated',
          payload: { messageCount: input.previousSessionMessageCount },
        })
      );
    }
    const result = this.#execute('complete_run', {
      id: input.runId,
      owner: input.owner,
      conversationId: input.conversationId,
      expectedSessionName: input.expectedSessionName,
      expectedSessionId: input.expectedSessionId || null,
      sessionName: input.sessionName,
      sessionId: input.sessionId,
      rotate: input.rotate === true,
      now: input.now ?? nowSeconds(),
      message: this.messageItem({
        conversationId: input.conversationId,
        role: 'assistant',
        content: input.content,
        createdAt: input.createdAt,
      }),
      events,
    });
    return {
      run: run(result.run),
      message: message(result.message),
      conversation: conversation(result.conversation),
    };
  }
  saveContextEnvelope(input) {
    const value = input.id || id('context');
    this.#execute('save_context', {
      item: {
        id: value,
        conversationId: input.conversationId,
        objectType: input.objectType || null,
        objectId: input.objectId || null,
        fingerprint: input.fingerprint,
        payload: input.payload,
        createdAt: input.createdAt || nowSeconds(),
      },
    });
    return { id: value };
  }
  saveSummary(input) {
    return summary(
      this.#execute('save_summary', {
        item: { ...input, updatedAt: input.updatedAt || nowSeconds() },
      })
    );
  }
  getSummary(conversationId) {
    return summary(this.#execute('get_summary', { conversationId }));
  }
  createProposal(input = {}) {
    const createdAt = input.createdAt || nowSeconds();
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey)
      throw new Error('proposal_idempotency_key_required');
    const result = this.#execute('create_proposal', {
      item: {
        id: input.id || id('proposal'),
        conversationId: input.conversationId,
        messageId: input.messageId,
        actionType: input.actionType,
        targetType: input.targetType || null,
        targetId: input.targetId || null,
        payload: input.payload || {},
        riskClass: input.riskClass || 'low',
        scopeStatus: input.scopeStatus || 'unknown',
        idempotencyKey: input.idempotencyKey,
        createdAt,
      },
      event: this.eventItem({
        conversationId: input.conversationId,
        eventType: 'proposal.created',
        payload: { actionType: input.actionType, idempotencyKey: input.idempotencyKey },
        occurredAt: createdAt,
      }),
    });
    return { proposal: proposal(result.proposal), deduplicated: result.deduplicated };
  }
  getProposal(value) {
    return proposal(this.#execute('get_proposal', { id: value }));
  }
  getProposalByIdempotencyKey(value) {
    return proposal(this.#execute('get_proposal_idempotency', { idempotencyKey: value }));
  }
  listProposals(options = {}) {
    return this.#execute('list_proposals', {
      conversationId: options.conversationId ?? null,
      status: options.status ?? null,
    }).map(proposal);
  }
  updateProposalStatus(value, status, options = {}) {
    const now = options.updatedAt || nowSeconds();
    const result = this.#execute('update_proposal_status', {
      id: value,
      status,
      expectedStatus: options.expectedStatus ?? null,
      now,
      event: this.eventItem({
        conversationId: options.conversationId || null,
        eventType: 'proposal.status_changed',
        payload: { proposalId: value, status },
        occurredAt: now,
      }),
    });
    return { proposal: proposal(result.proposal), changed: result.changed };
  }
  saveReceipt(input = {}) {
    const executedAt = input.executedAt || nowSeconds();
    const result = this.#execute('save_receipt', {
      item: {
        id: input.id || id('receipt'),
        proposalId: input.proposalId,
        sourceBoard: input.sourceBoard || null,
        sourceTaskId: input.sourceTaskId || null,
        matrixRoomId: input.matrixRoomId || null,
        matrixEventId: input.matrixEventId || null,
        beforeFingerprint: input.beforeFingerprint || null,
        afterFingerprint: input.afterFingerprint || null,
        readback: input.readback || {},
        executedAt,
      },
      event: this.eventItem({
        conversationId: input.conversationId || null,
        eventType: 'action.executed',
        payload: { proposalId: input.proposalId },
        occurredAt: executedAt,
      }),
    });
    return {
      receipt: receipt(result.receipt),
      proposal: proposal(result.proposal),
      deduplicated: result.deduplicated,
    };
  }
  getReceipt(value) {
    return receipt(this.#execute('get_receipt', { id: value }));
  }
  getReceiptByProposalId(value) {
    return receipt(this.#execute('get_receipt_proposal', { proposalId: value }));
  }
  appendEvent(input) {
    return this.#execute('append_event', { item: this.eventItem(input) });
  }
  appendTransaction(input = {}) {
    return this.#execute('append_transaction', {
      messages: (input.messages || []).map((x) => this.messageItem(x)),
      events: (input.events || []).map((x) => this.eventItem(x)),
    });
  }
  getSchemaMetadata() {
    return this.#execute('read_schema_metadata');
  }
  getContextEnvelope(value) {
    return this.#execute('read_context', { id: value });
  }
  listMessages(conversationId, options = {}) {
    return this.#execute('read_messages', {
      conversationId,
      limit: options.limit || 200,
      cursor: options.cursor || null,
    }).map(message);
  }
  getMessageById(value) {
    return message(this.#execute('read_message', { id: value }));
  }
  listRecentMessages(conversationId, options = {}) {
    return this.#execute('read_recent_messages', {
      conversationId,
      limit: options.limit || 50,
      beforeCreatedAt: options.beforeCreatedAt,
      beforeId: options.beforeId,
    }).map(message);
  }
  listEvents(conversationId = null) {
    return this.#execute('read_events', { conversationId });
  }
}

module.exports = { AssistantStore, SCHEMA_PATH, SCHEMA_VERSION };
