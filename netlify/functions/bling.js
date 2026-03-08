// Netlify Function — proxy seguro para API Bling
// O token fica na variável de ambiente BLING_TOKEN (nunca exposto no frontend)

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const token = process.env.BLING_TOKEN;
  if (!token) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token não configurado' }) };
  }

  try {
    const path = event.queryStringParameters?.path || '/produtos';
    const params = { ...event.queryStringParameters };
    delete params.path;

    const query = new URLSearchParams(params).toString();
    const url = `https://www.bling.com.br/Api/v3${path}${query ? '?' + query : ''}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await res.json();
    return { statusCode: res.status, headers, body: JSON.stringify(data) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
