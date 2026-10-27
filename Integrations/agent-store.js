import { randomUUID } from 'node:crypto';
import { query, isConfigured } from './postgres.js';
export function exchangeIdentity(body) {
  const conversation_id=body.conversation_id||randomUUID();
  const request_id=body.request_id||randomUUID();
  if(![conversation_id,request_id].every(x=>typeof x==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x))) throw new Error('Invalid conversation identity');
  return {conversation_id,request_id};
}
export async function recordExchange(client,input) {
  const {section,conversation_id,request_id,question,answer,outcome}=input;
  if(!['agent','jayti-agent'].includes(section) || typeof question!=='string' || !question.trim() || question.length>16000 || typeof answer!=='string' || !answer.trim() || answer.length>200000) throw new Error('Invalid exchange');
  exchangeIdentity({conversation_id,request_id});
  const key=[section,conversation_id,request_id];
  await client.query(`INSERT INTO dashboard_agent_exchanges(section_id,conversation_id,request_id,question,answer,outcome)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(section_id,conversation_id,request_id) DO NOTHING`,[...key,question,answer,outcome]);
  const stored=(await client.query('SELECT question,answer,outcome,created_at FROM dashboard_agent_exchanges WHERE section_id=$1 AND conversation_id=$2 AND request_id=$3',key)).rows[0];
  if(stored.question!==question) {const e=new Error('Conflicting request identity');e.status=409;throw e;}
  return stored;
}
export async function lookupExchange(section,body,question) {
  if(!isConfigured())return null;
  const identity=exchangeIdentity(body);
  const row=(await query('SELECT question,answer,created_at FROM dashboard_agent_exchanges WHERE section_id=$1 AND conversation_id=$2 AND request_id=$3',[section,identity.conversation_id,identity.request_id])).rows[0];
  if(!row)return null;
  if(row.question!==question){const e=new Error('Conflicting request identity');e.status=409;throw e;}
  return {answer:row.answer,storage:{saved:true,...identity,created_at:row.created_at}};
}
export async function persistAnswer(section,body,question,answer) {
  const identity=exchangeIdentity(body);
  if(!isConfigured()) return {answer,storage:{saved:false,...identity}};
  try{
    const stored=await recordExchange({query},{section,...identity,question,answer,outcome:'answered'});
    return {answer:stored.answer,storage:{saved:true,...identity,created_at:stored.created_at}};
  }catch(e){if(e.status===409)throw e;return {answer,storage:{saved:false,...identity,error:'Conversation storage unavailable'}};}
}
