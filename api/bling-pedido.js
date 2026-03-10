export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const token = process.env.BLING_TOKEN;
  if (!token) return res.status(500).json({ error: 'Token não configurado' });

  try {
    const body = req.body;
    const { itens, total, observacoes, nomeCliente } = body;

    const payload = {
      numero: 0,
      data: new Date().toISOString().split('T')[0],
      dataSaida: new Date().toISOString().split('T')[0],
      dataPrevista: new Date().toISOString().split('T')[0],
      situacao: { id: 6 },
      observacoes: `Cliente: ${nomeCliente || 'Não informado'}\n${observacoes || ''}`.trim(),
      loja: { id: 0 },
      numeroPedidoCompra: '',
      outrasDespesas: 0,
      desconto: { tipo: 1, valor: 0 },
      itens: itens.map(item => ({
        codigo: item.codigo || '',
        descricao: item.nome || item.codigo || '',
        quantidade: Number(item.quantidade) || 1,
        valor: Number(item.preco) || 0,
        desconto: 0,
        unidade: 'UN'
      }))
    };

    console.log('Payload enviado:', JSON.stringify(payload));

    const response = await fetch('https://www.bling.com.br/Api/v3/pedidos/vendas', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('Resposta do Bling:', JSON.stringify(data));
    return res.status(response.status).json(data);
  } catch(e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
