'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA_PATH = path.join(__dirname, 'assistant-schema.sql');
const SCHEMA_VERSION = 10;
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
def finish_result_operation(r):
    op=r.get('operation')
    if not op: raise RuntimeError('result_operation_required')
    c=con.execute("UPDATE assistant_result_operations SET status='applied',receipt_json=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE operation_id=? AND lease_owner=? AND lease_expires_at>? AND status<>'applied'",(json.dumps(op['receipt'],sort_keys=True),op['now'],op['id'],op['owner'],op['now']))
    if c.rowcount!=1: raise RuntimeError('result_operation_lease_lost')
version=con.execute('PRAGMA user_version').fetchone()[0]
if version>r['schemaVersion']: raise RuntimeError('assistant database schema is newer than this application')
if version<r['schemaVersion']:
    try:
        tables={x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conversation_columns={x[1] for x in con.execute('PRAGMA table_info(assistant_conversations)')} if 'assistant_conversations' in tables else set()
        run_columns={x[1] for x in con.execute('PRAGMA table_info(assistant_runs)')} if 'assistant_runs' in tables else set()
        reconciliation_columns={x[1] for x in con.execute('PRAGMA table_info(assistant_reconciliation_items)')} if 'assistant_reconciliation_items' in tables else set()
        migrations=[]
        if 'assistant_conversations' in tables and 'hermes_session_messages' not in conversation_columns: migrations.append('ALTER TABLE assistant_conversations ADD COLUMN hermes_session_messages INTEGER NOT NULL DEFAULT 0 CHECK (hermes_session_messages >= 0)')
        if 'assistant_runs' in tables and 'lease_owner' not in run_columns: migrations.append('ALTER TABLE assistant_runs ADD COLUMN lease_owner TEXT')
        if 'assistant_runs' in tables and 'lease_expires_at' not in run_columns: migrations.append('ALTER TABLE assistant_runs ADD COLUMN lease_expires_at INTEGER')
        if 'assistant_reconciliation_items' in tables and 'lease_owner' not in reconciliation_columns: migrations.append('ALTER TABLE assistant_reconciliation_items ADD COLUMN lease_owner TEXT')
        if 'assistant_reconciliation_items' in tables and 'lease_expires_at' not in reconciliation_columns: migrations.append('ALTER TABLE assistant_reconciliation_items ADD COLUMN lease_expires_at INTEGER')
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
            same=(old['source_board']==x.get('sourceBoard') and old['source_task_id']==x.get('sourceTaskId') and old['matrix_room_id']==x.get('matrixRoomId') and old['matrix_event_id']==x.get('matrixEventId') and old['before_fingerprint']==x.get('beforeFingerprint') and old['after_fingerprint']==x.get('afterFingerprint') and old['readback_json']==readback)
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
elif a=='start_reconciliation':
    x=r['item']; details=json.dumps(x.get('details',{}),ensure_ascii=False,sort_keys=True,separators=(',',':')); con.execute('BEGIN IMMEDIATE')
    try:
        p=one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['proposalId'],))
        if not p: raise RuntimeError('proposal_not_found')
        old=one("SELECT * FROM assistant_reconciliation_items WHERE proposal_id=? AND stage='kanban'",(x['proposalId'],))
        if old: out={'item':old,'proposal':p,'deduplicated':True}
        else:
            if p['status']=='shadow':
                c=con.execute("UPDATE assistant_action_proposals SET status='executing',updated_at=? WHERE proposal_id=? AND status='shadow'",(x['createdAt'],x['proposalId']))
                if c.rowcount!=1: raise RuntimeError('proposal_status_changed')
            elif p['status']!='executing': raise RuntimeError('proposal_not_confirmable')
            con.execute('INSERT INTO assistant_reconciliation_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(x['id'],x['proposalId'],'kanban','pending',0,x['nextAttemptAt'],None,x.get('expectedFingerprint'),None,None,x['owner'],details,None,None,None,x['createdAt'],x['createdAt']))
            y=r['event']; con.execute('INSERT INTO assistant_reconciliation_events VALUES (?,?,?,?,?)',(y['id'],x['id'],y['eventType'],json.dumps(y.get('payload',{}),ensure_ascii=False,sort_keys=True),y['occurredAt']))
            event(r['proposalEvent']); out={'item':one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(x['id'],)),'proposal':one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['proposalId'],)),'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='create_reconciliation':
    x=r['item']; details=json.dumps(x.get('details',{}),ensure_ascii=False,sort_keys=True,separators=(',',':')); con.execute('BEGIN IMMEDIATE')
    try:
        old=one('SELECT * FROM assistant_reconciliation_items WHERE proposal_id=? AND stage=?',(x['proposalId'],x['stage']))
        if old: out={'item':old,'deduplicated':True}
        else:
            con.execute('INSERT INTO assistant_reconciliation_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(x['id'],x['proposalId'],x['stage'],x['status'],0,x['nextAttemptAt'],x.get('lastErrorCode'),x.get('expectedFingerprint'),x.get('matrixRoomId'),x.get('matrixEventId'),x['owner'],details,None,None,None,x['createdAt'],x['createdAt']))
            y=r['event']; con.execute('INSERT INTO assistant_reconciliation_events VALUES (?,?,?,?,?)',(y['id'],x['id'],y['eventType'],json.dumps(y.get('payload',{}),ensure_ascii=False,sort_keys=True),y['occurredAt']))
            out={'item':one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(x['id'],)),'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='update_reconciliation':
    con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(r['id'],))
        if not current: raise RuntimeError('reconciliation_not_found')
        fields=['status=?','attempt_count=?','next_attempt_at=?','last_error_code=?','updated_at=?']; vals=[r['status'],current['attempt_count']+(1 if r.get('incrementAttempt') else 0),r['nextAttemptAt'],r.get('lastErrorCode'),r['now']]
        for key,col in [('expectedFingerprint','expected_fingerprint'),('matrixRoomId','matrix_room_id'),('matrixEventId','matrix_event_id'),('owner','owner'),('escalatedAt','escalated_at')]:
            if key in r: fields.append(col+'=?'); vals.append(r.get(key))
        if 'details' in r: fields.append('details_json=?'); vals.append(json.dumps(r['details'],ensure_ascii=False,sort_keys=True,separators=(',',':')))
        if r.get('expectedLeaseOwner') is not None:
            vals.extend([r['id'],r['expectedLeaseOwner'],r['now']]); lease='' if r.get('keepLease') else ',lease_owner=NULL,lease_expires_at=NULL'; c=con.execute('UPDATE assistant_reconciliation_items SET '+','.join(fields)+lease+' WHERE id=? AND lease_owner=? AND lease_expires_at>?',vals)
            if c.rowcount!=1: raise RuntimeError('reconciliation_lease_lost')
        else:
            vals.append(r['id']); con.execute('UPDATE assistant_reconciliation_items SET '+','.join(fields)+' WHERE id=?',vals)
        y=r['event']; con.execute('INSERT INTO assistant_reconciliation_events VALUES (?,?,?,?,?)',(y['id'],r['id'],y['eventType'],json.dumps(y.get('payload',{}),ensure_ascii=False,sort_keys=True),y['occurredAt']))
        con.commit(); out=one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(r['id'],))
    except Exception: con.rollback(); raise
elif a=='get_reconciliation': out=one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(r['id'],))
elif a=='claim_reconciliation':
    con.execute('BEGIN IMMEDIATE')
    try:
        c=con.execute("UPDATE assistant_reconciliation_items SET lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND status NOT IN ('resolved','cancelled') AND (lease_owner IS NULL OR lease_expires_at<=? OR lease_owner=?)",(r['owner'],r['leaseExpiresAt'],r['now'],r['id'],r['now'],r['owner']))
        out={'claimed':c.rowcount==1,'item':one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(r['id'],))}; con.commit()
    except Exception: con.rollback(); raise
elif a=='finalize_reconciliation':
    x=r['item']; readback=json.dumps(x['readback'],ensure_ascii=False,sort_keys=True,separators=(',',':')); con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_reconciliation_items WHERE id=?',(r['reconciliationId'],))
        if not current or current['lease_owner']!=r.get('owner') or current['lease_expires_at'] is None or current['lease_expires_at']<=x['executedAt']: raise RuntimeError('reconciliation_lease_lost')
        old=one('SELECT * FROM assistant_action_receipts WHERE proposal_id=?',(x['proposalId'],))
        if old:
            same=(old['source_board']==x.get('sourceBoard') and old['source_task_id']==x.get('sourceTaskId') and old['matrix_room_id']==x.get('matrixRoomId') and old['matrix_event_id']==x.get('matrixEventId') and old['before_fingerprint']==x.get('beforeFingerprint') and old['after_fingerprint']==x.get('afterFingerprint') and old['readback_json']==readback)
            if not same: raise RuntimeError('proposal_receipt_conflict')
        else:
            con.execute('INSERT INTO assistant_action_receipts VALUES (?,?,?,?,?,?,?,?,?,?)',(x['id'],x['proposalId'],x.get('sourceBoard'),x.get('sourceTaskId'),x.get('matrixRoomId'),x.get('matrixEventId'),x.get('beforeFingerprint'),x.get('afterFingerprint'),readback,x['executedAt']))
            event(r['receiptEvent'])
        con.execute("UPDATE assistant_action_proposals SET status='executed',updated_at=? WHERE proposal_id=? AND status IN ('executing','executed')",(x['executedAt'],x['proposalId']))
        con.execute("UPDATE assistant_reconciliation_items SET status='resolved',next_attempt_at=?,last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE proposal_id=? AND status NOT IN ('resolved','cancelled')",(x['executedAt'],x['executedAt'],x['proposalId']))
        for y in r['events']: con.execute('INSERT INTO assistant_reconciliation_events VALUES (?,?,?,?,?)',(y['id'],y['reconciliationId'],y['eventType'],json.dumps(y.get('payload',{}),ensure_ascii=False,sort_keys=True),y['occurredAt']))
        if r.get('auditEvent'): event(r['auditEvent'])
        out={'receipt':one('SELECT * FROM assistant_action_receipts WHERE proposal_id=?',(x['proposalId'],)),'proposal':one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['proposalId'],)),'deduplicated':old is not None}; con.commit()
    except Exception: con.rollback(); raise
elif a=='get_reconciliation_stage': out=one('SELECT * FROM assistant_reconciliation_items WHERE proposal_id=? AND stage=?',(r['proposalId'],r['stage']))
elif a=='list_reconciliation':
    clauses=[]; vals=[]
    if not r.get('includeClosed'): clauses.append("status NOT IN ('resolved','cancelled')")
    if r.get('dueBefore') is not None: clauses.append('next_attempt_at<=?'); vals.append(r['dueBefore'])
    where=(' WHERE '+' AND '.join(clauses)) if clauses else ''
    out=rows('SELECT * FROM assistant_reconciliation_items'+where+' ORDER BY next_attempt_at,created_at,id',vals)
elif a=='list_reconciliation_events': out=rows('SELECT * FROM assistant_reconciliation_events WHERE reconciliation_id=? ORDER BY occurred_at,event_id',(r['id'],))
elif a=='bind_handoff':
    x=r['item']; con.execute('BEGIN IMMEDIATE')
    try:
        old=one('SELECT * FROM assistant_handoff_bindings WHERE proposal_id=?',(x['proposalId'],))
        if old and (old['responsible_agent']!=x['responsibleAgent'] or old['expected_sender']!=x['expectedSender']): raise RuntimeError('handoff_binding_conflict')
        if not old: con.execute('INSERT INTO assistant_handoff_bindings VALUES (?,?,?,?)',(x['proposalId'],x['responsibleAgent'],x['expectedSender'],x['createdAt']))
        con.commit(); out=one('SELECT * FROM assistant_handoff_bindings WHERE proposal_id=?',(x['proposalId'],))
    except Exception: con.rollback(); raise
elif a=='get_handoff_binding': out=one('SELECT * FROM assistant_handoff_bindings WHERE proposal_id=?',(r['id'],))
elif a=='start_result_operation':
    x=r['item']; con.execute('BEGIN IMMEDIATE')
    try:
        current=one('SELECT * FROM assistant_results WHERE result_id=?',(x['resultId'],))
        if not current: raise RuntimeError('result_not_found')
        old=one('SELECT * FROM assistant_result_operations WHERE request_id=?',(x['requestId'],))
        audit=json.dumps(x['audit'],sort_keys=True,separators=(',',':'))
        if old:
            if old['result_id']!=x['resultId'] or old['action']!=x['action'] or old['instruction']!=x['instruction'] or old['audit_json']!=audit: raise RuntimeError('result_operation_request_conflict')
            out=old
        else:
            if current['operator_decision'] in ('accept','end','reject'): raise RuntimeError('result_already_decided')
            if one("SELECT operation_id FROM assistant_result_operations WHERE result_id=? AND status<>'applied'",(x['resultId'],)): raise RuntimeError('result_operation_pending')
            con.execute("INSERT INTO assistant_result_operations VALUES (?,?,?,?,?,?,?,'result_pending',0,NULL,NULL,NULL,?,?)",(x['id'],x['resultId'],x['action'],x['requestId'],x['idempotencyKey'],x['instruction'],audit,x['createdAt'],x['createdAt']))
            event(r['event']); out=one('SELECT * FROM assistant_result_operations WHERE operation_id=?',(x['id'],))
        con.commit()
    except Exception: con.rollback(); raise
elif a=='list_result_operations': out=rows("SELECT * FROM assistant_result_operations WHERE status<>'applied' ORDER BY created_at,operation_id")
elif a=='claim_result_operation':
    con.execute('BEGIN IMMEDIATE')
    try:
        c=con.execute("UPDATE assistant_result_operations SET lease_owner=?,lease_expires_at=?,updated_at=? WHERE operation_id=? AND status<>'applied' AND (lease_owner IS NULL OR lease_expires_at<=?)",(r['owner'],r['expiresAt'],r['now'],r['id'],r['now']))
        out={'claimed':c.rowcount==1,'item':one('SELECT * FROM assistant_result_operations WHERE operation_id=?',(r['id'],))}; con.commit()
    except Exception: con.rollback(); raise
elif a=='result_operation_write_started':
    c=con.execute("UPDATE assistant_result_operations SET write_started=1,updated_at=? WHERE operation_id=? AND lease_owner=? AND lease_expires_at>? AND status<>'applied'",(r['now'],r['id'],r['owner'],r['now']))
    if c.rowcount!=1: raise RuntimeError('result_operation_lease_lost')
    con.commit(); out={'started':True}
elif a=='result_operation_unknown':
    con.execute("UPDATE assistant_result_operations SET status='write_unknown',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE operation_id=? AND lease_owner=?",(r['now'],r['id'],r['owner'])); con.commit(); out={'pending':True}
elif a=='save_result':
    x=r['item']; con.execute('BEGIN IMMEDIATE')
    try:
        p=one('SELECT * FROM assistant_action_proposals WHERE proposal_id=?',(x['proposalId'],))
        if not p: raise RuntimeError('proposal_not_found')
        old=one('SELECT * FROM assistant_results WHERE source_kind=? AND source_event_id=?',(x['sourceKind'],x.get('sourceEventId'))) if x.get('sourceEventId') else None
        if not old: old=one('SELECT * FROM assistant_results WHERE proposal_id=? AND occurred_at=? AND statement=?',(x['proposalId'],x['occurredAt'],x['statement']))
        if old:
            out={'result':old,'message':one('SELECT * FROM assistant_messages WHERE message_id=?',(old['reply_message_id'],)) if old['reply_message_id'] else None,'deduplicated':True}
        else:
            con.execute('INSERT INTO assistant_results(result_id,proposal_id,conversation_id,parent_result_id,source_board,source_task_id,source_kind,source_event_id,result_status,statement,evidence_refs_json,next_step,responsible_agent,occurred_at,outcome_candidate_json,management_decision_json,correlation_status,verification_status,operator_decision,kanban_readback_json,reply_message_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(x['id'],x['proposalId'],p['conversation_id'],x.get('parentResultId'),x['sourceBoard'],x['sourceTaskId'],x['sourceKind'],x.get('sourceEventId'),x['resultStatus'],x['statement'],json.dumps(x.get('evidenceRefs',[]),ensure_ascii=False,sort_keys=True),x.get('nextStep'),x['responsibleAgent'],x['occurredAt'],json.dumps(x.get('outcomeCandidate'),ensure_ascii=False,sort_keys=True) if x.get('outcomeCandidate') is not None else None,json.dumps(x.get('managementDecision'),ensure_ascii=False,sort_keys=True) if x.get('managementDecision') is not None else None,x['correlationStatus'],x['verificationStatus'],None,json.dumps(x.get('kanbanReadback'),ensure_ascii=False,sort_keys=True) if x.get('kanbanReadback') is not None else None,None,x['createdAt'],x['createdAt']))
            saved=None
            if r.get('reply'):
                saved=message(r['reply'])
                con.execute('UPDATE assistant_results SET reply_message_id=? WHERE result_id=?',(saved['message_id'],x['id']))
            event(r['event']); out={'result':one('SELECT * FROM assistant_results WHERE result_id=?',(x['id'],)),'message':saved,'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='get_result': out=one('SELECT * FROM assistant_results WHERE result_id=?',(r['id'],))
elif a=='list_results':
    clauses=[]; vals=[]
    if r.get('conversationId') is not None: clauses.append('conversation_id=?'); vals.append(r['conversationId'])
    if r.get('proposalId') is not None: clauses.append('proposal_id=?'); vals.append(r['proposalId'])
    where=(' WHERE '+' AND '.join(clauses)) if clauses else ''
    out=rows('SELECT * FROM assistant_results'+where+' ORDER BY created_at,result_id',vals)
elif a=='decide_result':
    con.execute('BEGIN IMMEDIATE')
    try:
        finish_result_operation(r)
        current=one('SELECT * FROM assistant_results WHERE result_id=?',(r['id'],))
        if not current: raise RuntimeError('result_not_found')
        if current['operator_decision'] in ('accept','end','reject'):
            if current['operator_decision']!=r['decision']: raise RuntimeError('result_already_decided')
            out={'result':current,'changed':False}
        else:
            c=con.execute("UPDATE assistant_results SET operator_decision=?,verification_status=?,kanban_readback_json=?,updated_at=? WHERE result_id=? AND (operator_decision IS NULL OR operator_decision IN ('correct','continue'))",(r['decision'],r['verificationStatus'],json.dumps(r.get('kanbanReadback'),ensure_ascii=False,sort_keys=True) if r.get('kanbanReadback') is not None else current['kanban_readback_json'],r['now'],r['id']))
            if c.rowcount!=1: raise RuntimeError('result_already_decided')
            event(r['event']); out={'result':one('SELECT * FROM assistant_results WHERE result_id=?',(r['id'],)),'changed':True}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='create_result_round':
    x=r['item']; con.execute('BEGIN IMMEDIATE')
    try:
        finish_result_operation(r)
        old=one('SELECT * FROM assistant_result_rounds WHERE request_id=?',(x['requestId'],))
        if old:
            if old['result_id']!=x['resultId'] or old['action']!=x['action'] or old['instruction']!=x['instruction'] or old['source_board']!=x['sourceBoard'] or old['source_task_id']!=x['sourceTaskId']: raise RuntimeError('result_round_request_conflict')
            out={'round':old,'deduplicated':True}
        else:
            current=one('SELECT * FROM assistant_results WHERE result_id=?',(x['resultId'],))
            if not current: raise RuntimeError('result_not_found')
            if current['operator_decision'] in ('accept','end','reject'): raise RuntimeError('result_already_decided')
            number=one('SELECT COALESCE(MAX(round_number),0)+1 AS n FROM assistant_result_rounds WHERE result_id=?',(x['resultId'],))['n']
            parent=one('SELECT round_id FROM assistant_result_rounds WHERE result_id=? ORDER BY round_number DESC LIMIT 1',(x['resultId'],))
            con.execute('INSERT INTO assistant_result_rounds VALUES (?,?,?,?,?,?,?,?,?,?,?)',(x['id'],x['resultId'],parent['round_id'] if parent else None,number,x['action'],x['instruction'],x['sourceBoard'],x['sourceTaskId'],x['linkedTaskId'],x['requestId'],x['createdAt']))
            con.execute('UPDATE assistant_results SET operator_decision=?,verification_status=?,updated_at=? WHERE result_id=?',(x['action'],'corrected' if x['action']=='correct' else 'continued',x['createdAt'],x['resultId']))
            event(r['event']); out={'round':one('SELECT * FROM assistant_result_rounds WHERE round_id=?',(x['id'],)),'deduplicated':False}
        con.commit()
    except Exception: con.rollback(); raise
elif a=='list_result_rounds': out=rows('SELECT * FROM assistant_result_rounds WHERE result_id=? ORDER BY round_number,round_id',(r['resultId'],))
elif a=='get_result_round_request': out=one('SELECT * FROM assistant_result_rounds WHERE request_id=?',(r['requestId'],))
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
elif a=='read_schema_metadata': out={'tables':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")],'conversationColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_conversations)')],'runColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_runs)')],'proposalColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_action_proposals)')],'resultColumns':[x[1] for x in con.execute('PRAGMA table_info(assistant_results)')],'eventTriggers':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='assistant_events' ORDER BY name")],'receiptTriggers':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='assistant_action_receipts' ORDER BY name")],'indexes':[x[0] for x in con.execute("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")]}
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
function reconciliation(row) {
  return (
    row && {
      id: row.id,
      proposalId: row.proposal_id,
      stage: row.stage,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      lastErrorCode: row.last_error_code,
      expectedFingerprint: row.expected_fingerprint,
      matrixRoomId: row.matrix_room_id,
      matrixEventId: row.matrix_event_id,
      owner: row.owner,
      details: JSON.parse(row.details_json),
      escalatedAt: row.escalated_at,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}

function assistantResult(row) {
  return (
    row && {
      id: row.result_id,
      proposalId: row.proposal_id,
      conversationId: row.conversation_id,
      parentResultId: row.parent_result_id,
      sourceBoard: row.source_board,
      sourceTaskId: row.source_task_id,
      sourceKind: row.source_kind,
      sourceEventId: row.source_event_id,
      status: row.result_status,
      statement: row.statement,
      evidenceRefs: JSON.parse(row.evidence_refs_json || '[]'),
      nextStep: row.next_step,
      responsibleAgent: row.responsible_agent,
      occurredAt: row.occurred_at,
      outcomeCandidate: row.outcome_candidate_json ? JSON.parse(row.outcome_candidate_json) : null,
      managementDecision: row.management_decision_json
        ? JSON.parse(row.management_decision_json)
        : null,
      correlationStatus: row.correlation_status,
      verificationStatus: row.verification_status,
      operatorDecision: row.operator_decision,
      kanbanReadback: row.kanban_readback_json ? JSON.parse(row.kanban_readback_json) : null,
      verificationReceipt: row.kanban_readback_json
        ? JSON.parse(row.kanban_readback_json).verificationReceipt || null
        : null,
      replyMessageId: row.reply_message_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );
}

function resultRound(row) {
  return (
    row && {
      id: row.round_id,
      resultId: row.result_id,
      parentRoundId: row.parent_round_id,
      roundNumber: row.round_number,
      action: row.action,
      instruction: row.instruction,
      sourceBoard: row.source_board,
      sourceTaskId: row.source_task_id,
      linkedTaskId: row.linked_task_id,
      requestId: row.request_id,
      createdAt: row.created_at,
    }
  );
}

function resultOperation(row) {
  return (
    row && {
      id: row.operation_id,
      resultId: row.result_id,
      action: row.action,
      requestId: row.request_id,
      idempotencyKey: row.idempotency_key,
      instruction: row.instruction,
      audit: JSON.parse(row.audit_json),
      status: row.status,
      writeStarted: Boolean(row.write_started),
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null,
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
  createReconciliation(input = {}) {
    const createdAt = input.createdAt || nowSeconds();
    const result = this.#execute('create_reconciliation', {
      item: {
        id: input.id || id('reconciliation'),
        proposalId: input.proposalId,
        stage: input.stage,
        status: input.status || 'pending',
        nextAttemptAt: input.nextAttemptAt || createdAt,
        lastErrorCode: input.lastErrorCode || null,
        expectedFingerprint: input.expectedFingerprint || null,
        matrixRoomId: input.matrixRoomId || null,
        matrixEventId: input.matrixEventId || null,
        owner: input.owner || 'Rhajaina',
        details: input.details || {},
        createdAt,
      },
      event: {
        id: id('reconciliation_event'),
        eventType: 'created',
        payload: {},
        occurredAt: createdAt,
      },
    });
    return { item: reconciliation(result.item), deduplicated: result.deduplicated };
  }
  startReconciliation(input = {}) {
    const createdAt = input.createdAt || nowSeconds();
    const item = {
      id: input.id || id('reconciliation'),
      proposalId: input.proposalId,
      owner: input.owner || 'Rhajaina',
      nextAttemptAt: input.nextAttemptAt || createdAt,
      expectedFingerprint: input.expectedFingerprint || null,
      details: input.details || {},
      createdAt,
    };
    const result = this.#execute('start_reconciliation', {
      item,
      event: {
        id: id('reconciliation_event'),
        eventType: 'created',
        payload: {},
        occurredAt: createdAt,
      },
      proposalEvent: this.eventItem({
        conversationId: input.conversationId,
        eventType: 'proposal.execution_started',
        payload: { proposalId: input.proposalId, reconciliationId: item.id },
        occurredAt: createdAt,
      }),
    });
    return {
      item: reconciliation(result.item),
      proposal: proposal(result.proposal),
      deduplicated: result.deduplicated,
    };
  }
  updateReconciliation(value, status, options = {}) {
    const now = options.now || nowSeconds();
    const optional = {};
    for (const key of [
      'expectedFingerprint',
      'matrixRoomId',
      'matrixEventId',
      'owner',
      'escalatedAt',
      'details',
    ]) {
      if (Object.hasOwn(options, key)) optional[key] = options[key];
    }
    return reconciliation(
      this.#execute('update_reconciliation', {
        id: value,
        status,
        nextAttemptAt: options.nextAttemptAt ?? now,
        lastErrorCode: options.lastErrorCode || null,
        keepLease: options.keepLease === true,
        incrementAttempt: options.incrementAttempt === true,
        expectedLeaseOwner: options.expectedLeaseOwner ?? null,
        now,
        ...optional,
        event: {
          id: id('reconciliation_event'),
          eventType: options.eventType || `status.${status}`,
          payload: options.eventPayload || {},
          occurredAt: now,
        },
      })
    );
  }
  getReconciliation(value) {
    return reconciliation(this.#execute('get_reconciliation', { id: value }));
  }
  claimReconciliation(value, options = {}) {
    const now = options.now || nowSeconds();
    const owner = String(options.owner || '');
    if (!owner) throw new Error('lease_owner_required');
    const result = this.#execute('claim_reconciliation', {
      id: value,
      owner,
      now,
      leaseExpiresAt: now + Math.max(1, Number(options.leaseSeconds) || 60),
    });
    return { claimed: result.claimed, item: reconciliation(result.item) };
  }
  finalizeReconciliation(input = {}) {
    const executedAt = input.executedAt || nowSeconds();
    const receiptId = input.receiptId || id('receipt');
    const result = this.#execute('finalize_reconciliation', {
      auditEvent: input.audit
        ? this.eventItem({
            conversationId: input.conversationId,
            eventType: 'reconciliation.operator_resolved',
            payload: { reconciliationId: input.reconciliationId, ...input.audit },
            occurredAt: executedAt,
          })
        : null,
      reconciliationId: input.reconciliationId,
      owner: input.owner,
      item: {
        id: receiptId,
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
      receiptEvent: this.eventItem({
        conversationId: input.conversationId,
        eventType: 'action.executed',
        payload: { proposalId: input.proposalId },
        occurredAt: executedAt,
      }),
      events: (input.reconciliationIds || []).map((reconciliationId) => ({
        id: id('reconciliation_event'),
        reconciliationId,
        eventType: 'resolved.atomically',
        payload: { receiptId },
        occurredAt: executedAt,
      })),
    });
    return {
      receipt: receipt(result.receipt),
      proposal: proposal(result.proposal),
      deduplicated: result.deduplicated,
    };
  }
  getReconciliationByStage(proposalId, stage) {
    return reconciliation(this.#execute('get_reconciliation_stage', { proposalId, stage }));
  }
  listReconciliations(options = {}) {
    return this.#execute('list_reconciliation', {
      includeClosed: options.includeClosed === true,
      dueBefore: options.dueBefore ?? null,
    }).map(reconciliation);
  }
  listReconciliationEvents(value) {
    return this.#execute('list_reconciliation_events', { id: value }).map((row) => ({
      id: row.event_id,
      reconciliationId: row.reconciliation_id,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json),
      occurredAt: row.occurred_at,
    }));
  }
  bindHandoff(input) {
    if (
      !/^[^\s\p{Cc}\p{Cf}]+$/u.test(input.responsibleAgent || '') ||
      !/^@[^\s:]+:[a-z0-9.-]+$/i.test(input.expectedSender || '')
    )
      throw new Error('handoff_binding_invalid');
    return this.#execute('bind_handoff', {
      item: { ...input, createdAt: input.createdAt || nowSeconds() },
    });
  }
  getHandoffBinding(proposalId) {
    const row = this.#execute('get_handoff_binding', { id: proposalId });
    return (
      row && {
        responsibleAgent: row.responsible_agent,
        expectedSender: row.expected_sender,
        createdAt: row.created_at,
      }
    );
  }
  startResultOperation(input) {
    return resultOperation(
      this.#execute('start_result_operation', {
        item: input,
        event: this.eventItem({
          conversationId: input.conversationId,
          eventType: 'agent_result.result_pending',
          payload: { operationId: input.id, action: input.action, ...input.audit },
          occurredAt: input.createdAt,
        }),
      })
    );
  }
  listResultOperations() {
    return this.#execute('list_result_operations').map(resultOperation);
  }
  claimResultOperation(value, { owner, now, leaseSeconds = 60 }) {
    const claimed = this.#execute('claim_result_operation', {
      id: value,
      owner,
      now,
      expiresAt: now + leaseSeconds,
    });
    return { claimed: claimed.claimed, item: resultOperation(claimed.item) };
  }
  markResultOperationStarted(value, owner, now) {
    return this.#execute('result_operation_write_started', { id: value, owner, now });
  }
  markResultOperationUnknown(value, owner, now) {
    return this.#execute('result_operation_unknown', { id: value, owner, now });
  }
  saveResult(input = {}) {
    const createdAt = input.createdAt || nowSeconds();
    const result = this.#execute('save_result', {
      item: {
        id: input.id || id('result'),
        proposalId: input.proposalId,
        parentResultId: input.parentResultId || null,
        sourceBoard: input.sourceBoard,
        sourceTaskId: input.sourceTaskId,
        sourceKind: input.sourceKind || 'matrix',
        sourceEventId: input.sourceEventId || null,
        resultStatus: input.status,
        statement: input.statement,
        evidenceRefs: input.evidenceRefs || [],
        nextStep: input.nextStep || null,
        responsibleAgent: input.responsibleAgent,
        occurredAt: input.occurredAt,
        outcomeCandidate: input.outcomeCandidate || null,
        managementDecision: input.managementDecision || null,
        correlationStatus: input.correlationStatus || 'verified',
        verificationStatus: input.verificationStatus || 'awaiting_acceptance',
        kanbanReadback: input.kanbanReadback
          ? { ...input.kanbanReadback, verificationReceipt: input.verificationReceipt || null }
          : null,
        createdAt,
      },
      reply: input.reply
        ? this.messageItem({
            conversationId: input.conversationId,
            role: 'assistant',
            content: input.reply,
            createdAt,
          })
        : null,
      event: this.eventItem({
        conversationId: input.conversationId,
        eventType: 'agent_result.ingested',
        payload: { proposalId: input.proposalId, status: input.status },
        occurredAt: createdAt,
      }),
    });
    return {
      result: assistantResult(result.result),
      message: message(result.message),
      deduplicated: result.deduplicated,
    };
  }
  getResult(value) {
    return assistantResult(this.#execute('get_result', { id: value }));
  }
  listResults(options = {}) {
    return this.#execute('list_results', {
      conversationId: options.conversationId ?? null,
      proposalId: options.proposalId ?? null,
    }).map(assistantResult);
  }
  decideResult(value, decision, options = {}) {
    const now = options.now || nowSeconds();
    const states = {
      accept: 'accepted',
      end: 'ended',
      reject: 'rejected',
    };
    if (!states[decision]) throw new Error('result_decision_invalid');
    const result = this.#execute('decide_result', {
      id: value,
      decision,
      operation: options.operation,
      verificationStatus: states[decision],
      kanbanReadback: options.kanbanReadback || null,
      now,
      event: this.eventItem({
        conversationId: options.conversationId,
        eventType: `agent_result.${decision}`,
        payload: { resultId: value, requestId: options.requestId || null, ...options.audit },
        occurredAt: now,
      }),
    });
    return { result: assistantResult(result.result), changed: result.changed };
  }
  createResultRound(input = {}) {
    const createdAt = input.createdAt || nowSeconds();
    const result = this.#execute('create_result_round', {
      operation: input.operation,
      item: {
        id: input.id || id('round'),
        resultId: input.resultId,
        action: input.action,
        instruction: input.instruction,
        sourceBoard: input.sourceBoard,
        sourceTaskId: input.sourceTaskId,
        linkedTaskId: input.linkedTaskId,
        requestId: input.requestId,
        createdAt,
      },
      event: this.eventItem({
        conversationId: input.conversationId,
        eventType: `agent_result.${input.action}`,
        payload: { resultId: input.resultId, linkedTaskId: input.linkedTaskId, ...input.audit },
        occurredAt: createdAt,
      }),
    });
    return { round: resultRound(result.round), deduplicated: result.deduplicated };
  }
  listResultRounds(resultId) {
    return this.#execute('list_result_rounds', { resultId }).map(resultRound);
  }
  getResultRoundByRequestId(requestId) {
    return resultRound(this.#execute('get_result_round_request', { requestId }));
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
