import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';
import { SECTION_DEFINITIONS, readCurrentSection, sectionCoverage } from '../Integrations/dashboard-store.js';
import { issueMediaToken } from './lib/media-auth.js';
import { mediaKind } from './lib/media-policy.js';

export async function sourceMediaReferences(rows,dbQuery=query) {
  const candidates=rows.filter(r=>/\/whatsappMedia$/.test(r.scope)||r.values?.mime||r.values?.file_name);
  if(!candidates.length)return rows;
  const attachments=(await dbQuery('SELECT att_id,blob_url,mime,file_name FROM wa_attachments WHERE att_id=ANY($1::text[]) OR blob_url=ANY($2::text[])',[candidates.map(r=>r.values.att_id).filter(Boolean),candidates.map(r=>r.values.url).filter(Boolean)])).rows;
  for(const r of candidates) {
    const a=attachments.find(a=>(r.values.att_id && a.att_id===r.values.att_id)||(r.values.url && a.blob_url===r.values.url));
    const info=a||{file_name:r.values.file_name,mime:r.values.mime};
    r.hidden_media=!mediaKind(info);
    r.media=!r.hidden_media?{file_name:info.file_name,mime:info.mime,available:!!a,...(a?{att_id:a.att_id,media_token:issueMediaToken(a.att_id)}:{})}:null;
    r.values={...r.values};delete r.values.url;delete r.values.att_id;
  }
  return rows.filter(r=>!r.hidden_media).map(({hidden_media,...row})=>row);
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET only'});
  if(!requireKey(req,res)) return;
  if(!isConfigured()) return res.status(503).json({ok:false,error:'Database unavailable'});
  try {
    const states=(await query('SELECT section_id,source,scope,observed_at,complete FROM dashboard_sync_state ORDER BY section_id,scope')).rows;
    const requested=String(req.query?.section||'');
    if(requested && !SECTION_DEFINITIONS.some(s=>s.id===requested)) return res.status(400).json({ok:false,error:'Unknown section'});
    const rows=requested?await sourceMediaReferences(await readCurrentSection(requested,req.query?.limit)):undefined;
    const coverage=req.query?.coverage==='1'?await sectionCoverage():undefined;
    return res.status(200).json({ok:true,sections:SECTION_DEFINITIONS.map(s=>({...s,observations:states.filter(x=>x.section_id===(['s24','vivobook','jteka'].includes(s.id)?'firestore':s.id)).map(x=>({...x,stale:Date.now()-new Date(x.observed_at).getTime()>20*60*1000}))})),...(rows?{rows}:{} ),...(coverage?{coverage}:{})});
  } catch{return res.status(503).json({ok:false,error:'Section storage unavailable'});}
}
