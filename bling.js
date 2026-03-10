// ══════════════════════════════════════════
// INTEGRAÇÃO BLING — via Netlify Function (sem CORS)
// Cache local de 24 horas para carregamento instantâneo
// ══════════════════════════════════════════

const PROXY = '/api/bling';
const CACHE_KEY = 'lleva_produtos_cache';
function proximaExpiracao() {
  // Expira às 6h da manhã do próximo dia (ou hoje se ainda não passou das 6h)
  const agora = new Date();
  const expira = new Date();
  expira.setHours(6, 0, 0, 0);
  if (agora >= expira) expira.setDate(expira.getDate() + 1); // já passou das 6h, vai pro próximo dia
  return expira.getTime();
}

function salvarCache(produtos) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiraEm: proximaExpiracao(),
      produtos
    }));
  } catch(e) { console.warn('Cache não disponível', e); }
}

function lerCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { expiraEm, produtos } = JSON.parse(raw);
    if (Date.now() > expiraEm) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return produtos;
  } catch(e) { return null; }
}

function limparCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch(e) {}
}

async function blingFetch(path, params = {}) {
  const query = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`${PROXY}?${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function carregarProdutosBling(forcar = false) {
  // Tentar carregar do cache primeiro
  if (!forcar) {
    const cached = lerCache();
    if (cached && cached.length) {
      console.log(`Cache carregado: ${cached.length} produtos`);
      window.AP = cached;
      document.getElementById('pCount').textContent = cached.length + ' produto' + (cached.length !== 1 ? 's' : '');
      document.getElementById('wQtd').textContent = cached.length;
      render();
      return;
    }
  }

  mostrarLoadingCatalogo(true);
  try {
    const produtos = await fetchTodosProdutos();
    if (!produtos.length) {
      mostrarErroCatalogo('Nenhum produto ativo encontrado no Bling.');
      return;
    }

    // Buscar detalhes em paralelo com controle de rate limit
    const BATCH = 3; // 3 por vez para respeitar o limite da API
    const PAUSA = 500; // 500ms entre lotes
    const detalhes = [];
    for (let i = 0; i < produtos.length; i += BATCH) {
      const lote = produtos.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        lote.map(p => blingFetch(`/produtos/${p.id}`))
      );
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value?.data) detalhes.push(r.value.data);
      });
      // Atualizar loading com progresso
      const el = document.querySelector('#blingLoader p');
      if (el) el.textContent = `Carregando produtos... ${Math.min(i + BATCH, produtos.length)} de ${produtos.length}`;
      if (i + BATCH < produtos.length) await new Promise(r => setTimeout(r, PAUSA));
    }

    // Agrupar por produto pai
    const cards = agruparPorPai(detalhes);

    if (!cards.length) {
      mostrarErroCatalogo('Nenhum produto com estoque disponível.');
      return;
    }

    window.AP = cards;
    salvarCache(cards); // salva no cache por 24h
    document.getElementById('pCount').textContent = cards.length + ' produto' + (cards.length !== 1 ? 's' : '');
    document.getElementById('wQtd').textContent = cards.length;
    render();

  } catch (e) {
    console.error('Erro Bling:', e);
    mostrarErroCatalogo('Erro ao conectar com o Bling. Usando catálogo fixo.');
    render();
  } finally {
    mostrarLoadingCatalogo(false);
  }
}

function agruparPorPai(produtos) {
  const pais = {};   // id do pai → card
  const orphans = []; // produtos sem pai (produto simples)

  for (const prod of produtos) {
    const estoque = prod.estoque?.saldoVirtualTotal || 0;
    if (estoque <= 0) continue; // sem estoque, ignora

    const paiId = prod.variacao?.produtoPai?.id;
    const tamanho = extrairTamanho(prod.variacao?.nome || prod.nome || '');
    const image = prod.midia?.imagens?.internas?.[0]?.link || null;

    if (paiId) {
      // É uma variação — agrupa pelo pai
      if (!pais[paiId]) {
        // Nome limpo: remove "TAMANHO:XX" do nome
        const nomeBase = limparNome(prod.nome);
        pais[paiId] = {
          id: paiId,
          ref: extrairRef(prod.codigo || ''),
          name: nomeBase,
          category: detectarCategoria(nomeBase),
          variacoes: [],
          link: prod.linkExterno || '',
          image: image,
          price: parseFloat(prod.preco) || 0,
        };
      }
      if (tamanho) {
        pais[paiId].variacoes.push({
          tamanho,
          estoque,
          preco: parseFloat(prod.preco) || 0,
          codigo: prod.codigo || ''
        });
        // Usa a imagem da primeira variação que tiver
        if (!pais[paiId].image && image) pais[paiId].image = image;
      }
    } else {
      // Produto simples sem variação
      orphans.push({
        id: prod.id,
        ref: prod.codigo || String(prod.id),
        name: limparNome(prod.nome),
        category: detectarCategoria(prod.nome),
        variacoes: tamanho ? [{ tamanho, estoque, preco: parseFloat(prod.preco) || 0 }] : [],
        link: prod.linkExterno || '',
        image: image,
        price: parseFloat(prod.preco) || 0,
      });
    }
  }

  // Converter pais em array, ordenar variações por tamanho
  const cards = Object.values(pais).concat(orphans);
  cards.forEach(c => {
    c.variacoes.sort((a, b) => {
      const na = parseInt(a.tamanho) || 0;
      const nb = parseInt(b.tamanho) || 0;
      return na - nb;
    });
    c.sizes = c.variacoes.map(v => v.tamanho);
  });

  return cards;
}

function limparNome(nome) {
  return nome
    .replace(/\s*TAMANHO\s*:\s*\d+/gi, '')
    .replace(/\s*TAM\s*:\s*\d+/gi, '')
    .replace(/\s*REF\s*:\s*[\w-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairRef(codigo) {
  // "9029-48" → "9029"
  return codigo.split('-')[0] || codigo;
}

function extrairTamanho(nome) {
  const m = nome.match(/\b(3[68]|4[02468]|50|PP|P\b|M\b|G{1,3}|XG|XL|XXL)\b/i);
  return m ? m[1].toUpperCase() : '';
}

function detectarCategoria(nome) {
  const n = (nome || '').toLowerCase();
  if (n.includes('bermuda'))                              return 'bermuda';
  if (n.includes('alfaiataria') || n.includes('social')) return 'alfaiataria';
  if (n.includes('skinny') || n.includes('slim'))        return 'skinny';
  if (n.includes('reta') || n.includes('regular'))       return 'reta';
  return 'skinny';
}

async function fetchTodosProdutos() {
  let pagina = 1;
  let todos = [];
  while (true) {
    const data = await blingFetch('/produtos', { situacao: 'A', limite: 100, pagina });
    const items = data.data || [];
    console.log(`Página ${pagina}: ${items.length} produtos`);
    todos = todos.concat(items);
    if (items.length < 100) break;
    pagina++;
    // Pequena pausa para não sobrecarregar a API
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`Total de produtos carregados: ${todos.length}`);
  return todos;
}

function mostrarLoadingCatalogo(show) {
  let el = document.getElementById('blingLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'blingLoader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.92);z-index:400;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem';
    el.innerHTML = `<div style="width:36px;height:36px;border:3px solid #e5e5e5;border-top-color:#111;border-radius:50%;animation:spin .7s linear infinite"></div>
      <p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#777;font-family:Montserrat,sans-serif">Carregando produtos do Bling...</p>`;
    document.getElementById('catalog').appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}

function mostrarErroCatalogo(msg) {
  const el = document.getElementById('blingLoader');
  if (el) {
    el.innerHTML = `<p style="font-size:12px;color:#c0392b;font-family:Montserrat,sans-serif;text-align:center;padding:2rem">${msg}</p>`;
    el.style.display = 'flex';
    setTimeout(() => { el.style.display = 'none'; render(); }, 3000);
  }
}
