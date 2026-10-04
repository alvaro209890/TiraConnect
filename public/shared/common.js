// Utilitários compartilhados pelos dois portais. Todo texto do usuário entra no DOM via textContent (anti-XSS).

export function createApi(base) {
  return async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (form) opts.body = form;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Erro ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
}

/** h('div.classe#id', {attrs}, ...filhos) — strings viram nós de texto. */
export function h(tag, attrs = {}, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]+)?(.*)$/i);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === '.' ? el.classList.add(m[2]) : (el.id = m[2]);
  if (attrs === null || attrs === undefined || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Texto com links clicáveis, sem innerHTML. */
export function richText(text, cls = 'post-body') {
  const el = h(`div.${cls}`);
  const re = /(https?:\/\/[^\s<]+)/g;
  let last = 0;
  for (const m of String(text || '').matchAll(re)) {
    el.append(text.slice(last, m.index));
    el.append(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  el.append(String(text || '').slice(last));
  return el;
}

// SQLite grava UTC 'YYYY-MM-DD HH:MM:SS'
export const parseDate = (s) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));

export function timeAgo(s) {
  const d = parseDate(s);
  const sec = Math.round((Date.now() - d) / 1000);
  if (sec < 0) return `agendado · ${fmtDate(s)}`;
  if (sec < 60) return 'agora';
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
export const fmtDate = (s) => parseDate(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** Valor para <input type="datetime-local"> no fuso local. */
export function toLocalInput(s) {
  const d = s ? parseDate(s) : new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const initials = (name) => String(name || '?').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const ROLE_LABEL = { admin: 'Administração', coordenacao: 'Coordenação', professor: 'Professor(a)', aluno: 'Aluno(a)' };
export const isStaffRole = (r) => r && r !== 'aluno';

let toastTimer;
export function toast(msg, isError = false) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div#toast'); document.body.append(el); }
  el.textContent = msg;
  el.className = isError ? 'err' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

export function modal(title, content, { wide = false } = {}) {
  const close = () => { back.remove(); document.body.style.overflow = ''; };
  const back = h('div.modal-back', { onclick: (e) => e.target === back && close() },
    h('div.modal', { style: wide ? { maxWidth: '820px' } : null },
      h('div.modal-head', h('h2', title), h('button.btn.btn-ghost.btn-icon', { onclick: close, 'aria-label': 'Fechar' }, '✕')),
      h('div.modal-body', content)));
  document.body.append(back);
  document.body.style.overflow = 'hidden';
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return { close, el: back };
}

export function lightbox(src) {
  const el = h('div.lightbox', { onclick: () => el.remove() }, h('img', { src, alt: '' }));
  document.body.append(el);
}

const FILE_ICON = { pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', csv: '📗', ppt: '📙', pptx: '📙', txt: '📄', odt: '📘' };
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Renderiza mídias (grade estilo Instagram) + arquivos e links. */
export function renderAttachments(atts = []) {
  const media = atts.filter((a) => a.kind === 'image' || a.kind === 'video');
  const files = atts.filter((a) => a.kind === 'file' || a.kind === 'link');
  const out = [];
  if (media.length) {
    out.push(h(`div.media-grid.n${Math.min(media.length, 4)}`, media.slice(0, 4).map((a) => (a.kind === 'image'
      ? h('img', { src: a.url, alt: a.original_name || '', loading: 'lazy', onclick: (e) => { e.stopPropagation(); lightbox(a.url); } })
      : h('video', { src: a.url, controls: true, preload: 'metadata', onclick: (e) => e.stopPropagation() })))));
  }
  if (files.length) {
    out.push(h('div.files', files.map((a) => {
      const ext = (a.original_name || '').split('.').pop().toLowerCase();
      return h('a.file-link', { href: a.url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() },
        h('span.ico', a.kind === 'link' ? '🔗' : FILE_ICON[ext] || '📎'),
        h('div', { style: { minWidth: 0 } },
          h('div.name', a.original_name || a.url),
          h('div.muted.small', a.kind === 'link' ? new URL(a.url).hostname : `${ext.toUpperCase()} · ${fmtSize(a.size_bytes || 0)}`)));
    })));
  }
  return out;
}

/** Árvore de comentários. opts: { onReply(comment), onDelete(comment), onModerate(comment, status), staffView } */
export function renderComments(list, opts = {}) {
  const node = (c) => {
    const staff = isStaffRole(c.author_role);
    return h('div.comment',
      h(`div.avatar.sm${staff ? '.staff' : ''}`, initials(c.author_name)),
      h('div.comment-main',
        h(`div.bubble${staff ? '.staff' : ''}${c.status === 'hidden' ? '.hidden' : ''}`,
          h('div.who', c.author_name,
            staff && h('span.tag-staff', ROLE_LABEL[c.author_role]?.toUpperCase()),
            c.is_question ? h('span.tag-q', 'PERGUNTA') : null,
            c.status === 'hidden' && h('span.muted.small', '(oculto)')),
          h('div.txt', c.body)),
        h('div.comment-actions',
          h('span', timeAgo(c.created_at)),
          opts.onReply && h('button', { onclick: () => opts.onReply(c) }, 'Responder'),
          opts.onDelete && c.mine && h('button', { onclick: () => opts.onDelete(c) }, 'Excluir'),
          opts.onModerate && h('button', { onclick: () => opts.onModerate(c, c.status === 'hidden' ? 'visible' : 'hidden') }, c.status === 'hidden' ? 'Reexibir' : 'Ocultar'),
          opts.onModerate && h('button', { style: { color: 'var(--red-2)' }, onclick: () => opts.onModerate(c, 'deleted') }, 'Excluir')),
        c.replies?.length ? h('div.replies', c.replies.map(node)) : null));
  };
  return h('div.comments', list.length ? list.map(node) : h('div.muted.small', 'Nenhum comentário ainda. Seja o primeiro!'));
}

export const brand = () => h('div.brand', h('div.brand-mark', 'T'), h('span', 'Tira', h('b', 'Connect')));
