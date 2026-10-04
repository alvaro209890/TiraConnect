# 06 — Roadmap

## Curto prazo (pós-apresentação)
- [ ] Trocar `admin/admin` e desligar `SEED_DEMO` na produção
- [ ] Cloudflare Access no `tiraconnect-admin`
- [ ] Recuperação de senha por e-mail (token de uso único, 30 min)
- [ ] Importação XLSX direta (hoje: CSV)
- [ ] Gerenciar membros dos grupos pela interface
- [ ] Editar categorias pela interface
- [ ] Backup externo (Drive)

## Notificações externas
A tabela `notifications` já tem `channel` e `delivery_status`. Plano:
1. Worker (`src/workers/notify.js`) lê `delivery_status = 'pending'` e envia por canal.
2. **E-mail**: SMTP via `.env`.
3. **WhatsApp**: integração com o bridge da casa (regra: mensagem para terceiros nunca sai do chip do Hermes — avaliar número institucional próprio da escola).
4. **Push (PWA)**: Web Push com VAPID; transformar o portal do aluno em PWA instalável.

## Módulos futuros
Cada módulo entra como migration nova + rotas em `src/routes/<modulo>.js` + tela nos dois portais:
- Calendário escolar (provas e eventos já viram itens de calendário)
- Boletim e notas
- Presença
- Materiais de aula e trabalhos (com entrega pelo aluno)
- Área do professor por turma/disciplina
- App mobile (a API REST já serve; React Native/Expo ou PWA)
- Migração para PostgreSQL quando houver múltiplos processos/relatórios
