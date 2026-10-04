import { all, run } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Envolve handler async e encaminha erros ao middleware de erro. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Texto puro: remove caracteres de controle e limita tamanho. O front sempre renderiza com textContent. */
export function cleanText(value, max = 5000) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function requireText(value, field, max) {
  const v = cleanText(value, max);
  if (!v) throw new HttpError(400, `Campo obrigatório: ${field}`);
  return v;
}

export const toInt = (v) => (v === undefined || v === null || v === '' ? null : Number.parseInt(v, 10) || null);
export const bool = (v) => (v === true || v === 'true' || v === 1 || v === '1' || v === 'on' ? 1 : 0);

/** ISO (ou datetime-local) -> 'YYYY-MM-DD HH:MM:SS' UTC, formato usado pelo SQLite. */
export function toSqlDate(value) {
  if (!value) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Data inválida');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || null;

export function audit(req, action, entity = null, entityId = null, meta = null) {
  run(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, ip, meta) VALUES (?,?,?,?,?,?)',
    req.user?.id ?? null, action, entity, entityId, clientIp(req), meta ? JSON.stringify(meta) : null,
  );
}

/**
 * IDs dos alunos ativos que pertencem ao público de um comunicado.
 * Ponto único de segmentação — usado no feed (SQL equivalente) e nas notificações.
 */
export function audienceStudentIds(post) {
  const base = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
                LEFT JOIN turmas t ON t.id = s.turma_id WHERE u.active = 1 AND u.role = 'aluno'`;
  switch (post.audience_type) {
    case 'turma': return all(`${base} AND s.turma_id = ?`, post.audience_id).map((r) => r.id);
    case 'serie': return all(`${base} AND t.serie_id = ?`, post.audience_id).map((r) => r.id);
    case 'group': return all(`${base} AND u.id IN (SELECT user_id FROM group_members WHERE group_id = ?)`, post.audience_id).map((r) => r.id);
    default: return all(base).map((r) => r.id);
  }
}

/** Condição SQL (alias p = posts) que diz se o aluno ? pode ver o comunicado. Usa 3 parâmetros: userId x3. */
export const AUDIENCE_SQL = `(
  p.audience_type = 'all'
  OR (p.audience_type = 'turma' AND p.audience_id = (SELECT turma_id FROM students WHERE user_id = ?))
  OR (p.audience_type = 'serie' AND p.audience_id = (SELECT t.serie_id FROM students s JOIN turmas t ON t.id = s.turma_id WHERE s.user_id = ?))
  OR (p.audience_type = 'group' AND p.audience_id IN (SELECT group_id FROM group_members WHERE user_id = ?))
)`;

/**
 * Cria notificações no portal. Canais externos (e-mail/WhatsApp/push) entram aqui depois:
 * basta inserir linhas com channel diferente e delivery_status = 'pending' para um worker enviar.
 */
export function notify(userIds, { type, title, postId = null }) {
  const stmt = 'INSERT INTO notifications (user_id, type, title, post_id) VALUES (?,?,?,?)';
  for (const id of new Set(userIds)) run(stmt, id, type, title, postId);
}

/** Dispara notificações de comunicados publicados cujo horário já chegou (inclui agendados). */
export function dispatchDueNotifications() {
  const due = all(`SELECT p.*, c.name AS category_name FROM posts p LEFT JOIN categories c ON c.id = p.category_id
                   WHERE p.status = 'published' AND p.notified = 0 AND p.publish_at <= datetime('now')`);
  for (const post of due) {
    const prefix = post.urgent ? '🚨 Urgente' : `Novo comunicado${post.category_name ? ` · ${post.category_name}` : ''}`;
    notify(audienceStudentIds(post), { type: post.urgent ? 'urgent' : 'new_post', title: `${prefix}: ${post.title}`, postId: post.id });
    run('UPDATE posts SET notified = 1 WHERE id = ?', post.id);
  }
}
