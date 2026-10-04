#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh.
# Uso: bash scripts/restore.sh backups/tiraconnect-AAAAMMDD-HHMMSS.tar.gz
# ⚠️ Pare o serviço antes:  systemctl --user stop tiraconnect
set -euo pipefail
cd "$(dirname "$0")/.."
ARCHIVE="${1:?informe o arquivo .tar.gz}"

set -a; [ -f .env ] && . ./.env; set +a
DATA_DIR="${DATA_DIR:-./data}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"

SAFE="$DATA_DIR/pre-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SAFE"
mv "$DATA_DIR"/tiraconnect.db* "$SAFE"/ 2>/dev/null || true
cp "$TMP/tiraconnect/tiraconnect.db" "$DATA_DIR/tiraconnect.db"
if [ -d "$TMP/tiraconnect/uploads" ]; then
  mkdir -p "$UPLOAD_DIR"
  cp -a "$TMP/tiraconnect/uploads/." "$UPLOAD_DIR/"
fi
echo "[restore] banco restaurado (o anterior ficou em $SAFE). O .env do backup está em $TMP/tiraconnect/env se precisar."
echo "Agora: systemctl --user start tiraconnect"
