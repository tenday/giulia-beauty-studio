#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# GIULIA BEAUTY STUDIO — Safe MySQL Restore Script
# Usage: bash scripts/server-restore.sh /home/giulusyu/backups/mysql/daily/<file>.sql.gz --confirm
# ============================================================================

DUMP_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"
APP_DIR="${APP_DIR:-$HOME/giulia-beauty-studio}"
ENV_FILE="$APP_DIR/.env"

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "[RESTORE ERROR] Specifica un file .sql.gz esistente." >&2
  echo "Uso: bash scripts/server-restore.sh <path-to-dump.sql.gz> --confirm" >&2
  exit 1
fi

if [ "$CONFIRM_FLAG" != "--confirm" ]; then
  echo "[RESTORE ABORTED] Per sicurezza aggiungi --confirm al comando." >&2
  exit 1
fi

if ! gzip -t "$DUMP_FILE"; then
  echo "[RESTORE ERROR] Archivio gzip corrotto: $DUMP_FILE" >&2
  exit 1
fi

if [ -f "${DUMP_FILE}.sha256" ]; then
  (cd "$(dirname "$DUMP_FILE")" && sha256sum -c "$(basename "${DUMP_FILE}.sha256")")
fi

# Always take a safety snapshot before overwriting production DB
if [ -f "$APP_DIR/scripts/server-backup.sh" ]; then
  echo "[RESTORE] Salvataggio di sicurezza pre-restore in corso..."
  bash "$APP_DIR/scripts/server-backup.sh" pre-restore
fi

read_env_var() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then echo ""; return; fi
  local val="${line#*=}"
  val="${val%$'\r'}"
  if [[ "$val" == \"*\" && "$val" == *\" ]]; then val="${val:1:${#val}-2}"
  elif [[ "$val" == \'*\' && "$val" == *\' ]]; then val="${val:1:${#val}-2}"; fi
  printf '%s' "$val"
}

DB_HOST="$(read_env_var DB_HOST)"
DB_PORT="$(read_env_var DB_PORT)"
DB_USER="$(read_env_var DB_USER)"
DB_PASSWORD="$(read_env_var DB_PASSWORD)"
DB_NAME="$(read_env_var DB_NAME)"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"

TMP_CNF="$(mktemp)"
chmod 600 "$TMP_CNF"
trap 'rm -f "$TMP_CNF"' EXIT
{
  echo "[client]"
  printf 'host=%s\n' "$DB_HOST"
  printf 'port=%s\n' "$DB_PORT"
  printf 'user=%s\n' "$DB_USER"
  printf 'password=%s\n' "$DB_PASSWORD"
} > "$TMP_CNF"

echo "[RESTORE] Importazione $DUMP_FILE nel database $DB_NAME..."
gunzip -c "$DUMP_FILE" | mysql --defaults-extra-file="$TMP_CNF" --default-character-set=utf8mb4 "$DB_NAME"

if command -v cloudlinux-selector >/dev/null 2>&1; then
  cloudlinux-selector restart --json --interpreter=nodejs --app-root=giulia-beauty-studio || true
fi

echo "RESTORE_OK file=$DUMP_FILE"
