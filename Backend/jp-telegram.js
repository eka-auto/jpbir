import { requireKey } from './_auth.js';
import { query,isConfigured } from '../Integrations/postgres.js';
import { readTelegram } from '../Integrations/telegram-store.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'GET only'});
  if(!requireKey(req,res)) return;
  if(!isConfigured()) return res.status(503).json({ok:false,error:'Telegram storage unavailable'});
  try{return res.status(200).json(await readTelegram(query,req.query||{}));}
  catch{return res.status(503).json({ok:false,error:'Telegram storage unavailable'});}
}
