import { Router } from 'express';
import { checkPassword, createSession, destroySession, hashPassword, requireStaff } from '../auth.js';
import { STAFF_ROLES } from '../config.js';
import { all, one, run, tx } from '../db.js';
import { kindOf, removeUpload, upload } from '../uploads.js';
import {
  HttpError, ah, audienceStudentIds, audit, bool, cleanText, dispatchDueNotifications, notify,
  requireText, toInt, toSqlDate,
} from '../util.js';
import { commentTree, postAttachments } from './shared.js';

const r = Router();
const MANAGERS = ['admin', 'coordenacao'];

// ---------------------------------------------------------------- auth
r.post('/auth/login', ah(async (req, res) => {
  const login = cleanText(req.body.username, 100);
  const user = one(`SELECT * FROM users WHERE role IN ('admin','coordenacao','professor') AND (username = ? OR email = ?)`, login, login);
  if (!user || !user.active || !(await checkPassword(String(req.body.password || ''), user.password_hash))) {
    audit(req, 'login_failed', 'staff', null, { login });
    throw new HttpError(401, 'Usuário ou senha inválidos');
  }
  createSession(req, res, user, 'admin');
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  req.user = user;
  audit(req, 'login', 'staff', user.id);
  res.json({ ok: true });
}));

r.post('/auth/logout', (req, res) => {
  if (req.user) audit(req, 'logout', 'staff', req.user.id);
  destroySession(req, res, 'admin');
  res.json({ ok: true });
});

r.use(requireStaff());

r.get('/me', (req, res) => res.json(req.user));

r.post('/me/password', ah(async (req, res) => {
  const user = one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!(await checkPassword(String(req.body.current || ''), user.password_hash))) throw new HttpError(400, 'Senha atual incorreta');
  const next = String(req.body.next || '');
  if (next.length < 6) throw new HttpError(400, 'A nova senha precisa ter ao menos 6 caracteres');
  run("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?", await hashPassword(next), req.user.id);
  audit(req, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- meta / painel
r.get('/meta', (_req, res) => {
  res.json({
    categories: all('SELECT * FROM categories ORDER BY sort_order'),
    series: all('SELECT * FROM series ORDER BY sort_order, name'),
    turmas: all(`SELECT t.*, s.name AS serie_name,
                   (SELECT COUNT(*) FROM students st WHERE st.turma_id = t.id) AS student_count
                 FROM turmas t JOIN series s ON s.id = t.serie_id ORDER BY s.sort_order, s.name, t.name`),
    groups: all('SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count FROM groups g ORDER BY name'),
  });
});

r.get('/stats', (_req, res) => {
  const n = (sql) => one(sql).n;
  res.json({
    students: n("SELECT COUNT(*) n FROM users WHERE role = 'aluno' AND active = 1"),
    published: n("SELECT COUNT(*) n FROM posts WHERE status = 'published' AND publish_at <= datetime('now')"),
    scheduled: n("SELECT COUNT(*) n FROM posts WHERE status = 'published' AND publish_at > datetime('now')"),
    drafts: n("SELECT COUNT(*) n FROM posts WHERE status = 'draft'"),
    comments_today: n("SELECT COUNT(*) n FROM comments WHERE created_at >= date('now')"),
    open_questions: n(`SELECT COUNT(*) n FROM comments c JOIN users u ON u.id = c.user_id
                        WHERE u.role = 'aluno' AND c.status = 'visible' AND c.parent_id IS NULL
                          AND NOT EXISTS (SELECT 1 FROM comments r JOIN users ru ON ru.id = r.user_id
                                          WHERE r.parent_id = c.id AND ru.role != 'aluno')`),
    views_7d: n("SELECT COUNT(*) n FROM post_views WHERE viewed_at >= datetime('now','-7 days')"),
  });
});

// ---------------------------------------------------------------- comunicados
const POST_SELECT = `
  SELECT p.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, c.slug AS category_slug,
         a.name AS author_name,
         (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id) AS view_count,
         (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id AND v.read_at IS NOT NULL) AS read_count,
         (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id AND cm.status != 'deleted') AS comment_count
    FROM posts p LEFT JOIN categories c ON c.id = p.category_id JOIN users a ON a.id = p.author_id`;

function audienceLabel(p) {
  if (p.audience_type === 'turma') {
    const t = one('SELECT t.name, s.name AS serie FROM turmas t JOIN series s ON s.id = t.serie_id WHERE t.id = ?', p.audience_id);
    return t ? `Turma ${t.serie} ${t.name}` : 'Turma removida';
  }
  if (p.audience_type === 'serie') return one('SELECT name FROM series WHERE id = ?', p.audience_id)?.name || 'Série removida';
  if (p.audience_type === 'group') return `Grupo ${one('SELECT name FROM groups WHERE id = ?', p.audience_id)?.name || 'removido'}`;
  return 'Todos os alunos';
}

r.get('/posts', (req, res) => {
  const where = ['1=1'];
  const args = [];
  const status = String(req.query.status || '');
  if (status === 'scheduled') where.push("p.status = 'published' AND p.publish_at > datetime('now')");
  else if (['draft', 'published', 'archived'].includes(status)) where.push('p.status = ?') && args.push(status);
  if (req.query.category) { where.push('c.slug = ?'); args.push(String(req.query.category)); }
  if (req.query.q) {
    const q = `%${cleanText(req.query.q, 100)}%`;
    where.push('(p.title LIKE ? OR p.body LIKE ?)');
    args.push(q, q);
  }
  const posts = all(`${POST_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.pinned DESC, p.publish_at DESC LIMIT 200`, ...args);
  for (const p of posts) {
    p.audience_label = audienceLabel(p);
    p.audience_size = audienceStudentIds(p).length;
    p.attachments = postAttachments(p.id);
  }
  res.json(posts);
});

function loadPost(id) {
  const post = one(`${POST_SELECT} WHERE p.id = ?`, toInt(id));
  if (!post) throw new HttpError(404, 'Comunicado não encontrado');
  return post;
}

/** Professores só mexem nos próprios comunicados. */
function assertCanEdit(req, post) {
  if (req.user.role === 'professor' && post.author_id !== req.user.id) throw new HttpError(403, 'Professores editam apenas os próprios comunicados');
}

r.get('/posts/:id', (req, res) => {
  const post = loadPost(req.params.id);
  post.audience_label = audienceLabel(post);
  post.audience_size = audienceStudentIds(post).length;
  post.attachments = postAttachments(post.id);
  post.comments = commentTree(post.id, { staff: true, viewerId: req.user.id });
  res.json(post);
});

r.get('/posts/:id/views', (req, res) => {
  const post = loadPost(req.params.id);
  res.json(all(
    `SELECT u.name, s.matricula, se.name || ' ' || t.name AS turma, v.viewed_at, v.read_at
       FROM post_views v JOIN users u ON u.id = v.user_id
       LEFT JOIN students s ON s.user_id = u.id LEFT JOIN turmas t ON t.id = s.turma_id
       LEFT JOIN series se ON se.id = t.serie_id
      WHERE v.post_id = ? ORDER BY v.viewed_at DESC`, post.id,
  ));
});

function readPostFields(body) {
  const status = ['draft', 'published', 'archived'].includes(body.status) ? body.status : 'draft';
  const audienceType = ['all', 'serie', 'turma', 'group'].includes(body.audience_type) ? body.audience_type : 'all';
  const audienceId = audienceType === 'all' ? null : toInt(body.audience_id);
  if (audienceType !== 'all' && !audienceId) throw new HttpError(400, 'Escolha o público do comunicado');
  return {
    title: requireText(body.title, 'título', 200),
    body: cleanText(body.body, 20000),
    category_id: toInt(body.category_id),
    urgent: bool(body.urgent),
    pinned: bool(body.pinned),
    status,
    publish_at: toSqlDate(body.publish_at),
    audience_type: audienceType,
    audience_id: audienceId,
  };
}

function parseLinks(raw) {
  let links = [];
  try { links = JSON.parse(raw || '[]'); } catch { throw new HttpError(400, 'Links inválidos'); }
  return links.slice(0, 10).map((l) => {
    const url = cleanText(typeof l === 'string' ? l : l.url, 1000);
    let parsed;
    try { parsed = new URL(url); } catch { throw new HttpError(400, `Link inválido: ${url}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, 'Links precisam começar com http(s)://');
    return { url: parsed.href, name: cleanText(l.name, 200) || parsed.hostname };
  });
}

function saveAttachments(postId, files, links) {
  for (const f of files || []) {
    run('INSERT INTO attachments (post_id, kind, url, original_name, mime, size_bytes) VALUES (?,?,?,?,?,?)',
      postId, kindOf(f.originalname), `/uploads/${f.filename}`, cleanText(f.originalname, 200), f.mimetype, f.size);
  }
  for (const l of links) {
    run("INSERT INTO attachments (post_id, kind, url, original_name) VALUES (?, 'link', ?, ?)", postId, l.url, l.name);
  }
}

const discardFiles = (files) => (files || []).forEach((f) => removeUpload(`/uploads/${f.filename}`));

r.post('/posts', upload.array('files', 10), (req, res) => {
  try {
    const f = readPostFields(req.body);
    const links = parseLinks(req.body.links);
    const id = tx(() => {
      const info = run(
        `INSERT INTO posts (title, body, category_id, urgent, pinned, status, publish_at, audience_type, audience_id, author_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        f.title, f.body, f.category_id, f.urgent, f.pinned, f.status, f.publish_at, f.audience_type, f.audience_id, req.user.id,
      );
      const postId = Number(info.lastInsertRowid);
      saveAttachments(postId, req.files, links);
      return postId;
    });
    audit(req, 'post_created', 'post', id, { title: f.title, status: f.status });
    dispatchDueNotifications();
    res.status(201).json({ id });
  } catch (err) {
    discardFiles(req.files);
    throw err;
  }
});

r.put('/posts/:id', upload.array('files', 10), (req, res) => {
  try {
    const post = loadPost(req.params.id);
    assertCanEdit(req, post);
    const f = readPostFields(req.body);
    const links = parseLinks(req.body.links);
    let remove = [];
    try { remove = JSON.parse(req.body.remove_attachments || '[]').map(Number); } catch { /* ignora */ }
    tx(() => {
      run(
        `UPDATE posts SET title=?, body=?, category_id=?, urgent=?, pinned=?, status=?, publish_at=?, audience_type=?, audience_id=?,
                updated_at=datetime('now') WHERE id=?`,
        f.title, f.body, f.category_id, f.urgent, f.pinned, f.status, f.publish_at, f.audience_type, f.audience_id, post.id,
      );
      for (const attId of remove) {
        const att = one('SELECT * FROM attachments WHERE id = ? AND post_id = ?', attId, post.id);
        if (att) { run('DELETE FROM attachments WHERE id = ?', att.id); removeUpload(att.url); }
      }
      saveAttachments(post.id, req.files, links);
    });
    audit(req, 'post_updated', 'post', post.id, { title: f.title, status: f.status });
    dispatchDueNotifications();
    res.json({ ok: true });
  } catch (err) {
    discardFiles(req.files);
    throw err;
  }
});

r.post('/posts/:id/status', (req, res) => {
  const post = loadPost(req.params.id);
  assertCanEdit(req, post);
  const status = String(req.body.status);
  if (!['draft', 'published', 'archived'].includes(status)) throw new HttpError(400, 'Status inválido');
  run("UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?", status, post.id);
  audit(req, `post_${status}`, 'post', post.id);
  dispatchDueNotifications();
  res.json({ ok: true });
});

r.post('/posts/:id/pin', (req, res) => {
  const post = loadPost(req.params.id);
  assertCanEdit(req, post);
  run('UPDATE posts SET pinned = ? WHERE id = ?', bool(req.body.pinned), post.id);
  audit(req, bool(req.body.pinned) ? 'post_pinned' : 'post_unpinned', 'post', post.id);
  res.json({ ok: true });
});

r.delete('/posts/:id', requireStaff(...MANAGERS), (req, res) => {
  const post = loadPost(req.params.id);
  const files = all('SELECT url FROM attachments WHERE post_id = ?', post.id);
  run('DELETE FROM posts WHERE id = ?', post.id);
  files.forEach((f) => removeUpload(f.url));
  audit(req, 'post_deleted', 'post', post.id, { title: post.title });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- comentários
r.get('/comments', (req, res) => {
  const where = ["c.status != 'deleted'"];
  const args = [];
  if (req.query.filter === 'unanswered') {
    where.push(`u.role = 'aluno' AND c.parent_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM comments r JOIN users ru ON ru.id = r.user_id WHERE r.parent_id = c.id AND ru.role != 'aluno')`);
  }
  if (req.query.filter === 'hidden') where.push("c.status = 'hidden'");
  if (req.query.q) { where.push('c.body LIKE ?'); args.push(`%${cleanText(req.query.q, 100)}%`); }
  res.json(all(
    `SELECT c.*, u.name AS author_name, u.role AS author_role, p.title AS post_title
       FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id
      WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT 200`, ...args,
  ));
});

r.post('/posts/:id/comments', (req, res) => {
  const post = loadPost(req.params.id);
  const body = requireText(req.body.body, 'resposta', 2000);
  const parentId = toInt(req.body.parent_id);
  const parent = parentId ? one('SELECT * FROM comments WHERE id = ? AND post_id = ?', parentId, post.id) : null;
  if (parentId && !parent) throw new HttpError(400, 'Comentário de origem inválido');
  const info = run('INSERT INTO comments (post_id, user_id, parent_id, body) VALUES (?,?,?,?)', post.id, req.user.id, parentId, body);
  if (parent && parent.user_id !== req.user.id) {
    notify([parent.user_id], { type: 'reply', title: `A coordenação respondeu sua pergunta em "${post.title}"`, postId: post.id });
  }
  audit(req, 'comment_reply', 'comment', Number(info.lastInsertRowid), { post_id: post.id });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.post('/comments/:id/moderate', (req, res) => {
  const status = String(req.body.status);
  if (!['visible', 'hidden', 'deleted'].includes(status)) throw new HttpError(400, 'Status inválido');
  const info = run('UPDATE comments SET status = ? WHERE id = ?', status, toInt(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Comentário não encontrado');
  audit(req, `comment_${status}`, 'comment', toInt(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- séries, turmas e grupos
r.post('/series', requireStaff(...MANAGERS), (req, res) => {
  const name = requireText(req.body.name, 'nome', 80);
  const info = run('INSERT INTO series (name, sort_order) VALUES (?, ?)', name, toInt(req.body.sort_order) || 0);
  audit(req, 'serie_created', 'serie', Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.post('/turmas', requireStaff(...MANAGERS), (req, res) => {
  const name = requireText(req.body.name, 'nome', 80);
  const serieId = toInt(req.body.serie_id);
  if (!serieId) throw new HttpError(400, 'Escolha a série');
  const info = run('INSERT INTO turmas (name, serie_id, turno, year) VALUES (?,?,?,?)',
    name, serieId, cleanText(req.body.turno, 30) || null, toInt(req.body.year));
  audit(req, 'turma_created', 'turma', Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.delete('/turmas/:id', requireStaff(...MANAGERS), (req, res) => {
  run('DELETE FROM turmas WHERE id = ?', toInt(req.params.id));
  audit(req, 'turma_deleted', 'turma', toInt(req.params.id));
  res.json({ ok: true });
});

r.post('/groups', requireStaff(...MANAGERS), (req, res) => {
  const name = requireText(req.body.name, 'nome', 80);
  const info = run('INSERT INTO groups (name) VALUES (?)', name);
  audit(req, 'group_created', 'group', Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// ---------------------------------------------------------------- alunos
r.get('/students', (req, res) => {
  const where = ["u.role = 'aluno'"];
  const args = [];
  if (req.query.q) {
    const q = `%${cleanText(req.query.q, 100)}%`;
    where.push('(u.name LIKE ? OR s.matricula LIKE ? OR u.email LIKE ?)');
    args.push(q, q, q);
  }
  if (req.query.turma_id) { where.push('s.turma_id = ?'); args.push(toInt(req.query.turma_id)); }
  res.json(all(
    `SELECT u.id, u.name, u.username, u.email, u.active, u.created_at, u.last_login_at,
            s.matricula, s.turma_id, t.name AS turma, se.name AS serie
       FROM users u JOIN students s ON s.user_id = u.id
       LEFT JOIN turmas t ON t.id = s.turma_id LEFT JOIN series se ON se.id = t.serie_id
      WHERE ${where.join(' AND ')} ORDER BY u.name LIMIT 1000`, ...args,
  ));
});

async function createStudent({ name, matricula, email, turma_id, password }) {
  if (one('SELECT 1 FROM students WHERE matricula = ?', matricula)) throw new HttpError(409, `Matrícula já cadastrada: ${matricula}`);
  const hash = await hashPassword(password || matricula);
  return tx(() => {
    const info = run(
      "INSERT INTO users (role, name, username, email, password_hash, must_change_password) VALUES ('aluno',?,?,?,?,?)",
      name, matricula, email || null, hash, password ? 0 : 1,
    );
    const id = Number(info.lastInsertRowid);
    run('INSERT INTO students (user_id, matricula, turma_id) VALUES (?,?,?)', id, matricula, turma_id || null);
    return id;
  });
}

r.post('/students', requireStaff(...MANAGERS), ah(async (req, res) => {
  const id = await createStudent({
    name: requireText(req.body.name, 'nome', 120),
    matricula: requireText(req.body.matricula, 'matrícula', 40),
    email: cleanText(req.body.email, 160),
    turma_id: toInt(req.body.turma_id),
    password: req.body.password ? String(req.body.password) : null,
  });
  audit(req, 'student_created', 'user', id);
  res.status(201).json({ id });
}));

r.put('/students/:id', requireStaff(...MANAGERS), (req, res) => {
  const id = toInt(req.params.id);
  const matricula = requireText(req.body.matricula, 'matrícula', 40);
  if (one('SELECT 1 FROM students WHERE matricula = ? AND user_id != ?', matricula, id)) throw new HttpError(409, 'Matrícula já usada por outro aluno');
  tx(() => {
    run("UPDATE users SET name = ?, email = ?, username = ?, updated_at = datetime('now') WHERE id = ? AND role = 'aluno'",
      requireText(req.body.name, 'nome', 120), cleanText(req.body.email, 160) || null, matricula, id);
    run('UPDATE students SET matricula = ?, turma_id = ? WHERE user_id = ?', matricula, toInt(req.body.turma_id), id);
  });
  audit(req, 'student_updated', 'user', id);
  res.json({ ok: true });
});

r.post('/students/:id/active', requireStaff(...MANAGERS), (req, res) => {
  const id = toInt(req.params.id);
  run("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ? AND role = 'aluno'", bool(req.body.active), id);
  if (!bool(req.body.active)) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, bool(req.body.active) ? 'student_activated' : 'student_deactivated', 'user', id);
  res.json({ ok: true });
});

r.post('/students/:id/reset-password', requireStaff(...MANAGERS), ah(async (req, res) => {
  const id = toInt(req.params.id);
  const st = one('SELECT matricula FROM students WHERE user_id = ?', id);
  if (!st) throw new HttpError(404, 'Aluno não encontrado');
  const temp = req.body.password ? String(req.body.password) : st.matricula;
  run("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?", await hashPassword(temp), id);
  run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, 'student_password_reset', 'user', id);
  res.json({ ok: true, temporary: req.body.password ? 'definida' : 'matrícula' });
}));

/** CSV com cabeçalho: nome,matricula,serie,turma,email,senha (separador , ou ;). Série/turma são criadas se faltarem. */
r.post('/students/import', requireStaff(...MANAGERS), ah(async (req, res) => {
  const text = String(req.body.csv || '').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new HttpError(400, 'CSV vazio');
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const col = (row, key) => cleanText(row[head.indexOf(key)], 160);
  const result = { created: 0, errors: [] };
  for (const [i, line] of lines.slice(1).entries()) {
    const row = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    try {
      const name = col(row, 'nome');
      const matricula = col(row, 'matricula');
      if (!name || !matricula) throw new Error('nome e matrícula são obrigatórios');
      let turmaId = null;
      const serieName = col(row, 'serie');
      const turmaName = col(row, 'turma');
      if (serieName && turmaName) {
        run('INSERT INTO series (name) VALUES (?) ON CONFLICT DO NOTHING', serieName);
        const serieId = one('SELECT id FROM series WHERE name = ?', serieName).id;
        run('INSERT INTO turmas (name, serie_id) VALUES (?, ?) ON CONFLICT DO NOTHING', turmaName, serieId);
        turmaId = one('SELECT id FROM turmas WHERE name = ? AND serie_id = ?', turmaName, serieId).id;
      }
      await createStudent({ name, matricula, email: col(row, 'email'), turma_id: turmaId, password: col(row, 'senha') || null });
      result.created += 1;
    } catch (err) {
      result.errors.push(`Linha ${i + 2}: ${err.message}`);
    }
  }
  audit(req, 'students_imported', 'user', null, { created: result.created, errors: result.errors.length });
  res.json(result);
}));

// ---------------------------------------------------------------- equipe (somente admin geral)
r.get('/staff', requireStaff('admin'), (_req, res) => {
  res.json(all(`SELECT id, role, name, username, email, active, created_at, last_login_at
                  FROM users WHERE role IN ('admin','coordenacao','professor') ORDER BY role, name`));
});

r.post('/staff', requireStaff('admin'), ah(async (req, res) => {
  const role = String(req.body.role);
  if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Perfil inválido');
  const password = String(req.body.password || '');
  if (password.length < 6) throw new HttpError(400, 'Senha inicial precisa ter ao menos 6 caracteres');
  const username = requireText(req.body.username, 'usuário', 60);
  if (one('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'Usuário já existe');
  const info = run('INSERT INTO users (role, name, username, email, password_hash, must_change_password) VALUES (?,?,?,?,?,1)',
    role, requireText(req.body.name, 'nome', 120), username, cleanText(req.body.email, 160) || null, await hashPassword(password));
  audit(req, 'staff_created', 'user', Number(info.lastInsertRowid), { role, username });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

r.put('/staff/:id', requireStaff('admin'), (req, res) => {
  const id = toInt(req.params.id);
  const role = String(req.body.role);
  if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Perfil inválido');
  if (id === req.user.id && (role !== 'admin' || !bool(req.body.active))) throw new HttpError(400, 'Você não pode rebaixar ou desativar a própria conta');
  run("UPDATE users SET role = ?, name = ?, email = ?, active = ?, updated_at = datetime('now') WHERE id = ? AND role != 'aluno'",
    role, requireText(req.body.name, 'nome', 120), cleanText(req.body.email, 160) || null, bool(req.body.active), id);
  if (!bool(req.body.active)) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, 'staff_updated', 'user', id, { role });
  res.json({ ok: true });
});

r.get('/logs', requireStaff('admin'), (_req, res) => {
  res.json(all(`SELECT l.*, u.name AS user_name FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
                ORDER BY l.created_at DESC, l.id DESC LIMIT 300`));
});

export default r;
