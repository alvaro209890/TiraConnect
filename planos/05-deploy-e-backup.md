# 05 — Deploy e backup

## Onde está

| Item | Local |
|---|---|
| Código (produção) | `/media/server/HD Backup/Servidores_NAO_MEXA/TiraConnect` |
| Código (dev, Windows) | `C:\GIS\TiraConnect` |
| Repositório | https://github.com/alvaro209890/TiraConnect (público — nunca commitar `.env`) |
| Banco | `<app>/data/tiraconnect.db` |
| Uploads | `<app>/uploads/` |
| Backups | `/media/server/HD Backup/Backups/TiraConnect/` (14 dias) |
| Porta | `127.0.0.1:3120` |
| Units (`--user`) | `tiraconnect`, `tiraconnect-cloudflared`, `tiraconnect-backup.timer` |
| Túnel | `~/.cloudflared/tiraconnect.yml` → `tiraconnect` e `tiraconnect-admin` `.cursar.space` |

## Instalar / atualizar / backup

Ver o [README](../README.md) — comandos prontos para cada caso.

## Estratégia de backup

1. **Diário automático** (03:20): banco (snapshot consistente), uploads, `.env` → `.tar.gz` `chmod 600`.
2. **Antes de atualizar**: `bash scripts/backup.sh` manual.
3. **Retenção**: 14 dias (`BACKUP_KEEP_DAYS`).
4. **Cópia externa (próximo passo)**: incluir a pasta de backups no `backup-banco-drive.sh` que já roda no server, ou no rclone para o Drive — hoje os backups ficam no mesmo HD do app (protege de erro humano/corrupção, não de falha do disco).
5. **Teste de restauração** mensal com `scripts/restore.sh` numa cópia.
