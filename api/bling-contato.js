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

    // Verificar se já existe — busca direta por documento
    try {
      const r = await fetch(`https://www.bling.com.br/Api/v3/contatos?tipoPessoa=J&limite=100&criterio=6`, { headers });
      const d = await r.json();
      const lista = d.data || [];
      const found = lista.find(c => (c.numeroDocumento || '').replace(/\D/g, '') === cnpjLimpo);
      if (found) {
        return res.status(200).json({ data: found, jaExistia: true });
      }
    } catch(e) {
      console.warn('Erro ao verificar contato existente, continuando cadastro:', e.message);
    }

    // Criar novo contato
    const payload = {
      nome,
      tipoPessoa: 'J',
      situacao: 'A',
      numeroDocumento: cnpjLimpo,
      email: email || '',
      telefone: (whatsapp || '').replace(/\D/g, ''),
      celular: (whatsapp || '').replace(/\D/g, ''),
    };

    const response = await fetch('https://www.bling.com.br/Api/v3/contatos', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('Novo contato Bling:', JSON.stringify(data));
    return res.status(response.status).json({ ...data, jaExistia: false });

  } catch(e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
