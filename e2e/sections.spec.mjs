import { expect,test } from '@playwright/test';
import { SECTION_DEFINITIONS } from '../Integrations/dashboard-store.js';

test('all nineteen sections have concrete readers, identity and display fields',async()=>{
  expect(SECTION_DEFINITIONS).toHaveLength(19);
  for(const s of SECTION_DEFINITIONS){expect(s.reader).toMatch(/^\//);expect(s.identity.length).toBeGreaterThan(0);expect(s.fields.length).toBeGreaterThan(0);}
});
test('served media page renders supported files and hides metadata',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('jbt_stats_key','synthetic-section-fixture'));
  await page.route('**/api/jp-whatsapp',r=>r.fulfill({json:{ok:true,chats:[]}}));
  await page.route('**/api/jp-live-content?*',r=>r.fulfill({json:{ok:true,window_days:7,attachments:[
    {att_id:'pdf-fixture',media_token:'fixture',kind:'document',file_name:'Report.pdf',mime:'application/pdf',size_bytes:'9007199254740993'},
    {att_id:'meta-fixture',media_token:'fixture',kind:'document',file_name:'metadata.json',mime:'application/json'},
    {att_id:'image-fixture',media_token:'fixture',kind:'image',file_name:'Photo.png',mime:'image/png'}
  ]}}));
  await page.route('**/api/wa-media?*',r=>new URL(r.request().url()).searchParams.get('att_id')==='image-fixture'
    ?r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=','base64')})
    :r.fulfill({status:404,body:'Fixture document transport unavailable'}));
  await page.goto('/viewer');
  await expect(page.locator('iframe[title="Report.pdf"]')).toHaveCount(1);
  await expect(page.locator('img[alt*="Photo.png"]')).toHaveCount(1);
  await expect(page.getByText('metadata.json')).toHaveCount(0);
  await expect(page.locator('a[href*="arbitrary.example"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('Telegram uses its own empty source',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('jbt_stats_key','synthetic-section-fixture'));
  const seen=[];
  await page.route('**/api/**',r=>{
    const path=new URL(r.request().url()).pathname;seen.push(path);
    if(path==='/api/jp-telegram')return r.fulfill({json:{ok:true,migrated:true,chats:[],totals:{chats:0},runs:[]}});
    return r.fulfill({status:503,json:{success:false,error:'Fixture source unavailable'}});
  });
  await page.goto('/?view=telegram');
  await expect(page.locator('#tgChatList')).toContainText('No Telegram records captured yet.');
  expect(seen).toContain('/api/jp-telegram');expect(seen).not.toContain('/api/jp-whatsapp');
});
test('Telegram text renders without requesting WhatsApp media',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('jbt_stats_key','synthetic-section-fixture'));
  const seen=[];
  await page.route('**/api/**',r=>{
    const u=new URL(r.request().url());seen.push(u.pathname);
    if(u.pathname==='/api/jp-telegram')return r.fulfill({json:u.searchParams.get('chat_id')?
      {ok:true,messages:[{msg_id:'collision',chat_id:'shared-id',display_body:'Actual Telegram fixture text',body:'Actual Telegram fixture text',readable:true,kind:'text',sender_label:'Fixture sender'}],count:1,total_count:1,next_before:null}:
      {ok:true,migrated:true,chats:[{chat_id:'shared-id',name:'Telegram fixture',kind:'direct',msg_count:1,readable_count:1}],totals:{chats:1,readable:1},runs:[]}});
    return r.fulfill({status:503,json:{success:false,error:'Fixture source unavailable'}});
  });
  await page.goto('/?view=telegram');
  await page.locator('#tgChatList .mess-chat').click();
  await expect(page.locator('#page-telegram .mess-bubble').filter({hasText:'Actual Telegram fixture text'})).toBeVisible();
  expect(seen).not.toContain('/api/jp-wa-attachments');expect(seen).not.toContain('/api/jp-whatsapp');
});
