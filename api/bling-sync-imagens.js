import { getBlingToken } from './bling-token.js';

const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getBlingToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    // Busca todos os produtos pai (sem traço no código)
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

          // Verifica se já tem imagem salva no Supabase Storage
          const rCheck = await fetch(
            `${SUPABASE_URL}/rest/v1/imagens_produtos?ref=eq.${ref}&select=ref,link`,
