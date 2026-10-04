import {
  brand, createApi, fmtDate, h, initials, modal, renderAttachments, renderComments, richText, ROLE_LABEL,
  timeAgo, toLocalInput, toast,
} from '/shared/common.js';

const api = createApi('/api/admin');
const app = document.getElementById('app');
const state = { me: null, meta: null, stats: null };
const isManager = () => ['admin', 'coordenacao'].includes(state.me?.role);
const isAdmin = () => state.me?.role === 'admin';

// ------------------------------------------------------------------ boot / login
async function boot() {
  try {
    state.me = await api('/me');
    state.meta = await api('/meta');
    route();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return renderLogin();
    app.replaceChildren(h('div.empty', h('div.big', '⚠️'), err.message));
  }
}
window.addEventListener('hashchange', () => state.me && route());

function renderLogin() {
  const err = h('div.login-error');
  const user = h('input.input', { placeholder: 'Usuário', autocomplete: 'username', required: true });
  const pass = h('input.input', { type: 'password', placeholder: 'Senha', autocomplete: 'current-password', required: true });
  const btn = h('button.btn.btn-primary', { type: 'submit', style: { padding: '13px' } }, 'Entrar no painel');
  app.replaceChildren(h('div.login-wrap', h('form.login-card', {
    onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      try { await api('/auth/login', { method: 'POST', body: { username: user.value, password: pass.value } }); await boot(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    },
  }, brand(), h('div', h('h1', 'Portal da Coordenação'), h('p.muted', 'Acesso restrito à equipe da escola.')), user, pass, err, btn)));
  user.focus();
}

// ------------------------------------------------------------------ layout
const MENU = [
  { hash: '#/', ico: '📊', label: 'Painel' },
  { hash: '#/comunicados', ico: '📢', label: 'Comunicados' },
  { hash: '#/comentarios', ico: '💬', label: 'Comentários', count: () => state.stats?.open_questions },
  { hash: '#/alunos', ico: '🎓', label: 'Alunos', when: isManager },
  { hash: '#/turmas', ico: '🏫', label: 'Turmas e séries', when: isManager },
  { hash: '#/equipe', ico: '🛡️', label: 'Equipe', when: isAdmin },
  { hash: '#/logs', ico: '📜', label: 'Logs', when: isAdmin },
  { hash: '#/conta', ico: '⚙️', label: 'Minha conta' },
];
const current = () => (location.hash || '#/').split('?')[0];

function layout(title, subtitle, actions, ...content) {
  const sidebar = h('aside.sidebar', brand(), h('div.portal-tag', 'COORDENAÇÃO'),
    MENU.filter((m) => !m.when || m.when()).map((m) => h(`a.menu-item${current() === m.hash ? '.active' : ''}`, { href: m.hash, onclick: closeMenu },
      h('span.ico', m.ico), m.label, m.count?.() ? h('span.count', m.count()) : null)),
    h('div.user-box', h('div.avatar.sm.staff', initials(state.me.name)),
      h('div.meta', h('div', { style: { fontWeight: 700 } }, state.me.name), h('div.muted.small', ROLE_LABEL[state.me.role])),
      h('button.btn.btn-ghost.btn-icon', { title: 'Sair', onclick: logout }, '🚪')));
  const scrim = h('div.scrim', { hidden: true, onclick: closeMenu });
  function closeMenu() { sidebar.classList.remove('open'); scrim.hidden = true; }
  app.replaceChildren(h('div.layout', sidebar, scrim,
    h('div',
      h('div.mobile-top', h('button.btn.btn-ghost.btn-icon', { onclick: () => { sidebar.classList.add('open'); scrim.hidden = false; }, 'aria-label': 'Menu' }, '☰'), brand(), h('span', { style: { width: '38px' } })),
      h('main.work', h('div.page-head', h('div', h('h1', title), subtitle ? h('p.muted', subtitle) : null), actions ? h('div.row-actions', actions) : null), content))),
  h('button.btn.btn-primary.fab', { onclick: () => editPost(), 'aria-label': 'Novo comunicado' }, '+'));
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  renderLogin();
}

const loading = (title) => layout(title, null, null, h('div.spinner'));

function route() {
  const r = current();
  const pages = {
    '#/': renderDashboard, '#/comunicados': renderPosts, '#/comentarios': renderComments_, '#/alunos': renderStudents,
    '#/turmas': renderTurmas, '#/equipe': renderStaff, '#/logs': renderLogs, '#/conta': renderAccount,
  };
  (pages[r] || renderDashboard)().catch((err) => toast(err.message, true));
}

// ------------------------------------------------------------------ painel
async function renderDashboard() {
  loading('Painel');
  const [stats, posts] = await Promise.all([api('/stats'), api('/posts?status=published')]);
  state.stats = stats;
  const card = (v, l) => h('div.stat', h('div.v', v), h('div.l', l));
  layout(`Olá, ${state.me.name.split(' ')[0]} 👋`, 'Resumo da comunicação da escola', [h('button.btn.btn-primary', { onclick: () => editPost() }, '＋ Novo comunicado')],
    h('div.stats', card(stats.students, 'Alunos ativos'), card(stats.published, 'Publicados'), card(stats.scheduled, 'Agendados'),
      card(stats.drafts, 'Rascunhos'), card(stats.open_questions, 'Perguntas sem resposta'), card(stats.views_7d, 'Visualizações (7 dias)')),
    h('div.page-head', h('h1', { style: { fontSize: '19px' } }, 'Publicações recentes'), h('a.btn.btn-sm', { href: '#/comunicados' }, 'Ver todas')),
    h('div.list', posts.slice(0, 6).map(postRow)));
}

// ------------------------------------------------------------------ comunicados
const STATUS_LABEL = { published: 'PUBLICADO', draft: 'RASCUNHO', archived: 'ARQUIVADO', scheduled: 'AGENDADO' };
const effectiveStatus = (p) => (p.status === 'published' && new Date(p.publish_at.replace(' ', 'T') + 'Z') > new Date() ? 'scheduled' : p.status);
const postsFilter = { status: '', category: '', q: '' };

function postRow(p) {
  const st = effectiveStatus(p);
  const pct = p.audience_size ? Math.round((p.view_count / p.audience_size) * 100) : 0;
  const canEdit = isManager() || p.author_id === state.me.id;
  return h(`div.row-card${p.urgent ? '.urgent' : ''}`,
    h('div', { style: { minWidth: 0, cursor: 'pointer' }, onclick: () => viewPost(p.id) },
      h('div.title', p.pinned ? '📌' : null, p.title, p.urgent ? h('span.badge-urgent', 'URGENTE') : null),
      h('div.meta',
        h(`span.status.${st}`, STATUS_LABEL[st]),
        p.category_name ? h('span', `${p.category_icon} ${p.category_name}`) : null,
        h('span', `🎯 ${p.audience_label}`),
        h('span', `🗓 ${st === 'scheduled' ? fmtDate(p.publish_at) : timeAgo(p.publish_at)}`),
        h('span', { title: 'Alunos que visualizaram' }, `👁 ${p.view_count}/${p.audience_size} `, h('span.bar', h('i', { style: { width: `${pct}%` } }))),
        h('span', `✅ ${p.read_count} lidos`),
        h('span', `💬 ${p.comment_count}`),
        h('span', `✍️ ${p.author_name}`))),
    canEdit ? h('div.row-actions',
      h('button.btn.btn-sm', { onclick: () => editPost(p.id) }, 'Editar'),
      h('button.btn.btn-sm', { onclick: () => act(`/posts/${p.id}/pin`, { pinned: !p.pinned }, p.pinned ? 'Desafixado' : 'Fixado no topo') }, p.pinned ? 'Desafixar' : 'Fixar'),
      p.status !== 'published' ? h('button.btn.btn-sm.btn-blue', { onclick: () => act(`/posts/${p.id}/status`, { status: 'published' }, 'Publicado') }, 'Publicar') : null,
      p.status !== 'archived' ? h('button.btn.btn-sm', { onclick: () => act(`/posts/${p.id}/status`, { status: 'archived' }, 'Arquivado') }, 'Arquivar') : null,
      isManager() ? h('button.btn.btn-sm.btn-red', {
        onclick: async () => {
          if (!confirm(`Excluir definitivamente "${p.title}"? Comentários e anexos serão apagados.`)) return;
          await api(`/posts/${p.id}`, { method: 'DELETE' }); toast('Comunicado excluído'); route();
        },
      }, 'Excluir') : null) : null);
}

async function act(path, body, msg) {
  try { await api(path, { method: 'POST', body }); toast(msg); route(); } catch (err) { toast(err.message, true); }
}

async function renderPosts() {
  loading('Comunicados');
  const params = new URLSearchParams(Object.entries(postsFilter).filter(([, v]) => v));
  const posts = await api(`/posts?${params}`);
  const seg = (v, label) => h(`button${postsFilter.status === v ? '.on' : ''}`, { onclick: () => { postsFilter.status = v; renderPosts(); } }, label);
  const q = h('input.input', { placeholder: 'Buscar por título ou texto…', value: postsFilter.q });
  layout('Comunicados', `${posts.length} encontrado(s)`, [h('button.btn.btn-primary', { onclick: () => editPost() }, '＋ Novo comunicado')],
    h('div.toolbar',
      h('div.seg', seg('', 'Todos'), seg('published', 'Publicados'), seg('scheduled', 'Agendados'), seg('draft', 'Rascunhos'), seg('archived', 'Arquivados'))),
    h('form.toolbar', { onsubmit: (e) => { e.preventDefault(); postsFilter.q = q.value; renderPosts(); } },
      q,
      h('select.input', { style: { width: 'auto' }, onchange: (e) => { postsFilter.category = e.target.value; renderPosts(); } },
        h('option', { value: '' }, 'Todas as categorias'),
        state.meta.categories.map((c) => h('option', { value: c.slug, selected: postsFilter.category === c.slug }, `${c.icon} ${c.name}`))),
      h('button.btn', { type: 'submit' }, 'Buscar')),
    h('div.list', posts.length ? posts.map(postRow) : h('div.empty', h('div.big', '📭'), 'Nenhum comunicado aqui.')));
}

function audienceSelect(type, id) {
  const typeSel = h('select.input', { name: 'audience_type' },
    [['all', 'Todos os alunos'], ['serie', 'Uma série'], ['turma', 'Uma turma'], ['group', 'Um grupo']]
      .map(([v, l]) => h('option', { value: v, selected: type === v }, l)));
  const idSel = h('select.input', { name: 'audience_id' });
  const fill = () => {
    const t = typeSel.value;
    const opts = t === 'serie' ? state.meta.series.map((s) => [s.id, s.name])
      : t === 'turma' ? state.meta.turmas.map((x) => [x.id, `${x.serie_name} — ${x.name}`])
        : t === 'group' ? state.meta.groups.map((g) => [g.id, g.name]) : [];
    idSel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, selected: Number(id) === v }, l)));
    idSel.hidden = t === 'all';
    if (t !== 'all' && !opts.length) idSel.replaceChildren(h('option', { value: '' }, 'Nenhum cadastrado'));
  };
  typeSel.addEventListener('change', fill);
  fill();
  return [typeSel, idSel];
}

async function editPost(id) {
  const p = id ? await api(`/posts/${id}`) : { status: 'published', audience_type: 'all', attachments: [] };
  const removed = new Set();
  const files = [];
  const f = (name, el) => h('label.field', name, el);
  const title = h('input.input', { name: 'title', required: true, maxlength: 200, value: p.title || '', placeholder: 'Ex.: Prova de Matemática remarcada' });
  const body = h('textarea.input', { name: 'body', rows: 7, placeholder: 'Escreva o comunicado. Links viram clicáveis automaticamente.' }, p.body || '');
  const cat = h('select.input', { name: 'category_id' }, state.meta.categories.map((c) => h('option', { value: c.id, selected: p.category_id === c.id }, `${c.icon} ${c.name}`)));
  const status = h('select.input', { name: 'status' }, [['published', 'Publicar'], ['draft', 'Rascunho'], ['archived', 'Arquivado']].map(([v, l]) => h('option', { value: v, selected: p.status === v }, l)));
  const when = h('input.input', { type: 'datetime-local', name: 'publish_at', value: toLocalInput(p.publish_at) });
  const [audType, audId] = audienceSelect(p.audience_type, p.audience_id);
  const urgent = h('input', { type: 'checkbox', checked: !!p.urgent });
  const pinned = h('input', { type: 'checkbox', checked: !!p.pinned });
  const links = h('textarea.input', { rows: 2, placeholder: 'Um link por linha. Opcional: Nome | https://…' });
  const fileList = h('div.list');
  const fileInput = h('input', {
    type: 'file', multiple: true, hidden: true,
    accept: 'image/*,video/mp4,video/webm,video/quicktime,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.txt,.csv',
    onchange: () => { files.push(...fileInput.files); fileInput.value = ''; paintFiles(); },
  });
  const paintFiles = () => fileList.replaceChildren(...files.map((file, i) => h('div.att-edit', `📎 ${file.name} · ${(file.size / 1048576).toFixed(1)} MB`,
    h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { files.splice(i, 1); paintFiles(); } }, '✕'))));
  const drop = h('div.dropzone', {
    onclick: () => fileInput.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add('drag'); },
    ondragleave: () => drop.classList.remove('drag'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('drag'); files.push(...e.dataTransfer.files); paintFiles(); },
  }, '📎 Clique ou arraste imagens, vídeos, PDFs e documentos aqui');
  const existing = p.attachments.map((a) => {
    const row = h('div.att-edit', `${a.kind === 'link' ? '🔗' : a.kind === 'image' ? '🖼️' : a.kind === 'video' ? '🎬' : '📄'} ${a.original_name || a.url}`,
      h('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        onclick: (e) => { removed.has(a.id) ? removed.delete(a.id) : removed.add(a.id); row.classList.toggle('removed'); e.target.textContent = removed.has(a.id) ? 'Desfazer' : 'Remover'; },
      }, 'Remover'));
    return row;
  });
  const save = h('button.btn.btn-primary', { type: 'submit' }, id ? 'Salvar alterações' : 'Publicar comunicado');
  status.addEventListener('change', () => { save.textContent = id ? 'Salvar alterações' : status.value === 'draft' ? 'Salvar rascunho' : 'Publicar comunicado'; });

  const m = modal(id ? 'Editar comunicado' : 'Novo comunicado', h('form', {
    style: { display: 'grid', gap: '14px' },
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.set('title', title.value); fd.set('body', body.value); fd.set('category_id', cat.value);
      fd.set('status', status.value); fd.set('publish_at', new Date(when.value).toISOString());
      fd.set('audience_type', audType.value); fd.set('audience_id', audType.value === 'all' ? '' : audId.value);
      fd.set('urgent', urgent.checked); fd.set('pinned', pinned.checked);
      fd.set('links', JSON.stringify(links.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [a, b] = l.split('|').map((s) => s.trim());
        return b ? { name: a, url: b } : { url: a };
      })));
      fd.set('remove_attachments', JSON.stringify([...removed]));
      files.forEach((file) => fd.append('files', file));
      save.disabled = true; save.textContent = 'Enviando…';
      try {
        await api(id ? `/posts/${id}` : '/posts', { method: id ? 'PUT' : 'POST', form: fd });
        m.close(); toast(id ? 'Comunicado atualizado' : 'Comunicado salvo'); route();
      } catch (err) { toast(err.message, true); save.disabled = false; save.textContent = 'Tentar novamente'; }
    },
  },
  f('Título', title), f('Conteúdo', body),
  h('div.grid2', f('Categoria', cat), f('Situação', status)),
  h('div.grid2', f('Data de publicação (futura = agendado)', when), f('Público', h('div', { style: { display: 'grid', gap: '8px' } }, audType, audId))),
  h('div', { style: { display: 'flex', gap: '22px', flexWrap: 'wrap' } }, h('label.check', urgent, '🚨 Urgente'), h('label.check', pinned, '📌 Fixar no topo')),
  existing.length ? f('Anexos atuais', h('div.list', existing)) : null,
  f('Mídias e documentos', h('div', { style: { display: 'grid', gap: '8px' } }, drop, fileInput, fileList)),
  f('Links externos', links),
  h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancelar'), save)), { wide: true });
  title.focus();
}

async function viewPost(id) {
  const [p, views] = await Promise.all([api(`/posts/${id}`), api(`/posts/${id}/views`)]);
  let replyTo = null;
  const box = h('div');
  const replyInfo = h('div.muted.small', { hidden: true });
  const text = h('textarea.input', { placeholder: 'Responder como coordenação…', rows: 2 });
  const paint = (post) => box.replaceChildren(renderComments(post.comments, {
    onReply: (c) => { replyTo = c; replyInfo.hidden = false; replyInfo.textContent = `↪ Respondendo a ${c.author_name}`; text.focus(); },
    onModerate: async (c, st) => {
      if (st === 'deleted' && !confirm('Excluir este comentário e as respostas?')) return;
      await api(`/comments/${c.id}/moderate`, { method: 'POST', body: { status: st } });
      paint(await api(`/posts/${id}`));
    },
  }));
  paint(p);
  const viewsTable = views.length ? h('div.table-wrap', h('table', h('tr', h('th', 'Aluno'), h('th', 'Turma'), h('th', 'Visualizou'), h('th', 'Lido')),
    views.map((v) => h('tr', h('td', v.name), h('td', v.turma || '—'), h('td', timeAgo(v.viewed_at)), h('td', v.read_at ? '✅' : '—')))))
    : h('div.muted.small', 'Nenhum aluno visualizou ainda.');
  modal(p.title, [
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      p.urgent ? h('span.badge-urgent', 'URGENTE') : null, p.category_name ? h('span.chip', `${p.category_icon} ${p.category_name}`) : null,
      h('span.muted.small', `${p.author_name} · ${fmtDate(p.publish_at)} · 🎯 ${p.audience_label}`)),
    richText(p.body),
    renderAttachments(p.attachments),
    h('h3', { style: { margin: '8px 0 0' } }, `👁 Visualizações: ${p.view_count} de ${p.audience_size} · ✅ ${p.read_count} lidos`),
    viewsTable,
    h('h3', { style: { margin: '8px 0 0' } }, '💬 Discussão'),
    box,
    h('form', {
      style: { display: 'grid', gap: '8px' },
      onsubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim()) return;
        try {
          await api(`/posts/${id}/comments`, { method: 'POST', body: { body: text.value, parent_id: replyTo?.id } });
          text.value = ''; replyTo = null; replyInfo.hidden = true;
          paint(await api(`/posts/${id}`)); toast('Resposta enviada');
        } catch (err) { toast(err.message, true); }
      },
    }, replyInfo, text, h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h('button.btn.btn-primary', { type: 'submit' }, 'Enviar resposta'))),
  ], { wide: true });
}

// ------------------------------------------------------------------ comentários
let commentFilter = 'unanswered';
async function renderComments_() {
  loading('Comentários');
  const list = await api(`/comments?filter=${commentFilter}`);
  const seg = (v, l) => h(`button${commentFilter === v ? '.on' : ''}`, { onclick: () => { commentFilter = v; renderComments_(); } }, l);
  layout('Comentários e perguntas', 'Responda e modere a conversa dos alunos', null,
    h('div.toolbar', h('div.seg', seg('unanswered', 'Sem resposta'), seg('', 'Todos'), seg('hidden', 'Ocultos'))),
    h('div.list', list.length ? list.map((c) => h('div.row-card',
      h('div', { style: { minWidth: 0 } },
        h('div.muted.small', `em "${c.post_title}"`),
        h('div', { style: { fontWeight: 700, margin: '4px 0' } }, c.author_name, ' ', c.is_question ? h('span.tag-q', 'PERGUNTA') : null, c.status === 'hidden' ? h('span.muted.small', ' (oculto)') : null),
        h('div.post-body', c.body),
        h('div.muted.small', timeAgo(c.created_at))),
      h('div.row-actions',
        h('button.btn.btn-sm.btn-blue', { onclick: () => viewPost(c.post_id) }, 'Abrir e responder'),
        h('button.btn.btn-sm', { onclick: () => act(`/comments/${c.id}/moderate`, { status: c.status === 'hidden' ? 'visible' : 'hidden' }, 'Atualizado') }, c.status === 'hidden' ? 'Reexibir' : 'Ocultar'),
        h('button.btn.btn-sm.btn-red', { onclick: () => confirm('Excluir comentário?') && act(`/comments/${c.id}/moderate`, { status: 'deleted' }, 'Excluído') }, 'Excluir'))))
      : h('div.empty', h('div.big', '🎉'), 'Nada por aqui.')));
}

// ------------------------------------------------------------------ alunos
const studentFilter = { q: '', turma_id: '' };
const turmaOptions = (selected) => [h('option', { value: '' }, 'Sem turma'),
  ...state.meta.turmas.map((t) => h('option', { value: t.id, selected: Number(selected) === t.id }, `${t.serie_name} — ${t.name}`))];

async function renderStudents() {
  loading('Alunos');
  state.meta = await api('/meta');
  const list = await api(`/students?${new URLSearchParams(Object.entries(studentFilter).filter(([, v]) => v))}`);
  const q = h('input.input', { placeholder: 'Nome, matrícula ou e-mail', value: studentFilter.q });
  layout('Alunos', `${list.length} aluno(s)`, [h('button.btn', { onclick: importStudents }, '⬆️ Importar CSV'), h('button.btn.btn-primary', { onclick: () => editStudent() }, '＋ Novo aluno')],
    h('form.toolbar', { onsubmit: (e) => { e.preventDefault(); studentFilter.q = q.value; renderStudents(); } }, q,
      h('select.input', { style: { width: 'auto' }, onchange: (e) => { studentFilter.turma_id = e.target.value; renderStudents(); } },
        h('option', { value: '' }, 'Todas as turmas'), state.meta.turmas.map((t) => h('option', { value: t.id, selected: Number(studentFilter.turma_id) === t.id }, `${t.serie_name} — ${t.name}`))),
      h('button.btn', { type: 'submit' }, 'Buscar')),
    h('div.table-wrap', h('table',
      h('tr', h('th', 'Nome'), h('th', 'Matrícula'), h('th', 'Série / Turma'), h('th', 'E-mail'), h('th', 'Situação'), h('th', 'Último acesso'), h('th', '')),
      list.map((s) => h(`tr${s.active ? '' : '.off'}`,
        h('td', h('b', s.name)), h('td', s.matricula), h('td', s.turma ? `${s.serie} — ${s.turma}` : '—'), h('td', s.email || '—'),
        h('td', s.active ? '🟢 Ativo' : '⚪ Inativo'), h('td', s.last_login_at ? timeAgo(s.last_login_at) : 'nunca'),
        h('td', h('div.row-actions',
          h('button.btn.btn-sm', { onclick: () => editStudent(s) }, 'Editar'),
          h('button.btn.btn-sm', { onclick: () => act(`/students/${s.id}/active`, { active: !s.active }, s.active ? 'Aluno desativado' : 'Aluno ativado') }, s.active ? 'Desativar' : 'Ativar'),
          h('button.btn.btn-sm', {
            onclick: async () => {
              if (!confirm(`Redefinir a senha de ${s.name} para a matrícula (${s.matricula})?`)) return;
              await api(`/students/${s.id}/reset-password`, { method: 'POST', body: {} }); toast('Senha redefinida para a matrícula');
            },
          }, 'Resetar senha'))))))));
}

function editStudent(s = {}) {
  const name = h('input.input', { required: true, value: s.name || '' });
  const mat = h('input.input', { required: true, value: s.matricula || '' });
  const email = h('input.input', { type: 'email', value: s.email || '' });
  const turma = h('select.input', turmaOptions(s.turma_id));
  const pass = h('input.input', { type: 'password', placeholder: 'Em branco = matrícula (provisória)' });
  const m = modal(s.id ? 'Editar aluno' : 'Novo aluno', h('form', {
    style: { display: 'grid', gap: '12px' },
    onsubmit: async (e) => {
      e.preventDefault();
      const body = { name: name.value, matricula: mat.value, email: email.value, turma_id: turma.value, password: pass.value || undefined };
      try {
        await api(s.id ? `/students/${s.id}` : '/students', { method: s.id ? 'PUT' : 'POST', body });
        m.close(); toast('Aluno salvo'); renderStudents();
      } catch (err) { toast(err.message, true); }
    },
  }, h('label.field', 'Nome completo', name), h('div.grid2', h('label.field', 'Matrícula (login)', mat), h('label.field', 'E-mail', email)),
  h('label.field', 'Turma', turma), s.id ? null : h('label.field', 'Senha inicial', pass),
  h('button.btn.btn-primary', { type: 'submit' }, 'Salvar')));
}

function importStudents() {
  const area = h('textarea.input', { rows: 8, placeholder: 'nome;matricula;serie;turma;email;senha\nJoão da Silva;2026100;1º Ano EM;A;joao@email.com;' });
  const file = h('input.input', { type: 'file', accept: '.csv,text/csv', onchange: async () => { area.value = await file.files[0].text(); } });
  const out = h('div.small');
  modal('Importar alunos (CSV)', [
    h('p.muted.small', 'Colunas: nome, matricula, serie, turma, email, senha (separador ; ou ,). Série e turma são criadas se não existirem. Sem senha, a senha provisória é a matrícula. Planilhas XLSX: exporte como CSV.'),
    file, area, out,
    h('button.btn.btn-primary', {
      onclick: async () => {
        try {
          const r = await api('/students/import', { method: 'POST', body: { csv: area.value } });
          out.replaceChildren(h('div', `✅ ${r.created} aluno(s) importado(s)`), ...r.errors.map((e) => h('div', { style: { color: 'var(--red-2)' } }, e)));
          renderStudents();
        } catch (err) { toast(err.message, true); }
      },
    }, 'Importar'),
  ]);
}

// ------------------------------------------------------------------ turmas
async function renderTurmas() {
  loading('Turmas e séries');
  state.meta = await api('/meta');
  const serieName = h('input.input', { placeholder: 'Ex.: 9º Ano EF', required: true });
  const turmaName = h('input.input', { placeholder: 'Ex.: A', required: true });
  const turmaSerie = h('select.input', state.meta.series.map((s) => h('option', { value: s.id }, s.name)));
  const turno = h('select.input', ['Matutino', 'Vespertino', 'Noturno', 'Integral'].map((t) => h('option', t)));
  const groupName = h('input.input', { placeholder: 'Ex.: Grêmio estudantil', required: true });
  const post = (path, body, msg) => api(path, { method: 'POST', body }).then(() => { toast(msg); renderTurmas(); }).catch((err) => toast(err.message, true));
  layout('Turmas e séries', 'Estrutura usada para direcionar comunicados', null,
    h('div.grid3',
      h('form.panel', { onsubmit: (e) => { e.preventDefault(); post('/series', { name: serieName.value, sort_order: state.meta.series.length + 1 }, 'Série criada'); } },
        h('h3', 'Nova série'), serieName, h('button.btn.btn-primary', { type: 'submit' }, 'Adicionar série')),
      h('form.panel', { onsubmit: (e) => { e.preventDefault(); post('/turmas', { name: turmaName.value, serie_id: turmaSerie.value, turno: turno.value, year: new Date().getFullYear() }, 'Turma criada'); } },
        h('h3', 'Nova turma'), turmaSerie, turmaName, turno, h('button.btn.btn-primary', { type: 'submit' }, 'Adicionar turma')),
      h('form.panel', { onsubmit: (e) => { e.preventDefault(); post('/groups', { name: groupName.value }, 'Grupo criado'); } },
        h('h3', 'Novo grupo'), groupName, h('p.muted.small', { style: { margin: 0 } }, 'Grupos permitem avisos para times, clubes, monitores…'), h('button.btn.btn-primary', { type: 'submit' }, 'Adicionar grupo'))),
    h('div', { style: { height: '20px' } }),
    h('div.table-wrap', h('table', h('tr', h('th', 'Série'), h('th', 'Turma'), h('th', 'Turno'), h('th', 'Alunos'), h('th', '')),
      state.meta.turmas.map((t) => h('tr', h('td', t.serie_name), h('td', h('b', t.name)), h('td', t.turno || '—'), h('td', t.student_count),
        h('td', h('button.btn.btn-sm.btn-red', {
          onclick: async () => { if (confirm(`Excluir turma ${t.name}? Os alunos ficam sem turma.`)) { await api(`/turmas/${t.id}`, { method: 'DELETE' }); renderTurmas(); } },
        }, 'Excluir')))))));
}

// ------------------------------------------------------------------ equipe
async function renderStaff() {
  loading('Equipe');
  const list = await api('/staff');
  layout('Equipe', 'Usuários do portal da coordenação e níveis de acesso', [h('button.btn.btn-primary', { onclick: () => editStaff() }, '＋ Novo usuário')],
    h('div.panel', { style: { marginBottom: '16px' } }, h('div.small.muted', '🛡️ Administração: tudo, inclusive equipe e logs · 📋 Coordenação: comunicados, alunos, turmas e moderação · 👩‍🏫 Professor(a): cria e edita os próprios comunicados e responde alunos')),
    h('div.table-wrap', h('table', h('tr', h('th', 'Nome'), h('th', 'Usuário'), h('th', 'Perfil'), h('th', 'Situação'), h('th', 'Último acesso'), h('th', '')),
      list.map((u) => h(`tr${u.active ? '' : '.off'}`, h('td', h('b', u.name)), h('td', u.username), h('td', ROLE_LABEL[u.role]),
        h('td', u.active ? '🟢 Ativo' : '⚪ Inativo'), h('td', u.last_login_at ? timeAgo(u.last_login_at) : 'nunca'),
        h('td', h('button.btn.btn-sm', { onclick: () => editStaff(u) }, 'Editar')))))));
}

function editStaff(u = {}) {
  const name = h('input.input', { required: true, value: u.name || '' });
  const username = h('input.input', { required: true, value: u.username || '', disabled: !!u.id });
  const email = h('input.input', { type: 'email', value: u.email || '' });
  const role = h('select.input', ['admin', 'coordenacao', 'professor'].map((r) => h('option', { value: r, selected: u.role === r }, ROLE_LABEL[r])));
  const pass = h('input.input', { type: 'password', placeholder: 'Mínimo 6 caracteres' });
  const active = h('input', { type: 'checkbox', checked: u.id ? !!u.active : true });
  const m = modal(u.id ? 'Editar usuário' : 'Novo usuário da equipe', h('form', {
    style: { display: 'grid', gap: '12px' },
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        if (u.id) await api(`/staff/${u.id}`, { method: 'PUT', body: { name: name.value, email: email.value, role: role.value, active: active.checked } });
        else await api('/staff', { method: 'POST', body: { name: name.value, username: username.value, email: email.value, role: role.value, password: pass.value } });
        m.close(); toast('Usuário salvo'); renderStaff();
      } catch (err) { toast(err.message, true); }
    },
  }, h('label.field', 'Nome', name), h('div.grid2', h('label.field', 'Usuário (login)', username), h('label.field', 'E-mail', email)),
  h('label.field', 'Perfil de acesso', role), u.id ? h('label.check', active, 'Conta ativa') : h('label.field', 'Senha inicial', pass),
  h('button.btn.btn-primary', { type: 'submit' }, 'Salvar')));
}

// ------------------------------------------------------------------ logs
async function renderLogs() {
  loading('Logs');
  const logs = await api('/logs');
  layout('Logs de acesso e ações', 'Últimos 300 eventos', null,
    h('div.table-wrap', h('table', h('tr', h('th', 'Quando'), h('th', 'Usuário'), h('th', 'Ação'), h('th', 'Alvo'), h('th', 'IP'), h('th', 'Detalhes')),
      logs.map((l) => h('tr', h('td', fmtDate(l.created_at)), h('td', l.user_name || '—'), h('td', h('b', l.action)),
        h('td', l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '—'), h('td', l.ip || '—'), h('td.wrap.small.muted', l.meta || ''))))));
}

// ------------------------------------------------------------------ conta
async function renderAccount() {
  const cur = h('input.input', { type: 'password', autocomplete: 'current-password' });
  const nxt = h('input.input', { type: 'password', autocomplete: 'new-password' });
  layout('Minha conta', `${state.me.name} · ${ROLE_LABEL[state.me.role]}`, null,
    state.me.must_change_password ? h('div.panel', { style: { borderColor: 'var(--red)', marginBottom: '16px' } }, '⚠️ Sua senha é provisória — troque agora.') : null,
    h('form.panel', {
      style: { maxWidth: '440px' },
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api('/me/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); cur.value = nxt.value = ''; toast('Senha alterada'); }
        catch (err) { toast(err.message, true); }
      },
    }, h('h3', 'Trocar senha'), h('label.field', 'Senha atual', cur), h('label.field', 'Nova senha', nxt), h('button.btn.btn-primary', { type: 'submit' }, 'Salvar')));
}

boot();
