#!/usr/bin/env bash
# Backup do TiraConnect: snapshot consistente do SQLite + uploads + .env, num .tar.gz datado.
# Uso: bash scripts/backup.sh   (rodado diariamente pelo tiraconnect-backup.timer)
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; [ -f .env ] && . ./.env; set +a
DATA_DIR="${DATA_DIR:-./data}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$BACKUP_DIR" "$TMP/tiraconnect"

# VACUUM INTO gera cópia consistente mesmo com o serviço rodando (WAL)
node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1]);
  db.exec(`VACUUM INTO ${JSON.stringify(process.argv[2]).replace(/"/g, "\x27")}`);
' "$DATA_DIR/tiraconnect.db" "$TMP/tiraconnect/tiraconnect.db"

[ -d "$UPLOAD_DIR" ] && cp -a "$UPLOAD_DIR" "$TMP/tiraconnect/uploads"
[ -f .env ] && cp .env "$TMP/tiraconnect/env"
git rev-parse HEAD > "$TMP/tiraconnect/VERSION" 2>/dev/null || true

OUT="$BACKUP_DIR/tiraconnect-$STAMP.tar.gz"
tar -czf "$OUT" -C "$TMP" tiraconnect
chmod 600 "$OUT"
find "$BACKUP_DIR" -name 'tiraconnect-*.tar.gz' -mtime "+$KEEP" -delete
echo "[backup] $OUT ($(du -h "$OUT" | cut -f1))"
