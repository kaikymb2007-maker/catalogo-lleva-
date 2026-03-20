const SUPABASE_URL = 'https://demspfxcneotrllfizwe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cache em memória para evitar hits desnecessários no Supabase
let memCache = { accessToken: null, expiresAt: 0 };

async function lerTokenDoSupabase() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/bling_tokens?id=eq.1&select=*`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) throw new Error(`Supabase leitura token erro: ${r.status}`);
  const rows = await r.json();
  if (!rows?.length) throw new Error('Nenhum token encontrado na tabela bling_tokens.');
  return rows[0];
}

async function salvarTokenNoSupabase(accessToken, refreshToken, expiresAt) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/bling_tokens?id=eq.1`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        atualizado_em: new Date().toISOString()
      })
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase salvar token erro: ${err}`);
  }
}

export async function getBlingToken() {
  // 1. Verifica cache em memória (margem de 10 min)
  if (memCache.accessToken && Date.now() < memCache.expiresAt - 600000) {
    return memCache.accessToken;
  }

  // 2. Busca token do Supabase
  const row = await lerTokenDoSupabase();

  // 3. Se ainda válido (margem de 10 min), usa direto
  if (row.access_token && Date.now() < row.expires_at - 600000) {
    memCache = { accessToken: row.access_token, expiresAt: row.expires_at };
    return row.access_token;
  }

  // 4. Token expirado — faz refresh
  console.log('Token Bling expirado, renovando...');

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('BLING_CLIENT_ID ou BLING_CLIENT_SECRET não configurados.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Falha ao renovar token Bling: ${err}`);
  }

  const data = await res.json();

  const novoAccessToken = data.access_token;
  const novoRefreshToken = data.refresh_token || row.refresh_token;
  const novoExpiresAt = Date.now() + (data.expires_in * 1000);

  // 5. Salva no Supabase
  await salvarTokenNoSupabase(novoAccessToken, novoRefreshToken, novoExpiresAt);

  // 6. Atualiza cache em memória
  memCache = { accessToken: novoAccessToken, expiresAt: novoExpiresAt };

  console.log('Token Bling renovado e salvo no Supabase com sucesso.');
  return novoAccessToken;
}
