// Only the public Auth service URL is returned. Never serialize process.env.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const authUrl = process.env.NEON_AUTH_BASE_URL;
  try {
    const url = new URL(authUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.neon.tech') || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid Auth URL');
    }
    return res.status(200).json({ authUrl: url.href.replace(/\/$/, '') });
  } catch {
    return res.status(503).json({ error: 'Email signup is not configured on this deployment.' });
  }
}
