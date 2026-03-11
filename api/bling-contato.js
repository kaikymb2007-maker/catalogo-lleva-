import { getBlingToken } from './bling-token.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const token = await getBlingToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const { cnpj, nome, whatsapp, email, cep, cidade, bairro } = req.body;
    if (!cnpj || !nome) return res.status(400).json({ error: 'CNPJ e nome são obrigatórios.' });

    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const cepLimpo  = (cep || '').replace(/\D/g, '');

    const payload = {
      nome,
      tipo: 'J',
      situacao: 'A',
      numeroDocumento: cnpjLimpo,
      email: email || '',
      celular: (whatsapp || '').replace(/\D/g, ''),
      endereco: {
        geral: {
          endereco: '',
          numero: 'S/N',
          complemento: '',
          bairro: bairro || '',
          cep: cepLimpo,
          municipio: cidade || '',
          uf: ''
        }
      }
    };

    const response = await fetch('https://www.bling.com.br/Api/v3/contatos', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();
    console.log('Bling contato:', JSON.stringify(data));

    const cnpjDuplicado = data?.error?.fields?.some(f => f.element === 'cnpj');
    if (cnpjDuplicado) return res.status(200).json({ data: { id: 0 }, jaExistia: true });

    return res.status(response.status).json({ ...data, jaExistia: false });

  } catch(e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
