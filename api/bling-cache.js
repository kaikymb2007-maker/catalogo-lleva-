import { getBlingToken } from './bling-token.js';

// Cache em memória do servidor — compartilhado entre todos os clientes
let serverCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h como fallback de segurança

async function fetchTodosProdutos(token) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  };

  // 1. Buscar todas as variações com estoque
  let pagina = 1, todos = [];
  while (true) {
    const r = await fetch(`https://www.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100&tipo=V&situacao=A&estoque=S`, { headers });
    const d = await r.json();
    const lista = d.data || [];
    todos = todos.concat(lista);
    if (lista.length < 100) break;
    pagina++;
    await new Promise(res => setTimeout(res, 400));
  }

  if (!todos.length) return [];

  // 2. Buscar detalhes em lotes de 3
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

  // 3. Agrupar por produto pai
  const grupos = {};
  for (const prod of detalhes) {
    const paiId = prod.variacao?.produtoPai?.id;
    if (!paiId) continue;
    if (!grupos[paiId]) {
      // Detectar categoria pelo nome do produto
      const nomeCompleto = prod.nome || '';
      let category = 'outros';
      const nomeLower = nomeCompleto.toLowerCase();
      if (nomeLower.includes('skinny')) category = 'skinny';
      else if (nomeLower.includes('alfaiataria')) category = 'alfaiataria';
      else if (nomeLower.includes('bermuda')) category = 'bermuda';
      else if (nomeLower.includes('reta')) category = 'reta';

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
      tamanho: prod.variacao?.nome || '',
      estoque: prod.estoque?.saldoVirtualTotal || 0,
      preco: prod.preco || 0
    });
  }

  return Object.values(grupos).filter(p => p.variacoes.length > 0);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forcar = req.query.forcar === '1';

  // Se tem cache válido e não está forçando, retorna imediatamente
  if (!forcar && serverCache && serverCache.length > 0 && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    console.log('Cache servidor: retornando', serverCache.length, 'produtos');
    return res.status(200).json({ produtos: serverCache, fonte: 'cache', total: serverCache.length });
  }

  // Buscar do Bling
  try {
    console.log('Buscando produtos do Bling...');
    const token = await getBlingToken();
    const produtos = await fetchTodosProdutos(token);

    if (produtos.length > 0) {
      serverCache = produtos;
      cacheTimestamp = Date.now();
      console.log('Cache servidor atualizado:', produtos.length, 'produtos');
    }

    return res.status(200).json({ produtos, fonte: 'bling', total: produtos.length });
  } catch(e) {
    console.error('Erro ao buscar produtos:', e.message);
    // Se tem cache antigo, usa ele
    if (serverCache && serverCache.length > 0) {
      return res.status(200).json({ produtos: serverCache, fonte: 'cache-fallback', total: serverCache.length });
    }
    return res.status(500).json({ error: e.message });
  }
}
