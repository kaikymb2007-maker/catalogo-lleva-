import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

let memCache = null;
let memCacheTimestamp = 0;
const MEM_CACHE_TTL = 10 * 60 * 1000;

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

function montarCatalogo(linhas) {
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
        image: '',
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

async function buscarImagensBling(token, produtos) {
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
  const BATCH = 5;
  for (let i = 0; i < produtos.length; i += BATCH) {
    const lote = produtos.slice(i, i + BATCH);
    await Promise.all(lote.map(async p => {
      try {
        // Pega o id da primeira variação para buscar o produto pai
        const varId = p.variacoes[0]?.id;
        if (!varId) return;
        const r = await fetch(`https://www.bling.com.br/Api/v3/produtos/${varId}`, { headers });
        const d = await r.json();
        const paiId = d.data?.variacao?.produtoPai?.id;
        if (!paiId) return;
        const r2 = await fetch(`https://www.bling.com.br/Api/v3/produtos/${paiId}`, { headers });
        const d2 = await r2.json();
        const link = d2.data?.midia?.imagens?.internas?.[0]?.link || '';
        if (link) p.image = link;
      } catch {}
    }));
    if (i + BATCH < produtos.length) await new Promise(res => setTimeout(res, 400));
  }
  return produtos;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forcar = req.query.forcar === '1';

  // 1. Cache em memória
  if (!forcar && memCache && memCache.length > 0 && (Date.now() - memCacheTimestamp) < MEM_CACHE_TTL) {
    console.log('Cache memória:', memCache.length, 'produtos');
    return res.status(200).json({ produtos: memCache, fonte: 'memoria', total: memCache.length });
  }

  // 2. Supabase (estoque) + Bling (imagens)
  if (SUPABASE_KEY) {
    try {
      const linhas = await supabaseGetProdutos();
      if (linhas && linhas.length > 0) {
        const produtos = montarCatalogo(linhas);
        // Busca imagens frescas do Bling
        const token = await getBlingToken();
        const produtosComImagem = await buscarImagensBling(token, produtos);
        memCache = produtosComImagem;
        memCacheTimestamp = Date.now();
        console.log('Supabase+Bling imagens:', produtosComImagem.length, 'produtos');
        return res.status(200).json({ produtos: produtosComImagem, fonte: 'supabase', total: produtosComImagem.length });
      }
    } catch (e) {
      console.error('Supabase GET falhou:', e.message);
    }
  }

  // 3. Bling completo — fallback
  try {
    console.log('Fallback: buscando do Bling...');
    const token = await getBlingToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
    let pagina = 1, todos = [];
    while (true) {
      const r = await fetch(
        `https://www.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100&tipo=V&situacao=A`,
        { headers }
      );
      const d = await r.json();
      const lista = d.data || [];
      todos = todos.concat(lista);
      if (lista.length < 100) break;
      pagina++;
      await new Promise(res => setTimeout(res, 400));
    }
    if (!todos.length) return res.status(200).json({ produtos: [], fonte: 'bling', total: 0 });
    const BATCH = 3;
    const detalhes = [];
    for (let i = 0; i < todos.length; i += BATCH) {
      const lote = todos.slice(i, i + BATCH);
      const resultados = await Promise.all(lote.map(async p => {
        try {
          const r = await fetch(`https://www.bling.com.br/Api/v3/produtos/${p.id}`, { headers });
          const d = await r.json();
          return d.data || null;
        } catch { return null; }
      }));
      detalhes.push(...resultados.filter(Boolean));
      if (i + BATCH < todos.length) await new Promise(res => setTimeout(res, 400));
    }
    const grupos = {};
    for (const prod of detalhes) {
      const paiId = prod.variacao?.produtoPai?.id;
      if (!paiId) continue;
      if (!grupos[paiId]) {
        const nome = prod.nome || '';
        const nomeLower = nome.toLowerCase();
        const cat = (prod.categoria?.nome || '').toLowerCase();
        let category = 'outros';
        if (cat.includes('skinny') || nomeLower.includes('skinny')) category = 'skinny';
        else if (cat.includes('alfaiataria') || nomeLower.includes('alfaiataria')) category = 'alfaiataria';
        else if (cat.includes('bermuda') || nomeLower.includes('bermuda')) category = 'bermuda';
        else if (cat.includes('reta') || nomeLower.includes('reta')) category = 'reta';
        grupos[paiId] = {
          id: paiId,
          name: nome.replace(/\s*TAMANHO:\s*\S+/gi, '').trim(),
          ref: (prod.codigo || '').split('-')[0],
          category,
          price: prod.preco || 0,
          image: prod.midia?.imagens?.internas?.[0]?.link || '',
          variacoes: []
        };
      }
      grupos[paiId].variacoes.push({
        id: prod.id,
        tamanho: (prod.variacao?.nome || '').replace(/[^0-9]/g, '') || prod.variacao?.nome || '',
        estoque: Math.max(0, prod.estoque?.saldoVirtualTotal || 0),
        preco: prod.preco || 0
      });
    }
    const produtos = Object.values(grupos)
      .filter(p => p.variacoes.length > 0)
      .map(p => ({
        ...p,
        variacoes: [...p.variacoes].sort((a, b) =>
          parseInt(a.tamanho.replace(/[^0-9]/g, '')) - parseInt(b.tamanho.replace(/[^0-9]/g, ''))
        )
      }));
    memCache = produtos;
    memCacheTimestamp = Date.now();
    return res.status(200).json({ produtos, fonte: 'bling', total: produtos.length });
  } catch (e) {
    console.error('Erro Bling:', e.message);
    if (memCache?.length > 0) {
      return res.status(200).json({ produtos: memCache, fonte: 'cache-fallback', total: memCache.length });
    }
    return res.status(500).json({ error: e.message });
  }
}
