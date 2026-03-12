import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseGetVariacoes() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/produtos?select=id,nome,codigo,preco,estoque&situacao=eq.A&codigo=like.*-*&order=codigo.asc`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!r.ok) throw new Error(`Supabase variacoes erro: ${r.status}`);
  return await r.json();
}

async function supabaseGetImagens() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/imagens_produtos?select=ref,link`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!r.ok) throw new Error(`Supabase imagens erro: ${r.status}`);
  const rows = await r.json();
  const map = {};
  for (const row of rows) map[row.ref] = row.link;
  return map;
}

function detectarCategoria(nome = '') {
  const n = nome.toLowerCase();
  if (n.includes('skinny')) return 'skinny';
  if (n.includes('alfaiataria') || n.includes('alfaitaria')) return 'alfaiataria';
  if (n.includes('bermuda')) return 'bermuda';
  if (n.includes('reta')) return 'reta';
  return 'outros';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Busca estoque e imagens em paralelo — tudo do Supabase, instantâneo
    const [variacoes, imagensMap] = await Promise.all([
      supabaseGetVariacoes(),
      supabaseGetImagens()
    ]);

    if (!variacoes?.length) throw new Error('Supabase retornou vazio');

    // Monta catálogo agrupando por ref
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

    const produtos = Object.values(grupos)
      .filter(p => p.variacoes.length > 0)
      .map(p => ({
        ...p,
        variacoes: [...p.variacoes].sort((a, b) => parseInt(a.tamanho) - parseInt(b.tamanho))
      }));

    const comImagem = produtos.filter(p => p.image).length;
    console.log('Total:', produtos.length, '| Com imagem:', comImagem);
    return res.status(200).json({ produtos, fonte: 'supabase', total: produtos.length });

  } catch (e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
