#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# GIULIA BEAUTY STUDIO — Automated MySQL Backup Script (cPanel / CloudLinux)
# Usage: bash scripts/server-backup.sh [daily|pre-deploy|manual|pre-restore]
# ============================================================================

TYPE="${1:-daily}"
case "$TYPE" in
  daily|pre-deploy|manual|pre-restore) ;;
  *)
    echo "[BACKUP ERROR] Tipo non valido: $TYPE (usa: daily, pre-deploy, manual, pre-restore)" >&2
    exit 1
    ;;
esac

APP_DIR="${APP_DIR:-$HOME/giulia-beauty-studio}"
ENV_FILE="$APP_DIR/.env"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups/mysql}"
TARGET_DIR="$BACKUP_ROOT/$TYPE"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
STATUS_FILE="$BACKUP_ROOT/last-status.json"

if [ ! -f "$ENV_FILE" ]; then
  echo "[BACKUP ERROR] File .env non trovato in $ENV_FILE" >&2
  exit 1
fi

read_env_var() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    echo ""
    return
  fi
  local val="${line#*=}"
  val="${val%$'\r'}"
  # Strip optional matching surrounding quotes
  if [[ "$val" == \"*\" && "$val" == *\" ]]; then
    val="${val:1:${#val}-2}"
  elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
    val="${val:1:${#val}-2}"
  fi
  printf '%s' "$val"
}

DB_HOST="$(read_env_var DB_HOST)"
DB_PORT="$(read_env_var DB_PORT)"
DB_USER="$(read_env_var DB_USER)"
DB_PASSWORD="$(read_env_var DB_PASS)"
if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD="$(read_env_var DB_PASSWORD)"
fi
DB_NAME="$(read_env_var DB_NAME)"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"

if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo "[BACKUP ERROR] DB_USER o DB_NAME mancanti in $ENV_FILE" >&2
  exit 1
fi

DUMP_BIN="$(command -v mariadb-dump || command -v mysqldump || true)"
if [ -z "$DUMP_BIN" ]; then
  echo "[BACKUP ERROR] mariadb-dump / mysqldump non trovato" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/pre-deploy" "$BACKUP_ROOT/manual" "$BACKUP_ROOT/pre-restore"
chmod 700 "$HOME/backups" "$BACKUP_ROOT" "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/pre-deploy" "$BACKUP_ROOT/manual" "$BACKUP_ROOT/pre-restore" 2>/dev/null || true

TMP_CNF="$(mktemp)"
chmod 600 "$TMP_CNF"
cleanup() {
  rm -f "$TMP_CNF"
}
trap cleanup EXIT

ESCAPED_PASS="${DB_PASSWORD//\\/\\\\}"
ESCAPED_PASS="${ESCAPED_PASS//\"/\\\"}"

{
  echo "[client]"
  printf 'host=%s\n' "$DB_HOST"
  printf 'port=%s\n' "$DB_PORT"
  printf 'user=%s\n' "$DB_USER"
  printf 'password="%s"\n' "$ESCAPED_PASS"
} > "$TMP_CNF"

STAMP="$(date -u +%Y-%m-%d_%H-%M-%S)"
OUT_FILE="$TARGET_DIR/${DB_NAME}_${TYPE}_${STAMP}.sql.gz"
TMP_OUT="${OUT_FILE}.tmp"

"$DUMP_BIN" \
  --defaults-extra-file="$TMP_CNF" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --hex-blob \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$TMP_OUT"

# Verify non-empty valid gzip archive
if [ ! -s "$TMP_OUT" ] || ! gzip -t "$TMP_OUT"; then
  rm -f "$TMP_OUT"
  echo "[BACKUP ERROR] Dump corrotto o vuoto!" >&2
  exit 1
fi

mv "$TMP_OUT" "$OUT_FILE"
chmod 600 "$OUT_FILE"

SHA256="$(sha256sum "$OUT_FILE" | awk '{print $1}')"
printf '%s  %s\n' "$SHA256" "$(basename "$OUT_FILE")" > "${OUT_FILE}.sha256"
chmod 600 "${OUT_FILE}.sha256"

# Weekly archival copy on Sundays for daily backups
if [ "$TYPE" = "daily" ] && [ "$(date -u +%u)" = "7" ]; then
  WEEKLY_COPY="$WEEKLY_DIR/$(basename "$OUT_FILE")"
  cp "$OUT_FILE" "$WEEKLY_COPY"
  cp "${OUT_FILE}.sha256" "${WEEKLY_COPY}.sha256"
  chmod 600 "$WEEKLY_COPY" "${WEEKLY_COPY}.sha256"
fi

# Retention policy: keep newest N archives in each bucket
prune_keep_latest() {
  local dir="$1"
  local keep="$2"
  if [ ! -d "$dir" ]; then return; fi
  local count=0
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    count=$((count + 1))
    if [ "$count" -gt "$keep" ]; then
      rm -f "$f" "${f}.sha256"
    fi
  done < <(ls -1t "$dir"/*.sql.gz 2>/dev/null || true)
}

prune_keep_latest "$BACKUP_ROOT/daily" 30
prune_keep_latest "$BACKUP_ROOT/weekly" 12
prune_keep_latest "$BACKUP_ROOT/pre-deploy" 15
prune_keep_latest "$BACKUP_ROOT/manual" 15
prune_keep_latest "$BACKUP_ROOT/pre-restore" 10

FILE_BYTES="$(stat -c%s "$OUT_FILE" 2>/dev/null || wc -c < "$OUT_FILE")"
DAILY_COUNT="$({ find "$BACKUP_ROOT/daily" -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null || true; } | wc -l | tr -d ' ')"
WEEKLY_COUNT="$({ find "$BACKUP_ROOT/weekly" -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null || true; } | wc -l | tr -d ' ')"
PREDEPLOY_COUNT="$({ find "$BACKUP_ROOT/pre-deploy" -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null || true; } | wc -l | tr -d ' ')"
TOTAL_COUNT=$((DAILY_COUNT + WEEKLY_COUNT + PREDEPLOY_COUNT))
ISO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$STATUS_FILE" <<EOF
{
  "ok": true,
  "last_backup_at": "$ISO_NOW",
  "last_type": "$TYPE",
  "last_file": "$(basename "$OUT_FILE")",
  "last_size_bytes": $FILE_BYTES,
  "last_sha256": "$SHA256",
  "counts": {
    "daily": $DAILY_COUNT,
    "weekly": $WEEKLY_COUNT,
    "pre_deploy": $PREDEPLOY_COUNT,
    "total": $TOTAL_COUNT
  }
}
EOF
chmod 600 "$STATUS_FILE"

echo "BACKUP_OK file=$OUT_FILE bytes=$FILE_BYTES sha256=$SHA256 total_kept=$TOTAL_COUNT"
