import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getBlingToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    const rPais = await fetch(
      `${SUPABASE_URL}/rest/v1/produtos?select=id,codigo&situacao=eq.A&codigo=not.like.*-*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const pais = await rPais.json();

    let salvos = 0;
    let pulados = 0;
    let erros = 0;
    const BATCH = 3;

    for (let i = 0; i < pais.length; i += BATCH) {
      const lote = pais.slice(i, i + BATCH);

      await Promise.all(lote.map(async pai => {
        try {
          const ref = (pai.codigo || '').trim();
          if (!ref) return;

          const rCheck = await fetch(
            `${SUPABASE_URL}/rest/v1/imagens_produtos?ref=eq.${ref}&select=ref,link`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
          );
          const existing = await rCheck.json();

          if (existing?.length && existing[0].link?.includes('supabase')) {
            pulados++;
            return;
          }

          const rBling = await fetch(
            `https://www.bling.com.br/Api/v3/produtos/${pai.id}`,
            { headers }
          );
          const dBling = await rBling.json();
          const linkBling = dBling.data?.midia?.imagens?.internas?.[0]?.link || '';

          if (!linkBling) return;

          const imgResponse = await fetch(linkBling);
          if (!imgResponse.ok) return;

          const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
          const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
          const fileName = `${ref}.${ext}`;
          const imageBuffer = await imgResponse.arrayBuffer();

          const rUpload = await fetch(
            `${SUPABASE_URL}/storage/v1/object/produtos_catalogo_teste/${fileName}`,
            {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': contentType,
                'x-upsert': 'true'
              },
              body: imageBuffer
            }
          );

          if (!rUpload.ok) {
            const err = await rUpload.text();
            console.error(`Erro upload ${ref}:`, err);
            erros++;
            return;
          }

          const linkPermanente = `${SUPABASE_URL}/storage/v1/object/public/produtos_catalogo_teste/${fileName}`;

          await fetch(
            `${SUPABASE_URL}/rest/v1/imagens_produtos`,
            {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
              },
              body: JSON.stringify({
                ref,
                link: linkPermanente,
                atualizado_em: new Date().toISOString()
              })
            }
          );

          salvos++;

        } catch(e) {
          console.error('Erro produto', pai.codigo, e.message);
          erros++;
        }
      }));

      if (i + BATCH < pais.length) await new Promise(r => setTimeout(r, 500));
    }

    return res.status(200).json({
      ok: true,
      salvos,
      pulados,
      erros,
      total: pais.length
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
