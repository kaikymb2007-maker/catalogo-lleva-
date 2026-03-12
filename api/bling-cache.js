import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABELA = 'Catálogo_Produtos';

// Cache em memória — 10min
let memCache = null;
let memCacheTimestamp = 0;
const MEM_CACHE_TTL = 10 * 60 * 1000;

// ─── Supabase: só leitura, nunca escrita ──────────────────────
async function supabaseGet() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(TABELA)}?select=*`,
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

// ─── Converter variações do formato Supabase → catálogo ───────
function normalizarVariacoes(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];

  return raw.map(v => {
    // Formato Supabase: {Codigo: "9097-38", saldoVirtualTotal: 29}
    if (v.Codigo !== undefined) {
      const partes = String(v.Codigo).split('-');
      return {
        id: v.Codigo,
        tamanho: partes[partes.length - 1],
        estoque: v.saldoVirtualTotal || 0,
        preco: 0
      };
    }
    // Formato alternativo: {id, tamanho, estoque, preco}
    return {
      id: v.id || '',
      tamanho: String(v.tamanho || ''),
      estoque: v.estoque || 0,
      preco: v.preco || 0
    };
  })
  .filter(v => v.tamanho)
  .sort((a, b) => parseInt(a.tamanho) - parseInt(b.tamanho));
}

function detectarCategoria(nome = '') {
  const n = nome.toLowerCase();
  if (n.includes('skinny')) return 'skinny';
  if (n.includes('alfaiataria')) return 'alfaiataria';
  if (n.includes('bermuda')) return 'bermuda';
  if (n.includes('reta')) return 'reta';
  return 'outros';
}

function supabaseParaCatalogo(linhas) {
  return linhas
    .map(row => ({
      id: row['Id'],
      name: row['Nome'],
      ref: row['Código'],
      category: detectarCategoria(row['Nome']),
      price: row['Preco'],
      image: Array.isArray(row['Imagens']) ? row['Imagens'][0] || '' : '',
      variacoes: normalizarVariacoes(row['Variações'] || [])
    }))
    .filter(p => p.variacoes.length > 0);
}

// ─── Handler principal ────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forcar = req.query.forcar === '1';

  // 1. Cache em memória — mais rápido
  if (!forcar && memCache && memCache.length > 0 && (Date.now() - memCacheTimestamp) < MEM_CACHE_TTL) {
    console.log('Cache memória:', memCache.length, 'produtos');
    return res.status(200).json({ produtos: memCache, fonte: 'memoria', total: memCache.length });
  }

  // 2. Supabase — fonte principal, só leitura
  if (SUPABASE_KEY) {
    try {
      const linhas = await supabaseGet();
      if (linhas && linhas.length > 0) {
        const produtos = supabaseParaCatalogo(linhas);
        memCache = produtos;
        memCacheTimestamp = Date.now();
        console.log('Cache Supabase:', produtos.length, 'produtos');
        return res.status(200).json({ produtos, fonte: 'supabase', total: produtos.length });
      }
    } catch (e) {
      console.error('Supabase GET falhou:', e.message);
    }
  }

  // 3. Bling — fallback se Supabase falhar (sem upsert!)
  try {
    console.log('Fallback: buscando produtos do Bling...');
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
        const nomeCompleto = prod.nome || '';
        const nomeLower = nomeCompleto.toLowerCase();
        const catBling = (prod.categoria?.nome || '').toLowerCase();
        let category = 'outros';
        if (catBling.includes('skinny') || nomeLower.includes('skinny')) category = 'skinny';
        else if (catBling.includes('alfaiataria') || nomeLower.includes('alfaiataria')) category = 'alfaiataria';
        else if (catBling.includes('bermuda') || nomeLower.includes('bermuda')) category = 'bermuda';
        else if (catBling.includes('reta') || nomeLower.includes('reta')) category = 'reta';
        grupos[paiId] = {
          id: paiId,
          name: nomeCompleto.replace(/\s*TAMANHO:\s*\S+/gi, '').trim(),
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
        estoque: prod.estoque?.saldoVirtualTotal || 0,
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
