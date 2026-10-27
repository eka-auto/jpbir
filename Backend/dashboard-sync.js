import { timingSafeEqual, createHash } from 'node:crypto';
import { getFirestoreToken } from './jp-devices.js';
import { DEVICE_IDS } from './broker.js';
import { fetchCollection } from './lib/section-data.js';
import { saveSnapshotPage, snapshotCursor } from '../Integrations/dashboard-store.js';
import { requireOperatorKey } from './_auth.js';
import { query } from '../Integrations/postgres.js';
import vercelHandler from './vercel-analytics.js';
import stackHandler from './jp-stack.js';

const digest=v=>createHash('sha256').update(v).digest();
export const config={maxDuration:300};
async function syncProviders() {
  const results=[];
  for(const [section,handler] of [['vercel',vercelHandler],['stack',stackHandler]]) {
    const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
    try {
      await handler({method:'GET',headers:{'x-stats-key':process.env.STATS_KEY||''},query:{},url:'/api/'+section},res);
      results.push({section,available:res.code===200,stored:res.data?.storage==='saved'});
    }catch{results.push({section,available:false,stored:false});}
  }
  return results;
}
export async function syncFirestore() {
  let sa;
  try {sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'');} catch{throw new Error('Firestore is not configured');}
  if(!sa.project_id) throw new Error('Firestore is not configured');
  const token=await getFirestoreToken();
  const database=process.env.FIRESTORE_DB||'eka-agent';
  const source=`firestore:${sa.project_id}:${database}`;
  const base=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/databases/${encodeURIComponent(database)}/documents`;
  // Consistent point-in-time across pages and scopes; revisions retain nanos.
  const generation=new Date(Date.now()-5000).toISOString();
  const scopes=['devices',...DEVICE_IDS.flatMap(id=>['whatsappMedia','callLogs','sms','contacts'].map(c=>`devices/${encodeURIComponent(id)}/${c}`))];
  const results=[];
  const deadline=Date.now()+220000;
  for(const scope of scopes) {
    try {
      let pending=await snapshotCursor('firestore',source,scope);
      // Firestore retains minute-precision read times for one hour. Restart
      // expired partial scans safely; none may authorize deletion.
      let resume=pending && Date.now()-Date.parse(pending.generation)<50*60*1000;
      const scopeGeneration=resume?pending.generation:generation;
      let cursor=resume?pending.cursor:'';
      do {
        if(Date.now()>=deadline){results.push({scope,complete:false,deferred:true});break;}
        const snapshot=await fetchCollection({base,scope,token,generation:scopeGeneration,cursor,maxPages:2});
        if(scope==='devices') snapshot.records=snapshot.records.filter(r=>DEVICE_IDS.includes(r.id.split('/').pop()));
        const counts=await saveSnapshotPage({section:'firestore',source,scope,generation:scopeGeneration,cursor,...snapshot});
        results.push({scope,complete:snapshot.complete,...counts});
        if(counts.ignored) break; // Another worker advanced/completed this scope.
        cursor=snapshot.nextPageToken;
      } while(cursor);
    } catch {
      await query('UPDATE dashboard_sync_state SET complete=false WHERE section_id=$1 AND source=$2 AND scope=$3',['firestore',source,scope]);
      results.push({scope,complete:false,unavailable:true});
    }
  }
  return results;
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({ok:false,error:'Method not allowed'});
  const expected=process.env.CRON_SECRET;
  const supplied=req.headers?.authorization||'';
  const cron=expected && timingSafeEqual(digest(supplied),digest(`Bearer ${expected}`));
  if(!cron && !requireOperatorKey(req,res)) return;
  try {const scopes=await syncFirestore();const providers=await syncProviders();return res.status(scopes.some(s=>s.unavailable)?503:200).json({ok:!scopes.some(s=>s.unavailable),scopes,providers});}
  catch{return res.status(503).json({ok:false,error:'Source synchronization unavailable'});}
}
