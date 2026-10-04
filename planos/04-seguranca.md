# 04 — Segurança

| Ameaça | Medida implementada |
|---|---|
| Senhas vazadas | bcrypt custo 12; senha provisória marcada (`must_change_password`) |
| Roubo de sessão | token aleatório de 256 bits; no banco só o SHA-256; cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção; expira em `SESSION_HOURS` |
| Aluno acessando admin | cookies separados por portal; `/api/admin/*` exige papel de equipe; consultas de aluno filtram pelo público do comunicado |
| Escalada dentro da equipe | professor só edita os próprios comunicados; equipe e logs só para admin; admin não pode rebaixar/desativar a si mesmo |
| CSRF | `SameSite=Strict` + checagem de `Origin`/`Referer` em POST/PUT/DELETE |
| SQL Injection | todas as consultas parametrizadas (`?`) |
| XSS | front nunca usa `innerHTML` com dado do usuário (tudo `textContent`); links montados como elementos; CSP `script-src 'self'` |
| Upload malicioso | lista branca de extensões, MIME conferido para imagem/vídeo, nome aleatório, `nosniff`, limite `MAX_UPLOAD_MB`, máx. 10 arquivos; SVG/HTML recusados |
| Arquivos privados | `/uploads` só com sessão válida |
| Força bruta | 20 tentativas de login / 15 min por IP; 300 req/min na API |
| Rastreabilidade | `audit_logs`: login, falha de login, logout, criação/edição/publicação/exclusão, moderação, alunos, equipe |
| Segredos | só no `.env` (fora do git); `.env.example` sem valores reais |
| Exposição de rede | app escuta só em `127.0.0.1`; entrada única pelo túnel Cloudflare |

## Pendências conscientes

- `admin/admin` é credencial de apresentação → trocar antes do uso real (ou desligar `SEED_*`).
- Recuperação de senha por e-mail ainda não existe; hoje a coordenação redefine (senha volta a ser a matrícula, provisória).
- Considerar **Cloudflare Access** na frente do `tiraconnect-admin` (2º fator sem código).
- Varredura antivírus de uploads (ClamAV) se abrir upload para alunos.
