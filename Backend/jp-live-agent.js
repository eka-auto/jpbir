const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AGENT_API_URL = (_env['AGENT_API_' + 'URL'] || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const AGENT_API_KEY = _env['AGENT_API_' + 'KEY'] || '';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!AGENT_API_KEY || AGENT_API_KEY === 'YOUR_AGENT_API_KEY_HERE') {
    return res.status(500).json({ success: false, error: 'AGENT_API_KEY not configured' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const query = String(body.query || body.question || '').trim();
  if (!query) {
    return res.status(400).json({ success: false, error: 'query required' });
  }

  const payload = {
    query,
    top_k: Number.isFinite(Number(body.top_k)) ? Number(body.top_k) : 5,
    max_tokens: Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 512,
    temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
    use_rag: body.use_rag === undefined ? true : Boolean(body.use_rag),
  };

  try {
    const upstream = await fetch(`${AGENT_API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AGENT_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        error: 'Agent upstream error',
        upstream_status: upstream.status,
        details: data,
      });
    }
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message || 'Agent request failed' });
  }
}

