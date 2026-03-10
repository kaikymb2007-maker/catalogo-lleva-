// Vercel Function — proxy seguro para API Bling
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.BLING_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Token não configurado' });
  }

  try {
    const path = req.query.path || '/produtos';
    const params = { ...req.query };
    delete params.path;

    const query = new URLSearchParams(params).toString();
    const url = `https://www.bling.com.br/Api/v3${path}${query ? '?' + query : ''}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
