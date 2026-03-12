import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseGetVariacoes() {
  // Busca variações (codigo com traço) — estoque ao vivo
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/produtos?select=id,nome,codigo,preco,estoque,situacao&situacao=eq.A&codigo=like.*-*&order=codigo.asc`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  if (!r.ok) throw new Error(`Supabase variacoes erro: ${r.status}`);
  return await r.json();
}

async function supabaseGetPais() {
  // Busca produtos pai (codigo SEM traço) — para pegar imagem fresca
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/produtos?select=codigo,midia&situacao=eq.A&codigo=not.like.*-*`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  if (!r.ok) throw new Error(`Supabase pais erro: ${r.status}`);
  return await r.json();
}

function linkValido(link) {
  if (!link) return false;
  const match = link.match(/Expires=(\d+)/);
  if (!match) return true;
  const expires = parseInt(match[1]);
  const agora = Math.floor(Date.now() / 1000);
  return expires > agora + 3600;
}

function detectarCategoria(nome = '') {
  const n = nome.toLowerCase();
  if (n.includes('skinny')) return 'skinny';
  if (n.includes('alfaiataria') || n.includes('alfaitaria')) return 'alfaiataria';
  if (n.includes('bermuda')) return 'bermuda';
  if (n.includes('reta')) return 'reta';
  return 'outros';
}

async function renovarImagemBling(token, varId) {
  try {
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
    const r = await fetch(`https://www.bling.com.br/Api/v3/produtos/${varId}`, { headers });
    const d = await r.json();
    return d.data?.midia?.imagens?.internas?.[0]?.link || '';
  } catch { return ''; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Busca variações e produtos pai em paralelo
    const [variacoes, pais] = await Promise.all([
      supabaseGetVariacoes(),
      supabaseGetPais()
    ]);

    if (!variacoes?.length) throw new Error('Supabase retornou vazio');

    // Monta mapa ref -> imagem válida a partir dos produtos pai
    const imagensMap = {};
    for (const pai of (pais || [])) {
      const ref = (pai.codigo || '').trim();
      if (!ref) continue;
      const link = pai.midia?.imagens?.internas?.[0]?.link || '';
      if (linkValido(link)) imagensMap[ref] = link;
    }
    console.log('Imagens válidas do Supabase:', Object.keys(imagensMap).length);

    // Monta catálogo agrupando variações por ref
    const grupos = {};
    for (const row of variacoes) {
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

    let produtos = Object.values(grupos)
      .filter(p => p.variacoes.length > 0)
      .map(p => ({
        ...p,
        variacoes: [...p.variacoes].sort((a, b) => parseInt(a.tamanho) - parseInt(b.tamanho))
      }));

    // Renova imagens expiradas via Bling (só os que precisam)
    const semImagem = produtos.filter(p => !p.image);
    if (semImagem.length > 0) {
      console.log('Renovando', semImagem.length, 'imagens via Bling...');
      const token = await getBlingToken();
      const BATCH = 3;
      for (let i = 0; i < semImagem.length; i += BATCH) {
        const lote = semImagem.slice(i, i + BATCH);
        await Promise.all(lote.map(async p => {
          const varId = p.variacoes[0]?.id;
          if (!varId) return;
          const link = await renovarImagemBling(token, varId);
          if (link) p.image = link;
        }));
        if (i + BATCH < semImagem.length) await new Promise(res => setTimeout(res, 350));
      }
    }

    const comImagem = produtos.filter(p => p.image).length;
    console.log('Total:', produtos.length, '| Com imagem:', comImagem, '| Sem:', produtos.length - comImagem);
    return res.status(200).json({ produtos, fonte: 'supabase', total: produtos.length });

  } catch (e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
