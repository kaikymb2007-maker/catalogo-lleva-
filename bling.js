// ══════════════════════════════════════════
// INTEGRAÇÃO BLING — via Netlify Function (sem CORS)
// ══════════════════════════════════════════

const PROXY = '/.netlify/functions/bling';
const QTD_MINIMA = 18;

async function blingFetch(path, params = {}) {
  const query = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`${PROXY}?${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function carregarProdutosBling() {
  mostrarLoadingCatalogo(true);
  try {
    const produtos = await fetchTodosProdutos();
    if (!produtos.length) {
      mostrarErroCatalogo('Nenhum produto ativo encontrado no Bling.');
      return;
    }

    const cards = [];
    for (const p of produtos) {
      const card = await montarCard(p);
      if (card) cards.push(card);
    }

    if (!cards.length) {
      mostrarErroCatalogo('Nenhum produto com estoque disponível.');
      return;
    }

    window.AP = cards;
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

async function fetchTodosProdutos() {
  let pagina = 1;
  let todos = [];
  while (true) {
    const data = await blingFetch('/produtos', { situacao: 'A', limite: 100, pagina });
    const items = data.data || [];
    todos = todos.concat(items);
    if (items.length < 100) break;
    pagina++;
  }
  return todos;
}

async function montarCard(p) {
  try {
    const data = await blingFetch(`/produtos/${p.id}`);
    const prod = data.data;

    const cat = detectarCategoria(prod.nome || '');

    if (!prod.variacoes || !prod.variacoes.length) {
      const estoque = prod.estoque?.saldoVirtualTotal || 0;
      if (estoque <= 0) return null;
      return {
        id: prod.id,
        ref: prod.codigo || String(prod.id),
        name: prod.nome,
        category: cat,
        sizes: [],
        variacoes: [],
        link: prod.urlAmigavel ? `https://lleva.com.br/produtos/${prod.urlAmigavel}/` : '',
        image: prod.midia?.imagens?.internas?.[0]?.linkMiniatura || prod.midia?.imagens?.internas?.[0]?.link || null,
        price: parseFloat(prod.preco) || 0,
        estoque
      };
    }

    const vars = prod.variacoes
      .filter(v => (v.estoque?.saldoVirtualTotal || 0) > 0)
      .map(v => ({
        tamanho: extrairTamanho(v.nome || ''),
        estoque: v.estoque?.saldoVirtualTotal || 0,
        preco: parseFloat(v.preco || prod.preco) || 0
      }))
      .filter(v => v.tamanho)
      .sort((a, b) => parseInt(a.tamanho) - parseInt(b.tamanho));

    if (!vars.length) return null;

    return {
      id: prod.id,
      ref: prod.codigo || String(prod.id),
      name: prod.nome,
      category: cat,
      sizes: vars.map(v => v.tamanho),
      variacoes: vars,
      link: prod.urlAmigavel ? `https://lleva.com.br/produtos/${prod.urlAmigavel}/` : '',
      image: prod.midia?.imagens?.internas?.[0]?.linkMiniatura || prod.midia?.imagens?.internas?.[0]?.link || null,
      price: parseFloat(prod.preco) || 0,
      estoque: vars.reduce((s, v) => s + v.estoque, 0)
    };

  } catch (e) {
    console.warn('Erro produto', p.id, e);
    return null;
  }
}

function extrairTamanho(nome) {
  const m = nome.match(/\b(3[68]|4[02468]|50|PP|P\b|M\b|G{1,3}|XG|XL|XXL)\b/i);
  return m ? m[1].toUpperCase() : '';
}

function detectarCategoria(nome) {
  const n = nome.toLowerCase();
  if (n.includes('bermuda'))                              return 'bermuda';
  if (n.includes('alfaiataria') || n.includes('social')) return 'alfaiataria';
  if (n.includes('skinny') || n.includes('slim'))        return 'skinny';
  if (n.includes('reta') || n.includes('regular'))       return 'reta';
  return 'skinny';
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
