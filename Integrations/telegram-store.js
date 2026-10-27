export async function readTelegram(query,options) {
  const limit=Math.min(200,Math.max(1,Number(options.limit)||100));
  if(options.chat_id) {
    let before=null;
    if(options.before){try{before=JSON.parse(Buffer.from(String(options.before),'base64url').toString());}catch{throw new Error('Invalid cursor');}}
    if(before && (!Array.isArray(before)||before.length!==2||typeof before[1]!=='string'||(before[0]!==null&&!Number.isFinite(Date.parse(before[0]))))) throw new Error('Invalid cursor');
    const rows=(await query(`SELECT msg_id,chat_id,body AS display_body,body,sender,from_me,sent_at,
      (body IS NOT NULL AND btrim(body)<>'') AS readable FROM tg_messages
      WHERE chat_id=$1 AND ($3::boolean=false OR (COALESCE(sent_at,'-infinity'::timestamptz),msg_id)<(COALESCE($4::timestamptz,'-infinity'::timestamptz),$5::text))
      ORDER BY sent_at DESC NULLS LAST,msg_id DESC LIMIT $2`,[String(options.chat_id),limit,!!before,before?.[0]||null,before?.[1]||''])).rows;
    const last=rows.length===limit?rows.at(-1):null;
    const next_before=last?Buffer.from(JSON.stringify([last.sent_at,last.msg_id])).toString('base64url'):null;
    return {ok:true,source:'telegram',messages:rows,count:rows.length,total_count:rows.length,next_before};
  }
  const chats=(await query(`SELECT c.chat_id,c.name,c.kind,count(m.msg_id)::int AS msg_count,
    count(m.msg_id) FILTER(WHERE m.body IS NOT NULL AND btrim(m.body)<>'')::int AS readable_count,
    min(m.sent_at) AS first_at,max(m.sent_at) AS last_at
    FROM tg_chats c LEFT JOIN tg_messages m ON m.chat_id=c.chat_id GROUP BY c.chat_id ORDER BY last_at DESC NULLS LAST LIMIT $1`,[limit])).rows;
  const runs=(await query('SELECT source,last_success_at,record_count,status FROM tg_sync_runs ORDER BY last_success_at DESC NULLS LAST LIMIT 20')).rows;
  return {ok:true,migrated:true,source:'telegram',chats,totals:{chats:chats.length,msgs:chats.reduce((a,c)=>a+c.msg_count,0),readable:chats.reduce((a,c)=>a+c.readable_count,0)},runs,note:chats.length?'':'No Telegram records captured yet.'};
}
