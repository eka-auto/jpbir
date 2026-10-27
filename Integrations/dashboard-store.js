import { createHash } from 'node:crypto';
import { pool } from './postgres.js';

// Reader and fields are the contract, not a claim that the provider is online.
export const SECTION_DEFINITIONS = [
  ['s24','S24 Ultra','/api/jp-devices','current','devices/samsung-s24-ultra','device,model,status,last_seen'],
  ['vivobook','VivoBook','/api/jp-devices','current','devices/jayti-asus-vivobook','device,hostname,status,last_seen'],
  ['jteka','Jteka','/api/jp-devices','current','devices','device,model,status,last_seen'],
  ['live','Live feed','/api/jp-live-content','history','wa_messages,wa_attachments,events','text,sender,sent_at,media'],
  ['firestore','Firestore','/api/dashboard-sections?section=firestore','current','devices/{id}/{collection}/{id}','name,text,value,source_updated_at'],
  ['database','Database','/api/db-api','history','warehouse','typed table columns'],
  ['media','Media','/api/jp-wa-attachments','reference','wa_attachments','file_name,mime,size_bytes,media'],
  ['vercel','Vercel','/api/vercel-analytics','current','project','name,status,count,observed_at'],
  ['overview','Overview','/api/jp-stats','history','events,visitors,sessions','visits,visitors,active_now'],
  ['audience','Audience','/api/jp-stats','history','events,visitors','browser,os,device,count'],
  ['geo','Geography','/api/jp-stats','history','events,visitors','country,city,count'],
  ['sessions','Sessions','/api/jp-stats','history','sessions,events','session,started_at,duration'],
  ['email','Email opens','/api/jp-stats','history','email_opens','recipient,opened_at,count'],
  ['device','Device Dashboard','/api/jp-device','history','devices,device_telemetry,device_dataset_status','device,source_timestamp,measurements'],
  ['whatsapp','WhatsApp','/api/jp-whatsapp','history','wa_chats,wa_messages,wa_attachments','chat,sender,text,sent_at,media'],
  ['telegram','Telegram','/api/jp-telegram','history','tg_chats,tg_messages,tg_sync_runs','chat,sender,text,sent_at'],
  ['agent','Ask agent','/api/jp-agent','conversation','dashboard_agent_exchanges','question,answer,created_at'],
  ['jayti-agent','Jayti Agent','/agent/query','conversation','dashboard_agent_exchanges','question,answer,created_at'],
  ['stack','Product engineering','/api/jp-stack','current','probe identity','name,status,checked_at']
].map(([id,label,reader,policy,identity,fields]) => Object.freeze({id,label,reader,policy,identity,fields:fields.split(',')}));

export function revision(value) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value || '');
  if (!m || !Number.isFinite(Date.parse(value))) throw new Error('A native UTC source revision is required');
  return `${m[1]}.${(m[2] || '').padEnd(9, '0')}Z`;
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])]));
  return v;
}
export async function reconcileSnapshot(client, snapshot) {
  const { section, source, scope, records, complete } = snapshot;
  if (!SECTION_DEFINITIONS.some(s => s.id === section) || !source || !scope || !Array.isArray(records) || records.length > 10000) throw new Error('Invalid snapshot scope');
  const generation = revision(snapshot.generation);
  const normalized = records.map(r => ({...r, revision:revision(r.revision)}));
  if (new Set(records.map(r => r.id)).size !== records.length || records.some(r => typeof r.id !== 'string' || !r.id)) throw new Error('Invalid source identity');
  const stats = {inserted:0,updated:0,unchanged:0,removed:0,ignored:0};
  // The caller owns the transaction. A scope lock serializes concurrent polls.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([section,source,scope])]);
  const key = [section,source,scope];
  const state = (await client.query('SELECT generation, complete_generation FROM dashboard_sync_state WHERE section_id=$1 AND source=$2 AND scope=$3 FOR UPDATE',key)).rows[0];
  if (state && generation < state.generation) return {...stats,ignored:records.length};
  const previous = new Map((await client.query('SELECT record_id,source_revision,content_hash FROM dashboard_current_records WHERE section_id=$1 AND source=$2 AND scope=$3',key)).rows.map(r=>[r.record_id,r]));
  const writes=[];
  for (const r of normalized) {
    const old = previous.get(r.id);
    // A completed deletion establishes a watermark; an older delayed document
    // must not resurrect after its source identity was removed.
    if ((!old && state?.complete_generation && r.revision <= state.complete_generation) || (old && r.revision < old.source_revision)) {stats.ignored++;continue;}
    const values = JSON.stringify(canonical(r.values));
    if (values.length > 100000) throw new Error('Display projection too large');
    const hash = createHash('sha256').update(values).digest('hex');
    if (old && hash === old.content_hash && r.revision === old.source_revision) {stats.unchanged++;continue;}
    writes.push({id:r.id,revision:r.revision,hash,values});
    stats[old?'updated':'inserted']++;
  }
  if(writes.length) await client.query(`INSERT INTO dashboard_current_records(section_id,source,scope,record_id,source_revision,content_hash,display_values)
    SELECT $1,$2,$3,r.* FROM unnest($4::text[],$5::text[],$6::text[],$7::jsonb[]) AS r
    ON CONFLICT(section_id,source,scope,record_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,
    content_hash=EXCLUDED.content_hash,display_values=EXCLUDED.display_values,observed_at=now()`,[...key,writes.map(r=>r.id),writes.map(r=>r.revision),writes.map(r=>r.hash),writes.map(r=>r.values)]);
  if (complete === true) {
    stats.removed = (await client.query('DELETE FROM dashboard_current_records WHERE section_id=$1 AND source=$2 AND scope=$3 AND NOT(record_id=ANY($4::text[]))',[...key,records.map(r=>r.id)])).rowCount;
  }
  await client.query(`INSERT INTO dashboard_sync_state(section_id,source,scope,generation,complete_generation,complete)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(section_id,source,scope) DO UPDATE SET generation=EXCLUDED.generation,
    complete_generation=COALESCE(EXCLUDED.complete_generation,dashboard_sync_state.complete_generation),complete=EXCLUDED.complete,observed_at=now()`,[...key,generation,complete===true?generation:null,complete===true]);
  return stats;
}
export async function saveSnapshot(snapshot) {
  const client=await pool().connect();
  try {await client.query('BEGIN');const result=await reconcileSnapshot(client,snapshot);await client.query('COMMIT');return result;}
  catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
}
export async function reconcilePage(client,snapshot) {
  const key=[snapshot.section,snapshot.source,snapshot.scope];
  const generation=revision(snapshot.generation);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(key)]);
  const state=(await client.query('SELECT complete_generation,generation FROM dashboard_sync_state WHERE section_id=$1 AND source=$2 AND scope=$3',key)).rows[0];
  if(state && (generation < state.generation || generation <= state.complete_generation)) return {ignored:snapshot.records.length};
  const pending=(await client.query('SELECT generation,cursor FROM dashboard_sync_cursors WHERE section_id=$1 AND source=$2 AND scope=$3 FOR UPDATE',key)).rows[0];
  if(pending?.generation===generation && pending.cursor!==(snapshot.cursor||'')) return {ignored:snapshot.records.length};
  const result=await reconcileSnapshot(client,{...snapshot,complete:false});
  // Membership keys are bounded to this scope's in-progress generation. They
  // carry no raw source data and are removed after a successful complete pass.
  await client.query('DELETE FROM dashboard_sync_members WHERE section_id=$1 AND source=$2 AND scope=$3 AND generation<>$4',[...key,generation]);
  if(snapshot.records.length) await client.query(`INSERT INTO dashboard_sync_members(section_id,source,scope,record_id,generation)
    SELECT $1,$2,$3,unnest($4::text[]),$5 ON CONFLICT(section_id,source,scope,record_id) DO UPDATE SET generation=EXCLUDED.generation`,[...key,snapshot.records.map(r=>r.id),generation]);
  if(snapshot.nextPageToken) {
    await client.query(`INSERT INTO dashboard_sync_cursors(section_id,source,scope,generation,cursor) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(section_id,source,scope) DO UPDATE SET generation=EXCLUDED.generation,cursor=EXCLUDED.cursor`,[...key,generation,snapshot.nextPageToken]);
  } else {
    result.removed=(await client.query(`DELETE FROM dashboard_current_records r WHERE r.section_id=$1 AND r.source=$2 AND r.scope=$3
      AND NOT EXISTS(SELECT 1 FROM dashboard_sync_members m WHERE m.section_id=r.section_id AND m.source=r.source AND m.scope=r.scope AND m.record_id=r.record_id AND m.generation=$4)`,[...key,generation])).rowCount;
    await client.query('UPDATE dashboard_sync_state SET complete=true,complete_generation=$4 WHERE section_id=$1 AND source=$2 AND scope=$3',[...key,generation]);
    await client.query('DELETE FROM dashboard_sync_cursors WHERE section_id=$1 AND source=$2 AND scope=$3',key);
    await client.query('DELETE FROM dashboard_sync_members WHERE section_id=$1 AND source=$2 AND scope=$3',key);
  }
  return result;
}
export async function saveSnapshotPage(snapshot) {
  const c=await pool().connect();
  try{await c.query('BEGIN');const result=await reconcilePage(c,snapshot);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function snapshotCursor(section,source,scope) {
  return (await pool().query('SELECT generation,cursor FROM dashboard_sync_cursors WHERE section_id=$1 AND source=$2 AND scope=$3',[section,source,scope])).rows[0]||null;
}
export async function readCurrentSection(section, limit=200) {
  if(!SECTION_DEFINITIONS.some(s=>s.id===section)) throw new Error('Unknown section');
  const deviceFilters={s24:'devices/samsung-s24-ultra',vivobook:'devices/jayti-asus-vivobook',jteka:null};
  const alias=Object.hasOwn(deviceFilters,section);
  return (await pool().query(`SELECT source,scope,record_id,source_revision AS source_updated_at,display_values AS values,observed_at
    FROM dashboard_current_records WHERE section_id=$1 AND ($3::text IS NULL OR record_id=$3) ${alias?"AND scope='devices'":''}
    ORDER BY scope,record_id LIMIT $2`,[alias?'firestore':section,Math.min(500,Math.max(1,Number(limit)||200)),deviceFilters[section]||null])).rows;
}
export const SECTION_TABLES={
  s24:['dashboard_current_records'],vivobook:['dashboard_current_records'],jteka:['dashboard_current_records'],firestore:['dashboard_current_records','dashboard_sync_state','dashboard_sync_cursors'],
  live:['events','wa_messages','wa_attachments'],database:['events','devices','wa_chats'],media:['wa_attachments'],vercel:['dashboard_current_records'],
  overview:['events','visitors','sessions'],audience:['visitors','events'],geo:['events'],sessions:['sessions'],email:['email_opens'],
  device:['devices','device_telemetry','device_dataset_status'],whatsapp:['wa_chats','wa_messages','wa_attachments'],telegram:['tg_chats','tg_messages','tg_sync_runs'],
  agent:['dashboard_agent_exchanges'],'jayti-agent':['dashboard_agent_exchanges'],stack:['dashboard_current_records']
};
export async function sectionCoverage(dbQuery=pool().query.bind(pool())) {
  const names=[...new Set(Object.values(SECTION_TABLES).flat())];
  const existing=(await dbQuery("SELECT name,to_regclass('public.'||name) IS NOT NULL AS present FROM unnest($1::text[]) name",[names])).rows;
  const present=new Set(existing.filter(r=>r.present).map(r=>r.name));
  const observed={};
  for(const name of names) if(present.has(name)) observed[name]=(await dbQuery(`SELECT EXISTS(SELECT 1 FROM ${name}) AS observed`)).rows[0].observed;
  const result=[];
  for(const s of SECTION_DEFINITIONS) {
    let seen=SECTION_TABLES[s.id].some(t=>observed[t]);
    if(s.policy==='current' && present.has('dashboard_current_records')) {
      const alias=['s24','vivobook','jteka'].includes(s.id);
      const id=s.id==='s24'?'devices/samsung-s24-ultra':s.id==='vivobook'?'devices/jayti-asus-vivobook':null;
      seen=(await dbQuery('SELECT EXISTS(SELECT 1 FROM dashboard_current_records WHERE section_id=$1 AND ($2::text IS NULL OR record_id=$2)) AS observed',[alias?'firestore':s.id,id])).rows[0].observed;
    }
    if(s.policy==='conversation' && present.has('dashboard_agent_exchanges'))seen=(await dbQuery('SELECT EXISTS(SELECT 1 FROM dashboard_agent_exchanges WHERE section_id=$1) AS observed',[s.id])).rows[0].observed;
    result.push({id:s.id,schema_ready:SECTION_TABLES[s.id].every(t=>present.has(t)),reader:s.reader,tables:SECTION_TABLES[s.id],real_data_observed:!!seen,media_bytes_verified:false});
  }
  return result;
}
