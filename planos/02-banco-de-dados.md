# 02 — Banco de dados

Arquivo: `migrations/001_init.sql`. Migrations novas: `migrations/NNN_descricao.sql`, aplicadas em ordem e registradas em `schema_migrations`.

## Entidades

```
users ─┬─< sessions
       ├─1 students >─ turmas >─ series
       ├─< group_members >─ groups
       ├─< posts (author_id) ─┬─< attachments
       │                      ├─< comments (parent_id → comments)
       │                      ├─< post_views
       │                      └─< notifications
       ├─< comments
       ├─< post_views
       ├─< notifications
       └─< audit_logs
categories ─< posts
```

| Tabela | Papel |
|---|---|
| `users` | todo mundo que faz login. `role` ∈ admin, coordenacao, professor, aluno. "Administradores" = users com role de equipe |
| `students` | perfil 1:1 do aluno: matrícula (única), turma |
| `series`, `turmas` | estrutura escolar; turma pertence a uma série |
| `groups`, `group_members` | segmentação livre (clube, time, monitores) |
| `categories` | Provas, Trabalhos, Eventos, Feriados, Reuniões, Mudança de horário, Suspensão, Avisos, Outros |
| `posts` | comunicados. `status` draft/published/archived; `publish_at` no futuro = agendado; `audience_type` all/serie/turma/group + `audience_id`; `urgent`, `pinned`; `notified` controla o disparo |
| `attachments` | image/video/file/link; arquivos em `uploads/` com nome aleatório |
| `comments` | comentários e respostas (`parent_id`); `is_question`; `status` visible/hidden/deleted (moderação sem perder histórico) |
| `post_views` | quem viu (`viewed_at`) e quem marcou como lido (`read_at`) — PK (post, user) |
| `notifications` | por usuário; `channel` (portal hoje; email/whatsapp/push depois) + `delivery_status` |
| `sessions` | hash do token, portal, expiração, IP, user-agent |
| `audit_logs` | login, falhas de login e todas as ações administrativas |

## Índices

Feed (`posts(status, publish_at)`), segmentação (`posts(audience_type, audience_id)`), comentários por post, notificações por usuário/leitura, logs por data, alunos por turma.

## Migração futura para PostgreSQL

O SQL é quase todo portável. Ajustes: `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL`/`IDENTITY`; `datetime('now')` → `now()`; `TEXT` de datas → `TIMESTAMPTZ`; `COLLATE NOCASE` → `CITEXT` ou índice em `lower()`; `LIKE` → `ILIKE` (ou `pg_trgm` para busca). Exportar com um script que leia do SQLite e insira no Postgres na ordem das FKs.
