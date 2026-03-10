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
    const { itens, total, observacoes, nomeCliente, cnpj, contatoId } = req.body;

    // 1. Resolver id do contato — usa o que veio do frontend, ou busca pelo CNPJ
    let idContato = contatoId && contatoId !== 0 ? contatoId : null;

    if (!idContato && cnpj) {
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      // Busca paginada até encontrar
      let pagina = 1;
      let found = null;
      while (!found && pagina <= 5) {
        const r = await fetch(`https://www.bling.com.br/Api/v3/contatos?tipoPessoa=J&limite=100&pagina=${pagina}`, { headers });
        const d = await r.json();
        const lista = d.data || [];
        found = lista.find(c => (c.numeroDocumento || '').replace(/\D/g, '') === cnpjLimpo);
        if (!lista.length || lista.length < 100) break;
        pagina++;
      }
      if (found) idContato = found.id;
    }

    if (!idContato) {
      return res.status(400).json({ error: 'Contato não encontrado no Bling para este CNPJ. Cadastre o cliente primeiro.' });
    }

    // 2. Montar itens — usa id do produto variação se disponível
    const itensFormatados = itens.map(item => {
      if (item.produtoId) {
        return {
          produto: { id: item.produtoId },
          quantidade: Number(item.quantidade) || 1,
          valor: Number(item.preco) || 0,
          desconto: 0,
          unidade: 'UN'
        };
      }
      return {
        descricao: item.nome || item.codigo,
        quantidade: Number(item.quantidade) || 1,
        valor: Number(item.preco) || 0,
        desconto: 0,
        unidade: 'UN'
      };
    });

    const payload = {
      numero: 0,
      data: new Date().toISOString().split('T')[0],
      dataSaida: new Date().toISOString().split('T')[0],
      dataPrevista: new Date().toISOString().split('T')[0],
      situacao: { id: 15 },
      contato: { id: idContato },
      observacoes: `${nomeCliente || ''}\n${observacoes || ''}`.trim(),
      loja: { id: 0 },
      numeroPedidoCompra: '',
      outrasDespesas: 0,
      desconto: { tipo: 1, valor: 0 },
      itens: itensFormatados
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
