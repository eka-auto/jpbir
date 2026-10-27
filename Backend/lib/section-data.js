// Explicit semantic fields. Source credentials, raw records and arbitrary maps
// cannot enter this read model, even if a provider adds them later.
const FIELDS = new Set(('name title text body sender phone number count total value unit status model hostname deviceId deviceType lastSeen agentVersion battery cpu memory disk latitude longitude accuracy duration size_bytes file_name mime sent_at updated_at created_at url att_id email country city os browser version result checked_at message label').split(' '));
export function projectFields(source) {
  source={...source,file_name:source?.file_name??source?.filename,mime:source?.mime??source?.contentType,url:source?.url??source?.mediaUrl??source?.blob_url};
  const out = {};
  for (const [k,v] of Object.entries(source || {})) {
    if (!FIELDS.has(k)) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}
const HIDDEN=/^(raw|raw_payload|payload|metadata|meta|debug|private_key|token|secret|credentials|authorization|commandQueue)$|(?:_token|_secret|_password)$/i;
export function displayReadModel(input,depth=0) {
  if(depth>15)return null;
  if(Array.isArray(input))return input.map(v=>displayReadModel(v,depth+1)).filter(v=>v!==null);
  if(input instanceof Date)return input.toISOString();
  if(input && typeof input==='object' && (input.file_name||input.filename)) {
    const name=String(input.file_name||input.filename),mime=String(input.mime||input.file_type||'');
    if(/\.(jsonl?|ndjson|ya?ml|map)$/i.test(name)||/(^|[\W_])(metadata|manifest|meta)([\W_]|$)/i.test(name)||/json/i.test(mime))return null;
  }
  if(input && typeof input==='object')return Object.fromEntries(Object.entries(input).filter(([k])=>!HIDDEN.test(k)).map(([k,v])=>[k,displayReadModel(v,depth+1)]));
  if(typeof input==='string' && /^\s*[\[{]/.test(input)) {
    try{return displayReadModel(JSON.parse(input,(key,v,context)=>typeof v==='number' && !Number.isSafeInteger(v) && context?.source?context.source:v),depth+1);}catch{return null;}
  }
  return input;
}
export function decodeField(v) {
  if (!v || 'nullValue' in v) return null;
  if ('integerValue' in v) {const n=Number(v.integerValue);return Number.isSafeInteger(n)?n:String(v.integerValue);}
  for (const k of ['stringValue','doubleValue','booleanValue','timestampValue']) if (k in v) return v[k];
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,x])=>[k,decodeField(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values||[]).map(decodeField);
  return null;
}
export async function fetchCollection({base,scope,token,generation,fetcher=fetch,maxPages=10,cursor=''}) {
  const records=[];let pageToken=cursor;
  for(let page=0;page<maxPages;page++) {
    const url=new URL(`${base}/${scope}`);
    url.searchParams.set('pageSize','1000');url.searchParams.set('readTime',generation);
    if(pageToken) url.searchParams.set('pageToken',pageToken);
    const response=await fetcher(url.toString(),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('Firestore source unavailable');
    const data=await response.json();
    for(const doc of data.documents||[]) {
      if(!doc.name || !doc.updateTime) throw new Error('Firestore source revision missing');
      const values=Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decodeField(v)]));
      records.push({id:doc.name.split('/documents/').pop(),revision:doc.updateTime,values:projectFields(values)});
    }
    pageToken=data.nextPageToken||'';
    if(!pageToken) return {records,complete:true,nextPageToken:''};
  }
  return {records,complete:false,nextPageToken:pageToken};
}

export async function persistProviderSection(section, records, generation) {
  const { saveSnapshot }=await import('../../Integrations/dashboard-store.js');
  return saveSnapshot({section,source:section,scope:'current',generation,complete:true,
    records:records.map(r=>({id:r.id,revision:generation,values:projectFields(r.values)}))});
}
