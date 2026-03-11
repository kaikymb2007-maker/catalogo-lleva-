// Utilitário de token — usado por todas as outras functions
// Faz refresh automático quando necessário

let cachedToken = null;
let tokenExpiraEm = 0;

export async function getBlingToken() {
  // Se ainda tem token válido com 5min de margem, usa ele
  if (cachedToken && Date.now() < tokenExpiraEm - 300000) {
    return cachedToken;
  }

  const clientId     = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const refreshToken = process.env.BLING_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    // Fallback para o token manual se as credenciais OAuth não estiverem configuradas
    if (process.env.BLING_TOKEN) return process.env.BLING_TOKEN;
    throw new Error('Credenciais Bling não configuradas.');
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
      refresh_token: refreshToken
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Erro ao renovar token Bling:', err);
    // Fallback para token manual
    if (process.env.BLING_TOKEN) return process.env.BLING_TOKEN;
    throw new Error('Falha ao renovar token Bling.');
  }

  const data = await res.json();
  cachedToken  = data.access_token;
  tokenExpiraEm = Date.now() + (data.expires_in * 1000);

  console.log('Token Bling renovado com sucesso. Expira em:', data.expires_in, 'segundos');
  return cachedToken;
}
