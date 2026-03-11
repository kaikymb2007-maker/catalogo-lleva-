import { getBlingToken } from './bling-token.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: 'path obrigatório' });

  try {
    const token = await getBlingToken();
    const qs = new URLSearchParams(params).toString();
    const url = `https://www.bling.com.br/Api/v3${path}${qs ? '?' + qs : ''}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch(e) {
    console.error('Erro Bling proxy:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
