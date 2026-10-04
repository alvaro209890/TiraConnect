# TiraConnect

Mural / rede social institucional entre a escola e os alunos. Tema escuro, vermelho + azul, layout inspirado no X (feed em 3 colunas) e no Instagram (stories de categorias, grade de mídias). Feito para funcionar bem no celular.

| Portal | Produção | Local |
|---|---|---|
| Alunos | https://tiraconnect.cursar.space | http://127.0.0.1:3120/ |
| Coordenação | https://tiraconnect-admin.cursar.space | http://127.0.0.1:3120/coordenacao/ |

Os dois portais usam o **mesmo backend e o mesmo banco**; cada um tem cookie de sessão próprio (`tc_admin` / `tc_aluno`), e um aluno não acessa nenhuma rota `/api/admin/*`.

**Acesso de demonstração** (criado pelo seed a partir do `.env`, troque depois):
- Coordenação: `admin` / `admin`
- Alunos de exemplo: matrícula `2026001` a `2026005`, senha `aluno123`
- Professor de exemplo: `marina` / `aluno123`

## Stack

- **Node.js 22 + Express** — API e arquivos estáticos num único processo
- **SQLite** (`node:sqlite`, embutido no Node; modo WAL) — o modelo foi desenhado para migrar para PostgreSQL sem mudanças (ver `planos/02-banco-de-dados.md`)
- **Front em JavaScript puro** (ES modules, sem etapa de build) — `public/aluno` e `public/admin`
- **bcrypt** para senhas, **helmet** (CSP e cabeçalhos), **express-rate-limit**, **multer** para uploads
- Produção: **systemd `--user` + Cloudflare Tunnel**, o padrão do server-desktop. Há `Dockerfile` e `docker-compose.yml` como alternativa.

## Estrutura

```
TiraConnect/
├── src/
│   ├── server.js        # app Express: segurança, roteamento por host, estáticos, agendador
│   ├── config.js        # leitura do .env
│   ├── db.js            # conexão SQLite + executor de migrations
│   ├── auth.js          # sessões, bcrypt, papéis, CSRF (Origin)
│   ├── uploads.js       # multer com lista branca de tipos e limite de tamanho
│   ├── util.js          # auditoria, notificações, segmentação de público
│   ├── seed.js          # admin inicial + dados de demonstração
│   └── routes/
│       ├── admin.js     # /api/admin/*  (coordenação)
│       ├── aluno.js     # /api/aluno/*  (alunos)
│       └── shared.js
├── migrations/001_init.sql
├── public/
│   ├── shared/          # style.css, common.js, logo
│   ├── aluno/           # portal do aluno (feed)
│   └── admin/           # portal da coordenação (menu lateral)
├── deploy/              # units systemd e o modelo do túnel
├── scripts/             # backup, restore, install-server
├── planos/              # documentos de planejamento (arquitetura, banco, telas, roadmap…)
├── Dockerfile · docker-compose.yml · .env.example
```

## Rodar localmente

```bash
cp .env.example .env
npm install
npm start            # http://127.0.0.1:3120  e  /coordenacao/
```

Na primeira execução as migrations rodam e o seed cria o admin e os dados de exemplo (`SEED_DEMO=true`).

## Produção (server-desktop)

O código fica no HD de backup: `/media/server/HD Backup/Servidores_NAO_MEXA/TiraConnect` (regra da casa: projetos rodam do HD, não do SSD).

```bash
# no server
cd "/media/server/HD Backup/Servidores_NAO_MEXA"
git clone https://github.com/alvaro209890/TiraConnect.git
cd TiraConnect
cp .env.example .env && nano .env       # COOKIE_SECURE=true, BACKUP_DIR, senhas
bash scripts/install-server.sh
```

`.env` de produção (valores com espaço **entre aspas**, porque o `backup.sh` faz `source` do arquivo):

```
COOKIE_SECURE=true
ADMIN_HOSTS=tiraconnect-admin.cursar.space
ALLOWED_ORIGINS=https://tiraconnect.cursar.space,https://tiraconnect-admin.cursar.space
BACKUP_DIR="/media/server/HD Backup/Backups/TiraConnect"
```

### Domínio (Cloudflare Tunnel)

Túnel nomeado próprio, como os outros serviços da casa. **Sempre com `--config` explícito e o UUID**, para que nenhum `config.yml` padrão sequestre o `route dns` (pegadinha registrada no Segundo Cérebro):

```bash
cloudflared tunnel create tiraconnect                       # anota o UUID
cp deploy/cloudflared-tiraconnect.yml.example ~/.cloudflared/tiraconnect.yml   # troque <UUID>
cloudflared --config ~/.cloudflared/tiraconnect.yml tunnel route dns <UUID> tiraconnect.cursar.space
cloudflared --config ~/.cloudflared/tiraconnect.yml tunnel route dns <UUID> tiraconnect-admin.cursar.space
systemctl --user enable --now tiraconnect-cloudflared
```

O HTTPS fica com a borda da Cloudflare (certificado automático). A aplicação escuta só em `127.0.0.1:3120`.

### Atualizar

```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/TiraConnect"
bash scripts/backup.sh && git pull && bash scripts/install-server.sh
```

As migrations novas (`migrations/NNN_*.sql`) são aplicadas automaticamente no start.

### Operação

```bash
systemctl --user status tiraconnect tiraconnect-cloudflared
journalctl --user -u tiraconnect -f
curl http://127.0.0.1:3120/api/health
```

## Backup

- `scripts/backup.sh` gera `tiraconnect-AAAAMMDD-HHMMSS.tar.gz` com **snapshot consistente do banco** (`VACUUM INTO`, seguro com o serviço rodando), **uploads** e **.env**; arquivo `chmod 600`; retenção de `BACKUP_KEEP_DAYS` dias.
- `tiraconnect-backup.timer` roda todo dia às 03:20.
- Restaurar: `systemctl --user stop tiraconnect && bash scripts/restore.sh <arquivo> && systemctl --user start tiraconnect`.

## Segurança (resumo)

Senhas com bcrypt (custo 12) · sessão em cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` em produção) com token aleatório guardado só como hash · checagem de `Origin` em toda requisição que altera dados (CSRF) · consultas 100% parametrizadas (SQL injection) · texto do usuário sempre renderizado como texto, nunca HTML, e CSP restritiva (XSS) · uploads com lista branca de extensões, conferência de MIME, nome aleatório e limite de tamanho · uploads só para quem tem sessão · rate limit global e mais estrito no login · log de logins, falhas e ações administrativas · segredos só no `.env` (fora do git).

> ⚠️ `admin/admin` é só para a apresentação. Antes de usar com alunos reais, troque a senha em **Minha conta**.

Detalhes e próximos passos em [`planos/`](planos/).
