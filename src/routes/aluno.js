import { Router } from 'express';
import { checkPassword, createSession, destroySession, hashPassword, requireStudent } from '../auth.js';
import { all, one, run } from '../db.js';
import { AUDIENCE_SQL, HttpError, ah, audit, cleanText, requireText, toInt } from '../util.js';
import { commentTree, postAttachments } from './shared.js';

const r = Router();

r.post('/auth/login', ah(async (req, res) => {
  const login = cleanText(req.body.username, 100);
  const user = one(
    `SELECT u.* FROM users u LEFT JOIN students s ON s.user_id = u.id
      WHERE u.role = 'aluno' AND (u.username = ? OR s.matricula = ? OR u.email = ?)`,
    login, login, login,
  );
  if (!user || !user.active || !(await checkPassword(String(req.body.password || ''), user.password_hash))) {
    audit(req, 'login_failed', 'aluno', null, { login });
    throw new HttpError(401, 'Usuário ou senha inválidos');
  }
  createSession(req, res, user, 'aluno');
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  req.user = user;
  audit(req, 'login', 'aluno', user.id);
  res.json({ ok: true });
}));

r.post('/auth/logout', (req, res) => {
  destroySession(req, res, 'aluno');
  res.json({ ok: true });
});

r.use(requireStudent);

r.get('/me', (req, res) => {
  const me = one(
    `SELECT u.id, u.name, u.username, u.email, u.must_change_password, s.matricula,
            t.name AS turma, se.name AS serie
       FROM users u JOIN students s ON s.user_id = u.id
       LEFT JOIN turmas t ON t.id = s.turma_id LEFT JOIN series se ON se.id = t.serie_id
      WHERE u.id = ?`, req.user.id,
  );
  me.unread_notifications = one('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n;
  res.json(me);
});

r.post('/me/password', ah(async (req, res) => {
  const user = one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!(await checkPassword(String(req.body.current || ''), user.password_hash))) throw new HttpError(400, 'Senha atual incorreta');
  const next = String(req.body.next || '');
  if (next.length < 6) throw new HttpError(400, 'A nova senha precisa ter ao menos 6 caracteres');
  run("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?", await hashPassword(next), req.user.id);
  audit(req, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
}));

r.get('/categories', (_req, res) => res.json(all('SELECT * FROM categories ORDER BY sort_order')));

const VISIBLE = `p.status = 'published' AND p.publish_at <= datetime('now') AND ${AUDIENCE_SQL}`;
const visibleArgs = (uid) => [uid, uid, uid];

r.get('/feed', (req, res) => {
  const uid = req.user.id;
  const where = [VISIBLE];
  const args = visibleArgs(uid);
  if (req.query.category === 'urgente') where.push('p.urgent = 1');
  else if (req.query.category) { where.push('c.slug = ?'); args.push(String(req.query.category)); }
  if (req.query.q) {
    where.push('(p.title LIKE ? OR p.body LIKE ?)');
    const q = `%${cleanText(req.query.q, 100)}%`;
    args.push(q, q);
  }
  if (req.query.unread === '1') where.push('v.read_at IS NULL');
  const limit = Math.min(toInt(req.query.limit) || 30, 100);
  const offset = toInt(req.query.offset) || 0;

  const posts = all(
    `SELECT p.id, p.title, p.body, p.urgent, p.pinned, p.publish_at, p.created_at,
            c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS author_name, a.role AS author_role,
            v.viewed_at, v.read_at,
            (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id AND cm.status = 'visible') AS comment_count,
            (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id) AS view_count
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN users a ON a.id = p.author_id
       LEFT JOIN post_views v ON v.post_id = p.id AND v.user_id = ?
      WHERE ${where.join(' AND ')}
      ORDER BY p.pinned DESC, p.publish_at DESC
      LIMIT ? OFFSET ?`,
    uid, ...args, limit, offset,
  );
  for (const p of posts) p.attachments = postAttachments(p.id);
  const unread = one(
    `SELECT COUNT(*) n FROM posts p LEFT JOIN post_views v ON v.post_id = p.id AND v.user_id = ?
      WHERE ${VISIBLE} AND v.viewed_at IS NULL`, uid, ...visibleArgs(uid),
  ).n;
  res.json({ posts, unread });
});

function visiblePost(req) {
  const uid = req.user.id;
  const post = one(
    `SELECT p.id, p.title, p.body, p.urgent, p.pinned, p.publish_at,
            c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS author_name, a.role AS author_role
       FROM posts p LEFT JOIN categories c ON c.id = p.category_id JOIN users a ON a.id = p.author_id
      WHERE p.id = ? AND ${VISIBLE}`,
    toInt(req.params.id), ...visibleArgs(uid),
  );
  if (!post) throw new HttpError(404, 'Comunicado não encontrado');
  return post;
}

r.get('/posts/:id', (req, res) => {
  const post = visiblePost(req);
  run('INSERT INTO post_views (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', post.id, req.user.id);
  run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND post_id = ? AND read_at IS NULL", req.user.id, post.id);
  const view = one('SELECT read_at FROM post_views WHERE post_id = ? AND user_id = ?', post.id, req.user.id);
  post.read_at = view?.read_at || null;
  post.attachments = postAttachments(post.id);
  post.comments = commentTree(post.id, { viewerId: req.user.id });
  res.json(post);
});

r.post('/posts/:id/read', (req, res) => {
  const post = visiblePost(req);
  run(`INSERT INTO post_views (post_id, user_id, read_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (post_id, user_id) DO UPDATE SET read_at = COALESCE(read_at, datetime('now'))`, post.id, req.user.id);
  res.json({ ok: true });
});

r.post('/posts/:id/comments', (req, res) => {
  const post = visiblePost(req);
  const body = requireText(req.body.body, 'comentário', 2000);
  const parentId = toInt(req.body.parent_id);
  if (parentId && !one("SELECT id FROM comments WHERE id = ? AND post_id = ? AND status = 'visible'", parentId, post.id)) {
    throw new HttpError(400, 'Comentário de origem inválido');
  }
  const info = run('INSERT INTO comments (post_id, user_id, parent_id, body, is_question) VALUES (?,?,?,?,?)',
    post.id, req.user.id, parentId, body, req.body.is_question ? 1 : 0);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

r.delete('/comments/:id', (req, res) => {
  const info = run("UPDATE comments SET status = 'deleted' WHERE id = ? AND user_id = ?", toInt(req.params.id), req.user.id);
  if (!info.changes) throw new HttpError(404, 'Comentário não encontrado');
  res.json({ ok: true });
});

r.get('/notifications', (req, res) => {
  res.json(all('SELECT * FROM notifications WHERE user_id = ? AND channel = \'portal\' ORDER BY created_at DESC LIMIT 50', req.user.id));
});

r.post('/notifications/read-all', (req, res) => {
  run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user.id);
  res.json({ ok: true });
});

export default r;
