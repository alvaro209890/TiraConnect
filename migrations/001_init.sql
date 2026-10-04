-- TiraConnect — esquema inicial (SQLite; desenhado para migrar a PostgreSQL sem mudar o modelo)

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT NOT NULL CHECK (role IN ('admin','coordenacao','professor','aluno')),
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE series (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE turmas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  serie_id INTEGER NOT NULL REFERENCES series(id) ON DELETE RESTRICT,
  turno    TEXT,
  year     INTEGER,
  UNIQUE (serie_id, name)
);

-- Perfil de aluno (1:1 com users.role = 'aluno')
CREATE TABLE students (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  matricula TEXT NOT NULL UNIQUE,
  turma_id  INTEGER REFERENCES turmas(id) ON DELETE SET NULL
);
CREATE INDEX idx_students_turma ON students(turma_id);

-- Grupos livres (clube, time, monitores...) para segmentar comunicados
CREATE TABLE groups (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT '📌',
  color TEXT NOT NULL DEFAULT '#3A86FF',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  urgent        INTEGER NOT NULL DEFAULT 0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  publish_at    TEXT NOT NULL DEFAULT (datetime('now')),   -- UTC; futuro = agendado
  audience_type TEXT NOT NULL DEFAULT 'all' CHECK (audience_type IN ('all','serie','turma','group')),
  audience_id   INTEGER,
  author_id     INTEGER NOT NULL REFERENCES users(id),
  notified      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_posts_feed ON posts(status, publish_at DESC);
CREATE INDEX idx_posts_audience ON posts(audience_type, audience_id);
CREATE INDEX idx_posts_category ON posts(category_id);

CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image','video','file','link')),
  url           TEXT NOT NULL,          -- /uploads/<arquivo> ou link externo
  original_name TEXT,
  mime          TEXT,
  size_bytes    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_post ON attachments(post_id);

-- Comentários e respostas (parent_id = resposta dentro da discussão)
CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  is_question INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_id);

CREATE TABLE post_views (
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at   TEXT,                      -- "marcar como lido" explícito
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX idx_views_user ON post_views(user_id);

-- Notificações: canal 'portal' hoje; 'email' / 'whatsapp' / 'push' entram como novas linhas
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,            -- new_post | reply | urgent ...
  title      TEXT NOT NULL,
  post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL DEFAULT 'portal',
  delivery_status TEXT NOT NULL DEFAULT 'delivered', -- pending|delivered|failed (canais externos)
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portal     TEXT NOT NULL CHECK (portal IN ('admin','aluno')),
  ip         TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  ip         TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

INSERT INTO categories (slug, name, icon, color, sort_order) VALUES
  ('provas',    'Provas',    '📝', '#E63946', 1),
  ('trabalhos', 'Trabalhos', '📚', '#3A86FF', 2),
  ('eventos',   'Eventos',   '🎉', '#8B5CF6', 3),
  ('feriados',  'Feriados',  '🌴', '#10B981', 4),
  ('reunioes',  'Reuniões',  '👥', '#F59E0B', 5),
  ('horario',   'Mudança de horário', '⏰', '#06B6D4', 6),
  ('suspensao', 'Suspensão de aulas', '⛔', '#EF4444', 7),
  ('avisos',    'Avisos',    '📢', '#60A5FA', 8),
  ('outros',    'Outros',    '📌', '#94A3B8', 9);
