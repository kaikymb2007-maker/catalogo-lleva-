import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Imagens ficam em cache por 24h — mudam raramente
let imagensCache = {};
let imagensCacheTimestamp = 0;
const IMAGENS_TTL = 24 * 60 * 60 * 1000;

async function supabaseGetProdutos() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/produtos?select=id,nome,codigo,preco,estoque,situacao&situacao=eq.A&order=codigo.asc`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  if (!r.ok) throw new Error(`Supabase GET erro: ${r.status}`);
  return await r.json();
}

function detectarCategoria(nome = '') {
  const n = nome.toLowerCase();
  if (n.includes('skinny')) return 'skinny';
  if (n.includes('alfaiataria')) return 'alfaiataria';
  if (n.includes('bermuda')) return 'bermuda';
  if (n.includes('reta')) return 'reta';
  return 'outros';
}

function montarCatalogo(linhas, imagensMap) {
  const grupos = {};
  for (const row of linhas) {
    const codigo = row.codigo || '';
    const partes = codigo.split('-');
    if (partes.length < 2) continue;
    const tamanho = partes[partes.length - 1];
    const ref = partes.slice(0, partes.length - 1).join('-');
    if (!ref || !tamanho) continue;
    const nomeLimpo = (row.nome || '')
      .replace(/\s*TAMANHO:\s*\S+/gi, '')
      .replace(/\s*TAM:\s*\S+/gi, '')
      .trim();
    const estoque = row.estoque?.saldoVirtualTotal ?? 0;
    if (!grupos[ref]) {
      grupos[ref] = {
        id: row.id,
        name: nomeLimpo,
        ref,
        category: detectarCategoria(nomeLimpo),
        price: row.preco || 0,
        image: imagensMap[ref] || '',
        variacoes: []
      };
    }
    grupos[ref].variacoes.push({
      id: row.id,
      tamanho,
      estoque: estoque < 0 ? 0 : estoque,
      preco: row.preco || 0
    });
  }
  return Object.values(grupos)
    .filter(p => p.variacoes.length > 0)
    .map(p => ({
      ...p,
      variacoes: [...p.variacoes].sort((a, b) => parseInt(a.tamanho) - parseInt(b.tamanho))
    }));
}

async function buscarImagensPai(token) {
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
  const imagensMap = {};
  let pagina = 1;
  while (true) {
    try {
      const r = await fetch(
        `https://www.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100&tipo=P&situacao=A`,
        { headers }
      );
      const d = await r.json();
      const lista = d.data || [];
      if (!lista.length) break;
      const BATCH = 5;
      for (let i = 0; i < lista.length; i += BATCH) {
        const lote = lista.slice(i, i + BATCH);
        await Promise.all(lote.map(async p => {
          try {
            const r2 = await fetch(`https://www.bling.com.br/Api/v3/produtos/${p.id}`, { headers });
            const d2 = await r2.json();
            const prod = d2.data;
            if (!prod) return;
            const ref = (prod.codigo || '').trim();
            const link = prod.midia?.imagens?.internas?.[0]?.link || '';
            if (ref && link) imagensMap[ref] = link;
          } catch {}
        }));
        if (i + BATCH < lista.length) await new Promise(res => setTimeout(res, 300));
      }
      if (lista.length < 100) break;
      pagina++;
      await new Promise(res => setTimeout(res, 400));
    } catch (e) {
      console.error('Erro buscarImagensPai:', e.message);
      break;
    }
  }
  console.log('Imagens buscadas:', Object.keys(imagensMap).length);
  return imagensMap;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forcar = req.query.forcar === '1';

  try {
    // Estoque sempre ao vivo do Supabase
    const linhas = await supabaseGetProdutos();
    if (!linhas || !linhas.length) throw new Error('Supabase retornou vazio');

    // Imagens com cache de 24h — só busca no Bling se expirou ou forçado
    const imagensExpiradas = (Date.now() - imagensCacheTimestamp) > IMAGENS_TTL;
    if (forcar || imagensExpiradas || !Object.keys(imagensCache).length) {
      console.log('Buscando imagens do Bling...');
      const token = await getBlingToken();
      imagensCache = await buscarImagensPai(token);
      imagensCacheTimestamp = Date.now();
    } else {
      console.log('Imagens do cache (24h)');
    }

    const produtos = montarCatalogo(linhas, imagensCache);
    console.log('Produtos:', produtos.length, '| Com imagem:', produtos.filter(p => p.image).length);
    return res.status(200).json({ produtos, fonte: 'supabase', total: produtos.length });

  } catch (e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
