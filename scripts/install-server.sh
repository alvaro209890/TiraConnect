#!/usr/bin/env bash
# Instalação/atualização no server-desktop (systemd --user). Idempotente.
# Uso (no server):  bash scripts/install-server.sh
set -euo pipefail
APP="/media/server/HD Backup/Servidores_NAO_MEXA/TiraConnect"
cd "$APP"

[ -f .env ] || { cp .env.example .env; echo "[install] .env criado a partir do exemplo — revise!"; }
npm ci --omit=dev --no-audit --no-fund

mkdir -p ~/.config/systemd/user
cp deploy/tiraconnect.service deploy/tiraconnect-cloudflared.service \
   deploy/tiraconnect-backup.service deploy/tiraconnect-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tiraconnect.service tiraconnect-backup.timer
systemctl --user restart tiraconnect.service

if [ -f ~/.cloudflared/tiraconnect.yml ]; then
  systemctl --user enable --now tiraconnect-cloudflared.service
else
  echo "[install] túnel ainda não configurado — ver README (seção Domínio)"
fi
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3120/api/health 2>/dev/null && { echo " <- ok"; exit 0; }; sleep 1; done
echo "[install] serviço não respondeu — veja: journalctl --user -u tiraconnect -n 50"; exit 1
