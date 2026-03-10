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
    const { itens, total, observacoes, nomeCliente, cnpj } = req.body;

    // 1. Buscar id do contato pelo CNPJ
    let contatoId = null;
    if (cnpj) {
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      const resContato = await fetch(`https://www.bling.com.br/Api/v3/contatos?tipoPessoa=J&limite=100`, { headers });
      const dataContato = await resContato.json();
      const contatos = dataContato.data || [];
      const found = contatos.find(c => (c.numeroDocumento || '').replace(/\D/g, '') === cnpjLimpo);
      if (found) contatoId = found.id;
    }

    // 2. Buscar id de cada produto pelo código SKU
    const itensComId = [];
    for (const item of itens) {
      try {
        const resProd = await fetch(`https://www.bling.com.br/Api/v3/produtos?codigo=${encodeURIComponent(item.codigo)}&limite=5`, { headers });
        const dataProd = await resProd.json();
        const produtos = dataProd.data || [];
        const prod = produtos.find(p => p.codigo === item.codigo);
        if (prod) {
          itensComId.push({
            produto: { id: prod.id },
            quantidade: Number(item.quantidade) || 1,
            valor: Number(item.preco) || 0,
            desconto: 0,
            unidade: 'UN'
          });
        } else {
          // Fallback sem id — vai pelo código
          itensComId.push({
            codigo: item.codigo,
            descricao: item.nome || item.codigo,
            quantidade: Number(item.quantidade) || 1,
            valor: Number(item.preco) || 0,
            desconto: 0,
            unidade: 'UN'
          });
        }
      } catch(e) {
        console.warn('Erro ao buscar produto', item.codigo, e.message);
      }
    }

    const payload = {
      numero: 0,
      data: new Date().toISOString().split('T')[0],
      dataSaida: new Date().toISOString().split('T')[0],
      dataPrevista: new Date().toISOString().split('T')[0],
      situacao: { id: 6 },
      observacoes: `${nomeCliente || ''}\n${observacoes || ''}`.trim(),
      loja: { id: 0 },
      numeroPedidoCompra: '',
      outrasDespesas: 0,
      desconto: { tipo: 1, valor: 0 },
      ...(contatoId ? { contato: { id: contatoId } } : {}),
      itens: itensComId
    };

    console.log('Payload:', JSON.stringify(payload));

    const response = await fetch('https://www.bling.com.br/Api/v3/pedidos/vendas', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('Bling response:', JSON.stringify(data));
    return res.status(response.status).json(data);

  } catch(e) {
    console.error('Erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
