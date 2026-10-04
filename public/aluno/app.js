import {
  brand, createApi, fmtDate, h, initials, isStaffRole, modal, renderAttachments, renderComments, richText,
  ROLE_LABEL, timeAgo, toast,
} from '/shared/common.js';

const api = createApi('/api/aluno');
const app = document.getElementById('app');
const state = { me: null, categories: [], category: '', tab: 'all', q: '', posts: [], unread: 0, offset: 0, done: false };

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    state.me = await api('/me');
    state.categories = await api('/categories');
    route();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return renderLogin();
    app.replaceChildren(h('div.empty', h('div.big', '⚠️'), 'Não foi possível carregar. ', err.message));
  }
}
window.addEventListener('hashchange', () => state.me && route());

function renderLogin() {
  const err = h('div.login-error');
  const user = h('input.input', { name: 'username', placeholder: 'Matrícula ou e-mail', autocomplete: 'username', required: true });
  const pass = h('input.input', { name: 'password', type: 'password', placeholder: 'Senha', autocomplete: 'current-password', required: true });
  const btn = h('button.btn.btn-primary', { type: 'submit', style: { padding: '13px' } }, 'Entrar');
  app.replaceChildren(h('div.login-wrap',
    h('form.login-card', {
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        try { await api('/auth/login', { method: 'POST', body: { username: user.value, password: pass.value } }); await boot(); }
        catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      },
    },
    brand(),
    h('div', h('h1', 'Portal do Aluno'), h('p.muted', 'Comunicados, provas e avisos da escola num só lugar.')),
    user, pass, err, btn,
    h('p.muted.small', { style: { textAlign: 'center' } }, 'Esqueceu a senha? Procure a coordenação para redefinir.'))));
  user.focus();
}

// ------------------------------------------------------------------ layout
const NAV = [
  { hash: '#/', ico: '🏠', label: 'Início' },
  { hash: '#/busca', ico: '🔍', label: 'Explorar' },
  { hash: '#/notificacoes', ico: '🔔', label: 'Notificações', count: () => state.me.unread_notifications },
  { hash: '#/perfil', ico: '👤', label: 'Perfil' },
];
const current = () => (location.hash || '#/').split('?')[0];

function shell(mainChildren) {
  const navItem = (n) => h(`a.nav-item${current() === n.hash ? '.active' : ''}`, { href: n.hash },
    h('span.ico', n.ico, n.count?.() ? h('span.nav-count', n.count()) : null), h('span.label', n.label));
  const side = h('nav.side-nav', brand(), NAV.map(navItem),
    h('button.nav-item', { onclick: logout }, h('span.ico', '🚪'), h('span.label', 'Sair')),
    h('a.me-card', { href: '#/perfil' }, h('div.avatar', initials(state.me.name)),
      h('div.meta', h('div', { style: { fontWeight: 700 } }, state.me.name), h('div.muted.small', `${state.me.serie || ''} ${state.me.turma || ''}`.trim() || state.me.matricula))));
  const right = h('aside.right',
    h('form.search', { onsubmit: (e) => { e.preventDefault(); state.q = e.target.q.value; location.hash = '#/'; loadFeed(true); } },
      h('input.input', { name: 'q', placeholder: 'Buscar comunicados', value: state.q })),
    pinnedBox(), categoriesBox());
  const bottom = h('nav.bottom-nav', NAV.map((n) => h(`button${current() === n.hash ? '.active' : ''}`, { onclick: () => { location.hash = n.hash; }, 'aria-label': n.label },
    n.ico, n.count?.() ? h('span.nav-count', n.count()) : null)));
  app.replaceChildren(h('div.shell', side, h('main.main', mainChildren), right), bottom);
}

function pinnedBox() {
  const pinned = state.posts.filter((p) => p.pinned).slice(0, 4);
  return h('div.box', h('h3', '📌 Fixados'),
    pinned.length ? pinned.map((p) => h('a.box-item', { href: `#/post/${p.id}` }, h('div.muted.small', p.category_name || 'Comunicado'), h('div.t', p.title)))
      : h('div.box-item.muted.small', 'Nenhum comunicado fixado.'));
}
function categoriesBox() {
  return h('div.box', h('h3', 'Categorias'), state.categories.map((c) => h('a.box-item', {
    onclick: () => { state.category = c.slug; location.hash = '#/'; loadFeed(true); },
  }, h('div.t', `${c.icon} ${c.name}`))), h('div.box-item.muted.small', '© TiraConnect'));
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  location.hash = '#/';
  renderLogin();
}

// ------------------------------------------------------------------ rotas
function route() {
  const hash = current();
  const postMatch = hash.match(/^#\/post\/(\d+)/);
  if (postMatch) {
    if (!state.posts.length) renderFeed().then(() => openPost(postMatch[1]));
    else openPost(postMatch[1]);
    return;
  }
  if (hash === '#/notificacoes') return renderNotifications();
  if (hash === '#/perfil') return renderProfile();
  if (hash === '#/busca') return renderSearch();
  renderFeed();
}

// ------------------------------------------------------------------ feed
async function loadFeed(reset) {
  if (reset) { state.offset = 0; state.done = false; }
  const params = new URLSearchParams({ limit: 20, offset: state.offset });
  if (state.category) params.set('category', state.category);
  if (state.q) params.set('q', state.q);
  if (state.tab === 'unread') params.set('unread', '1');
  const data = await api(`/feed?${params}`);
  state.posts = reset ? data.posts : state.posts.concat(data.posts);
  state.unread = data.unread;
  state.offset += data.posts.length;
  state.done = data.posts.length < 20;
  if (reset && current() === '#/') paintFeed();
  return data;
}

async function renderFeed() {
  shell(h('div.spinner'));
  await loadFeed(true);
  paintFeed();
}

function paintFeed() {
  const tab = (key, label, count) => h(`button.tab${state.tab === key ? '.active' : ''}`,
    { onclick: () => { state.tab = key; loadFeed(true); } }, label, count ? h('span.count', count) : null);
  const story = (slug, icon, name) => h(`button.story${state.category === slug ? '.on' : ''}`,
    { onclick: () => { state.category = state.category === slug ? '' : slug; loadFeed(true); } },
    h('div.ring', h('div.inner', icon)), h('span', name));

  const filters = [];
  if (state.q) filters.push(h('button.chip', { onclick: () => { state.q = ''; loadFeed(true); } }, `🔍 "${state.q}" ✕`));
  if (state.category) {
    const c = state.categories.find((x) => x.slug === state.category);
    filters.push(h('button.chip', { onclick: () => { state.category = ''; loadFeed(true); } }, `${c ? c.name : 'Urgente'} ✕`));
  }

  shell([
    h('div.top-bar',
      h('div.top-row', h('div.mobile-only', brand()), h('h1.desk-only', 'Início'),
        h('a.btn.btn-ghost.btn-icon.mobile-only', { href: '#/notificacoes', 'aria-label': 'Notificações', style: { position: 'relative' } },
          '🔔', state.me.unread_notifications ? h('span.nav-count', state.me.unread_notifications) : null)),
      h('div.tabs', tab('all', 'Para você'), tab('unread', 'Não lidos', state.unread))),
    h('div.stories', story('', '✨', 'Tudo'), story('urgente', '🚨', 'Urgente'),
      state.categories.map((c) => story(c.slug, c.icon, c.name))),
    filters.length ? h('div', { style: { display: 'flex', gap: '8px', padding: '10px 16px', borderBottom: '1px solid var(--line)' } }, filters) : null,
    state.posts.length ? state.posts.map(postCard)
      : h('div.empty', h('div.big', state.tab === 'unread' ? '✅' : '📭'), state.tab === 'unread' ? 'Você está em dia! Nada pendente.' : 'Nenhum comunicado encontrado.'),
    !state.done && state.posts.length ? h('div.load-more', h('button.btn', { onclick: async (e) => { e.target.disabled = true; await loadFeed(false); paintFeed(); } }, 'Carregar mais')) : null,
  ]);
}

function authorLine(p) {
  return h('div.post-head',
    h('span.name', p.author_name),
    isStaffRole(p.author_role) ? h('span.verified', { title: ROLE_LABEL[p.author_role] }, '✔') : null,
    h('span.muted', `· ${ROLE_LABEL[p.author_role] || ''} · ${timeAgo(p.publish_at)}`));
}

function tags(p) {
  return h('div.post-tags',
    p.urgent ? h('span.badge-urgent', '🚨 URGENTE') : null,
    p.category_name ? h('span.chip', { style: { color: p.category_color, borderColor: `${p.category_color}55`, background: `${p.category_color}1f` } }, `${p.category_icon} ${p.category_name}`) : null);
}

function postCard(p) {
  return h(`article.post${p.urgent ? '.urgent' : ''}${p.viewed_at ? '' : '.unseen'}`, { onclick: () => { location.hash = `#/post/${p.id}`; } },
    h(`div.avatar${isStaffRole(p.author_role) ? '.staff' : ''}`, initials(p.author_name)),
    h('div.post-col',
      p.pinned ? h('div.pin-line', '📌 Fixado pela coordenação') : null,
      authorLine(p),
      tags(p),
      h('div.post-title', p.title),
      p.body ? richText(p.body, 'post-body.clamp') : null,
      renderAttachments(p.attachments),
      h('div.actions',
        h('button.act', { title: 'Comentários' }, '💬', p.comment_count),
        h('span.act', { title: 'Visualizações' }, '👁', p.view_count),
        h(`button.act${p.read_at ? '.read' : ''}`, {
          title: 'Marcar como lido',
          onclick: async (e) => {
            e.stopPropagation();
            if (p.read_at) return;
            await api(`/posts/${p.id}/read`, { method: 'POST' });
            p.read_at = p.viewed_at = new Date().toISOString();
            toast('Marcado como lido ✓');
            paintFeed();
          },
        }, p.read_at ? '✅ Lido' : '☑️ Marcar lido'))));
}
// ------------------------------------------------------------------ detalhe do comunicado
async function openPost(id) {
  let p;
  try { p = await api(`/posts/${id}`); } catch (err) { toast(err.message, true); location.hash = '#/'; return; }
  const local = state.posts.find((x) => x.id === p.id);
  if (local && !local.viewed_at) { local.viewed_at = new Date().toISOString(); state.unread = Math.max(0, state.unread - 1); }
  let replyTo = null;
  const commentsBox = h('div');
  const replyInfo = h('div.reply-to', { hidden: true });
  const text = h('textarea.input', { placeholder: 'Escreva um comentário…', maxlength: 2000 });
  const asQuestion = h('input', { type: 'checkbox' });

  const paintComments = () => commentsBox.replaceChildren(renderComments(p.comments, {
    onReply: (c) => {
      replyTo = c;
      replyInfo.hidden = false;
      replyInfo.replaceChildren(h('span', `Respondendo a ${c.author_name}`), h('button.btn.btn-ghost.btn-sm', { onclick: clearReply }, 'Cancelar'));
      text.focus();
    },
    onDelete: async (c) => {
      if (!confirm('Excluir seu comentário?')) return;
      await api(`/comments/${c.id}`, { method: 'DELETE' });
      await refresh();
    },
  }));
  const clearReply = () => { replyTo = null; replyInfo.hidden = true; };
  const refresh = async () => { p = await api(`/posts/${id}`); paintComments(); };

  const readBtn = h(`button.btn.btn-sm${p.read_at ? '' : '.btn-blue'}`, {
    disabled: !!p.read_at,
    onclick: async () => {
      await api(`/posts/${p.id}/read`, { method: 'POST' });
      readBtn.textContent = '✅ Lido'; readBtn.disabled = true; readBtn.classList.remove('btn-blue');
      if (local) local.read_at = new Date().toISOString();
      toast('Comunicado marcado como lido');
    },
  }, p.read_at ? '✅ Lido' : '☑️ Marcar como lido');

  paintComments();
  const m = modal('Comunicado', [
    h('div.detail-head', h(`div.avatar${isStaffRole(p.author_role) ? '.staff' : ''}`, initials(p.author_name)), h('div', authorLine(p), h('div.muted.small', fmtDate(p.publish_at)))),
    tags(p),
    h('h2.detail-title', p.title),
    richText(p.body),
    renderAttachments(p.attachments),
    h('div.read-bar', h('span.muted.small', `💬 ${countAll(p.comments)} comentário(s)`), readBtn),
    commentsBox,
    h('form', {
      style: { display: 'grid', gap: '8px' },
      onsubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim()) return;
        try {
          await api(`/posts/${p.id}/comments`, { method: 'POST', body: { body: text.value, parent_id: replyTo?.id, is_question: asQuestion.checked } });
          text.value = ''; asQuestion.checked = false; clearReply();
          await refresh();
          if (local) local.comment_count += 1;
        } catch (err) { toast(err.message, true); }
      },
    },
    replyInfo,
    h('div.composer', h('div.avatar.sm', initials(state.me.name)), text, h('button.btn.btn-primary', { type: 'submit' }, 'Enviar')),
    h('label.check.small', asQuestion, 'É uma pergunta para a coordenação')),
  ]);
  // fechar o modal volta para o feed
  const obs = new MutationObserver(() => {
    if (!document.body.contains(m.el)) { obs.disconnect(); if (current().startsWith('#/post/')) history.replaceState(null, '', '#/'); paintFeed(); }
  });
  obs.observe(document.body, { childList: true });
}
const countAll = (list) => list.reduce((n, c) => n + 1 + countAll(c.replies || []), 0);

// ------------------------------------------------------------------ explorar (mobile)
function renderSearch() {
  const input = h('input.input', { name: 'q', placeholder: 'Buscar comunicados', value: state.q });
  shell([
    h('div.top-bar', h('div.top-row', h('h1', 'Explorar'))),
    h('form.search', { style: { padding: '14px 16px' }, onsubmit: (e) => { e.preventDefault(); state.q = input.value; location.hash = '#/'; } }, input),
    h('div', { style: { padding: '0 16px' } }, h('h3', 'Categorias')),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', padding: '0 16px 16px' } },
      [{ slug: 'urgente', icon: '🚨', name: 'Urgente', color: '#e63946' }, ...state.categories].map((c) => h('button.btn', {
        style: { justifyContent: 'flex-start', borderRadius: '14px', padding: '14px', borderColor: `${c.color}55` },
        onclick: () => { state.category = c.slug; location.hash = '#/'; },
      }, `${c.icon} ${c.name}`))),
  ]);
  input.focus();
}

// ------------------------------------------------------------------ notificações
async function renderNotifications() {
  shell(h('div.spinner'));
  const list = await api('/notifications');
  const ICON = { new_post: '📢', urgent: '🚨', reply: '💬' };
  shell([
    h('div.top-bar', h('div.top-row', h('h1', 'Notificações'),
      h('button.btn.btn-sm', { onclick: async () => { await api('/notifications/read-all', { method: 'POST' }); state.me.unread_notifications = 0; renderNotifications(); } }, 'Marcar todas como lidas'))),
    list.length ? list.map((n) => h(`div.notif${n.read_at ? '' : '.unread'}`, { onclick: () => { if (n.post_id) location.hash = `#/post/${n.post_id}`; } },
      h('span.ico', ICON[n.type] || '🔔'),
      h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: n.read_at ? 500 : 700 } }, n.title), h('div.muted.small', timeAgo(n.created_at))),
      n.read_at ? null : h('span.dot-new')))
      : h('div.empty', h('div.big', '🔕'), 'Nenhuma notificação por enquanto.'),
  ]);
  state.me = await api('/me');
}

// ------------------------------------------------------------------ perfil
function renderProfile() {
  const me = state.me;
  const cur = h('input.input', { type: 'password', placeholder: 'Senha atual', autocomplete: 'current-password' });
  const nxt = h('input.input', { type: 'password', placeholder: 'Nova senha (mín. 6)', autocomplete: 'new-password' });
  shell([
    h('div.top-bar', h('div.top-row', h('h1', 'Perfil'), h('button.btn.btn-red.btn-sm', { onclick: logout }, 'Sair'))),
    h('div.profile-hero'),
    h('div.profile-info',
      h('div.avatar', initials(me.name)),
      h('div', h('h2', me.name), h('div.muted', `@${me.matricula}`)),
      h('div.stat-row', h('span', 'Série ', h('b', me.serie || '—')), h('span', 'Turma ', h('b', me.turma || '—')), h('span', 'E-mail ', h('b', me.email || '—')))),
    me.must_change_password ? h('div.card-form', { style: { borderColor: 'var(--red)' } }, '⚠️ Sua senha é provisória. Troque abaixo.') : null,
    h('form.card-form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('/me/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
          cur.value = nxt.value = ''; me.must_change_password = 0; toast('Senha alterada!');
        } catch (err) { toast(err.message, true); }
      },
    }, h('h3', 'Trocar senha'), cur, nxt, h('button.btn.btn-primary', { type: 'submit' }, 'Salvar nova senha')),
  ]);
}

boot();
