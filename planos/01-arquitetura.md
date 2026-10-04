# 01 — Arquitetura

## Contexto da infraestrutura (Segundo Cérebro, consultado em 04/10/2026)

- **server-desktop** é a máquina de produção 24/7. Serviços do Álvaro rodam como **systemd `--user`** (Node/Python direto no host); Docker é usado só para bancos de terceiros.
- **Sem proxy reverso local** (nada de Nginx/Traefik/Caddy): cada app é publicada por um **Cloudflare Tunnel nomeado** (`~/.cloudflared/<app>.yml` + unit `<app>-cloudflared.service`). O HTTPS é da borda da Cloudflare.
- Domínio: **`*.cursar.space`**. Padrão de app com admin separado já usado pelo AlertaCAR (`alertacar` / `alertacar-admin`).
- Portas: faixa **3000–3199** para backends Node; **3120 estava livre** e foi reservada.
- Projetos ficam no **HD de backup**: `/media/server/HD Backup/Servidores_NAO_MEXA/<Projeto>`.

## Decisão

```
 Navegador (aluno)                      Navegador (coordenação)
 tiraconnect.cursar.space               tiraconnect-admin.cursar.space
            \                                   /
             └──────── Cloudflare (HTTPS) ──────┘
                              │  túnel "tiraconnect"
                              ▼
               cloudflared (tiraconnect-cloudflared.service)
                              │
                              ▼  http://127.0.0.1:3120
          ┌───────────────────────────────────────────┐
          │  tiraconnect.service  (Node 22 + Express)  │
          │  • roteia pelo Host: admin x aluno          │
          │  • /api/admin/*   /api/aluno/*             │
          │  • /uploads (só com sessão)                 │
          │  • agendador: publicações futuras/sessões   │
          └───────────────┬───────────────┬───────────┘
                          │               │
                 data/tiraconnect.db   uploads/
                     (SQLite WAL)      (arquivos)
                          │
               tiraconnect-backup.timer → /media/server/HD Backup/Backups/TiraConnect
```

### Por que assim

| Escolha | Motivo |
|---|---|
| Um processo só (API + front) | menos peças para a apresentação; dois portais = dois hostnames no mesmo túnel |
| SQLite embutido | zero serviço extra, backup = um arquivo; aguenta folgado uma escola (milhares de alunos) |
| Front sem build | qualquer agente/pessoa edita e publica sem toolchain |
| systemd `--user` em vez de Docker | é o padrão da casa para código do Álvaro; Docker fica disponível (`docker-compose.yml`) |
| Túnel próprio | não toca em nenhum `.yml` de outro serviço |

### Quando evoluir

- **PostgreSQL**: quando houver vários processos escrevendo, réplicas ou relatórios pesados. Subir em Docker (padrão da casa para bancos), porta só em loopback, e trocar `src/db.js`. Ver `02-banco-de-dados.md`.
- **Next.js/React**: quando o front crescer (boletim, calendário, app). A API REST já está separada por portal e pode ser consumida por um app mobile.
