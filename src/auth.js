import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config, STAFF_ROLES } from './config.js';
import { one, run } from './db.js';
import { HttpError, clientIp } from './util.js';

export const COOKIE = { admin: 'tc_admin', aluno: 'tc_aluno' };

export const hashPassword = (plain) => bcrypt.hash(plain, 12);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(req, res, user, portal) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  run(
    'INSERT INTO sessions (token_hash, user_id, portal, ip, user_agent, expires_at) VALUES (?,?,?,?,?,?)',
    sha256(token), user.id, portal, clientIp(req), String(req.get('user-agent') || '').slice(0, 300),
    expires.toISOString().slice(0, 19).replace('T', ' '),
  );
  res.cookie(COOKIE[portal], token, {
    httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires, path: '/',
  });
}

export function destroySession(req, res, portal) {
  const token = req.cookies?.[COOKIE[portal]];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE[portal], { path: '/' });
}

/** Lê o cookie do portal e carrega req.user. Não bloqueia; quem bloqueia é requireStaff/requireStudent. */
export function loadUser(portal) {
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE[portal]];
    if (token) {
      const user = one(
        `SELECT u.id, u.role, u.name, u.username, u.email, u.must_change_password
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.portal = ? AND s.expires_at > datetime('now') AND u.active = 1`,
        sha256(token), portal,
      );
      if (user) req.user = user;
    }
    next();
  };
}

export const requireStaff = (...roles) => (req, _res, next) => {
  const allowed = roles.length ? roles : STAFF_ROLES;
  if (!req.user) return next(new HttpError(401, 'Faça login'));
  if (!allowed.includes(req.user.role)) return next(new HttpError(403, 'Sem permissão'));
  next();
};

export const requireStudent = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Faça login'));
  if (req.user.role !== 'aluno') return next(new HttpError(403, 'Área exclusiva de alunos'));
  next();
};

/** Parser mínimo de cookies (evita dependência extra). */
export function cookies(req, _res, next) {
  req.cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  next();
}

/** CSRF: requisições que alteram dados precisam vir do próprio site (Origin/Referer). Cookie já é SameSite=Strict. */
export function sameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : null);
  if (!origin) return next(new HttpError(403, 'Origem ausente'));
  const host = req.get('host');
  const ok = new URL(origin).host === host || config.allowedOrigins.includes(origin);
  if (!ok) return next(new HttpError(403, 'Origem não permitida'));
  next();
}

export function pruneSessions() {
  run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
}
