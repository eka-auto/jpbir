import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs/promises';
import { exchangeIdentity, recordExchange } from '../../Integrations/agent-store.js';
import { readTelegram } from '../../Integrations/telegram-store.js';
assert.throws(()=>exchangeIdentity({conversation_id:'../../x'}),/identity/);
const identity=exchangeIdentity({conversation_id:'fixture',request_id:'request-1'});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});const c=await pool.connect();
try{
 await c.query('BEGIN');await c.query(await fs.readFile(new URL('../../Database/schema/017_dashboard_sections.sql',import.meta.url),'utf8'));
 const input={section:'agent',...identity,question:'Real fixture question',answer:'Actual fixture answer',outcome:'answered'};
 assert.equal((await recordExchange(c,input)).answer,input.answer);
 assert.equal((await recordExchange(c,{...input,answer:'retry answer'})).answer,input.answer);
 process.env.STATS_KEY='fixture-stats';process.env.ANTHROPIC_API_KEY='fixture-provider';
 globalThis.__jpPgPool={query:(sql,params)=>c.query(sql,params)};
 const {default:agent}=await import('../../Backend/jp-agent.js');
 const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('upstream unavailable');};
 const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
 try{
   const res=response();await agent({method:'POST',headers:{'x-stats-key':'fixture-stats'},body:{...identity,question:input.question}},res);
   assert.equal(res.statusCode,200);assert.equal(res.body.answer,input.answer);assert.equal(calls,0);
   const conflict=response();await agent({method:'POST',headers:{'x-stats-key':'fixture-stats'},body:{...identity,question:'conflicting question'}},conflict);
   assert.equal(conflict.statusCode,409);assert.equal(calls,0);
 }finally{globalThis.fetch=oldFetch;delete globalThis.__jpPgPool;}
 await assert.rejects(recordExchange(c,{...input,question:'different'}),/request identity/);
 const statements=[];const q=async(sql,params)=>{statements.push(sql);return c.query(sql,params);};
 const tg=await readTelegram(q,{});assert.equal(tg.chats.length,0);assert.ok(statements.every(s=>!s.includes('wa_')));
 await c.query("INSERT INTO tg_chats(chat_id,name) VALUES ('fixture','Actual chat')");
 await c.query("INSERT INTO tg_messages(chat_id,msg_id,body,sent_at) VALUES ('fixture','1','Readable text',now())");
 const first=await readTelegram(q,{chat_id:'fixture',limit:1});
 assert.equal(first.messages[0].display_body,'Readable text');
 assert.equal(first.messages[0].readable,true);
 assert.ok(first.next_before);
 assert.equal((await readTelegram(q,{chat_id:'fixture',before:first.next_before})).messages.length,0);
 await c.query("INSERT INTO tg_chats(chat_id,name) VALUES ('large','Large fixture')");
 await c.query("INSERT INTO tg_messages(chat_id,msg_id,body,sent_at) SELECT 'large',i::text,'Message '||i,now() - i*interval '1 second' FROM generate_series(1,201) i");
 const batch=await readTelegram(q,{chat_id:'large',limit:200});
 assert.equal(batch.messages.length,200);
 assert.equal((await readTelegram(q,{chat_id:'large',limit:200,before:batch.next_before})).messages.length,1);
 console.log('conversation persistence, retry deduplication, Telegram isolation and real text passed');
}finally{await c.query('ROLLBACK');c.release();await pool.end();}
