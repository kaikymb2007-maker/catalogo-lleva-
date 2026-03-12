import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function salvarImagem(ref, link) {
  await fetch(`${SUPABASE_URL}/rest/v1/imagens_produtos`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ ref, link, atualizado_em: new Date().toISOString() })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getBlingToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    // Busca todos os produtos pai do Supabase
    const rPais = await fetch(
      `${SUPABASE_URL}/rest/v1/produtos?select=id,codigo&situacao=eq.A&codigo=not.like.*-*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const pais = await rPais.json();
    console.log('Produtos pai encontrados:', pais.length);

    let salvos = 0;
    const BATCH = 3;
    for (let i = 0; i < pais.length; i += BATCH) {
      const lote = pais.slice(i, i + BATCH);
      await Promise.all(lote.map(async pai => {
        try {
          const ref = (pai.codigo || '').trim();
          if (!ref) return;
          const r = await fetch(`https://www.bling.com.br/Api/v3/produtos/${pai.id}`, { headers });
          const d = await r.json();
          const link = d.data?.midia?.imagens?.internas?.[0]?.link || '';
          if (link) {
            await salvarImagem(ref, link);
            salvos++;
          }
        } catch (e) {
          console.error('Erro produto', pai.codigo, e.message);
        }
      }));
      if (i + BATCH < pais.length) await new Promise(res => setTimeout(res, 350));
    }

    return res.status(200).json({ ok: true, salvos, total: pais.length });
  } catch (e) {
    console.error('Erro sync:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
