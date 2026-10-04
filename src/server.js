import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { cookies, loadUser, pruneSessions, sameOrigin } from './auth.js';
import { ROOT, config } from './config.js';
import { migrate } from './db.js';
import adminRoutes from './routes/admin.js';
import alunoRoutes from './routes/aluno.js';
import { seed } from './seed.js';
import { HttpError, dispatchDueNotifications } from './util.js';

migrate();
await seed();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // cloudflared conecta via 127.0.0.1

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", 'https://static.cloudflareinsights.com'],
      connectSrc: ["'self'", 'https://cloudflareinsights.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.cookieSecure ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookies);

const isAdminHost = (req) => config.adminHosts.includes(String(req.hostname).toLowerCase());

// ---- API
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos.' } });
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' } });

app.use('/api', apiLimiter, sameOrigin);
app.use(['/api/admin/auth/login', '/api/aluno/auth/login'], loginLimiter);
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'tiraconnect' }));
app.use('/api/admin', loadUser('admin'), adminRoutes);
app.use('/api/aluno', loadUser('aluno'), alunoRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));

// ---- Uploads: só para quem tem sessão em algum dos portais
app.use('/uploads', loadUser('admin'), (req, res, next) => (req.user ? next() : loadUser('aluno')(req, res, next)),
  (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Faça login'))),
  express.static(config.uploadDir, { fallthrough: false, maxAge: '7d', setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));

// ---- Front-ends estáticos
const pub = (p) => path.join(ROOT, 'public', p);
app.use('/shared', express.static(pub('shared'), { maxAge: '1h' }));
app.use('/coordenacao', express.static(pub('admin')));
app.get('/coordenacao/*', (_req, res) => res.sendFile(pub('admin/index.html')));
app.use((req, res, next) => express.static(pub(isAdminHost(req) ? 'admin' : 'aluno'))(req, res, next));
app.get('*', (req, res) => res.sendFile(pub(isAdminHost(req) ? 'admin/index.html' : 'aluno/index.html')));

// ---- Erros
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Arquivo maior que ${config.maxUploadMb} MB` });
  if (String(err.message).includes('UNIQUE constraint')) return res.status(409).json({ error: 'Registro duplicado' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno' : err.message });
});

// Publicações agendadas viram notificação quando chega a hora; sessões expiradas são limpas.
setInterval(() => { dispatchDueNotifications(); pruneSessions(); }, 60_000).unref();
dispatchDueNotifications();

app.listen(config.port, config.host, () => {
  console.log(`[tiraconnect] ouvindo em http://${config.host}:${config.port}  (admin em /coordenacao ou hosts: ${config.adminHosts.join(', ') || '—'})`);
});
