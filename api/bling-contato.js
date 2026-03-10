export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const token = process.env.BLING_TOKEN;
  if (!token) return res.status(500).json({ error: 'Token não configurado' });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  try {
    const { cnpj, nome, whatsapp, email } = req.body;

    if (!cnpj || !nome) {
      return res.status(400).json({ error: 'CNPJ e nome são obrigatórios.' });
    }

    const cnpjLimpo = cnpj.replace(/\D/g, '');

    // Criar contato direto — sem verificar duplicata para evitar rate limit
    // O Bling vai retornar erro se já existir
    const payload = {
      nome,
      tipo: 'J',           // campo correto na API v3
      situacao: 'A',
      numeroDocumento: cnpjLimpo,
      email: email || '',
      celular: (whatsapp || '').replace(/\D/g, ''),
    };

    const response = await fetch('https://www.bling.com.br/Api/v3/contatos', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('Bling contato:', JSON.stringify(data));

    // Se CNPJ já existe, tenta buscar o contato existente
    const jaExiste = data?.error?.fields?.some(f => f.code === 21 || f.msg?.includes('documento'));
    if (jaExiste) {
      const r = await fetch(`https://www.bling.com.br/Api/v3/contatos?tipo=J&limite=50`, { headers });
      const d = await r.json();
      const found = (d.data || []).find(c => (c.numeroDocumento || '').replace(/\D/g,'') === cnpjLimpo);
      if (found) return res.status(200).json({ data: found, jaExistia: true });
    }

    return res.status(response.status).json({ ...data, jaExistia: false });

  } catch(e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
