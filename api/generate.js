// Vercel serverless function: keeps your API key on the server.
const hits = new Map(); // naive per-IP limit (resets on cold start)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (arr.length >= 30) return res.status(429).json({ error: 'Too many requests, try later.' });
  arr.push(now); hits.set(ip, arr);

  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== 'string' || !prompt || prompt.length > 6000)
    return res.status(400).json({ error: 'Invalid prompt' });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 6000,
        system: 'Return ONLY valid JSON. No markdown fences, no commentary.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    if (!r.ok) { console.error('Anthropic error', r.status, JSON.stringify(data)); return res.status(r.status === 429 ? 429 : 502).json({ error: 'API ' + r.status + ': ' + (data.error?.message || 'Upstream error') }); }
    const text = (data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    return res.status(200).json(JSON.parse(text.slice(a, b + 1)));
  } catch (e) {
    console.error('generate failed', e);
    return res.status(502).json({ error: 'Server error: ' + (e.message || e) });
  }
}
