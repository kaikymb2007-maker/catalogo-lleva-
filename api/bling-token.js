// Auto-refresh token com persistência no Vercel KV
// O refresh_token é atualizado a cada renovação, nunca expira

let memCache = { accessToken: null, expiresAt: 0 };

async function salvarRefreshToken(refreshToken) {
  // Salvar no Vercel KV se disponível, senão só em memória
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      await fetch(`${process.env.KV_REST_API_URL}/set/bling_refresh_token/${encodeURIComponent(refreshToken)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      console.log('Refresh token salvo no KV');
    }
  } catch(e) {
    console.warn('KV não disponível, usando apenas env var:', e.message);
  }
}

async function lerRefreshToken() {
  // Tentar ler do KV primeiro (mais atualizado), senão usa env var
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const res = await fetch(`${process.env.KV_REST_API_URL}/get/bling_refresh_token`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const data = await res.json();
      if (data.result) {
        console.log('Refresh token lido do KV');
        return data.result;
      }
    }
  } catch(e) {
    console.warn('KV não disponível, usando env var');
  }
  return process.env.BLING_REFRESH_TOKEN;
}

export async function getBlingToken() {
  // Token ainda válido (com 5min de margem)?
  if (memCache.accessToken && Date.now() < memCache.expiresAt - 300000) {
    return memCache.accessToken;
  }

  const clientId     = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    if (process.env.BLING_TOKEN) return process.env.BLING_TOKEN;
    throw new Error('Credenciais Bling não configuradas.');
  }

  const refreshToken = await lerRefreshToken();
  if (!refreshToken) throw new Error('Refresh token não encontrado.');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Erro ao renovar token Bling:', err);
    if (process.env.BLING_TOKEN) return process.env.BLING_TOKEN;
    throw new Error('Falha ao renovar token Bling. Gere um novo refresh_token no Bling.');
  }

  const data = await res.json();

  // Salvar novo access token em memória
  memCache.accessToken = data.access_token;
  memCache.expiresAt   = Date.now() + (data.expires_in * 1000);

  // Salvar novo refresh_token para nunca expirar
  if (data.refresh_token) {
    await salvarRefreshToken(data.refresh_token);
    console.log('Tokens renovados com sucesso!');
  }

  return memCache.accessToken;
}
