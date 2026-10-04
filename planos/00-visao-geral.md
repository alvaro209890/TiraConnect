# 00 — Visão geral

**TiraConnect** é o canal oficial de comunicação entre a escola e os alunos, em formato de rede social institucional.

## Fluxo principal

```
Coordenação publica comunicado
        ↓
Servidor salva (SQLite) e gera notificações para o público-alvo
        ↓
Aluno entra no portal e vê o comunicado no feed (marcado como novo)
        ↓
Aluno comenta ou pergunta
        ↓
Coordenação responde (o aluno recebe notificação)
        ↓
Toda a conversa fica vinculada ao comunicado
```

## Perfis

| Perfil | Portal | Pode |
|---|---|---|
| Administração | Coordenação | tudo, inclusive equipe e logs |
| Coordenação | Coordenação | comunicados, alunos, turmas, moderação |
| Professor(a) | Coordenação | cria/edita os próprios comunicados, responde alunos |
| Aluno(a) | Alunos | lê, comenta, pergunta, marca como lido |

## Estado (04/10/2026) — v0.1, versão de apresentação

Pronto e funcionando:
- [x] Dois portais (subdomínios distintos) com o mesmo backend
- [x] Login seguro com sessões e papéis
- [x] Comunicados: criar, editar, publicar, agendar, arquivar, excluir, fixar, urgente
- [x] Anexos: imagens, vídeos, PDF, documentos, links externos
- [x] Público: todos / série / turma / grupo
- [x] Feed do aluno com fixados, filtros por categoria, busca, "não lidos", indicação de novo
- [x] Comentários em árvore, perguntas, respostas da coordenação, moderação
- [x] Visualizações e leituras por comunicado
- [x] Notificações no portal
- [x] Alunos: CRUD, ativar/desativar, reset de senha, importação CSV
- [x] Turmas, séries e grupos
- [x] Equipe com níveis de acesso
- [x] Logs de acesso e ações
- [x] Backup diário automatizado

Ver [06-roadmap.md](06-roadmap.md) para o que vem depois.
