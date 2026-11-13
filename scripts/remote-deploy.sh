#!/usr/bin/env bash
set -eo pipefail

export PATH="$HOME/nodevenv/giulia-beauty-studio/22/bin:/usr/local/cpanel/3rdparty/lib/path-bin:/usr/sbin:$PATH"

APP_DIR="$HOME/giulia-beauty-studio"
cd "$APP_DIR"

deps_hash() {
  sha256sum package.json package-lock.json 2>/dev/null || sha256sum package.json 2>/dev/null || echo ""
}

PREV_DEPS="$(deps_hash)"
git fetch origin main
git reset --hard origin/main
NEW_DEPS="$(deps_hash)"

if [ "$PREV_DEPS" != "$NEW_DEPS" ] || [ ! -d "$HOME/nodevenv/giulia-beauty-studio/22/lib/node_modules" ]; then
  cloudlinux-selector install-modules --json --interpreter=nodejs --app-root=giulia-beauty-studio
fi

source "$HOME/nodevenv/giulia-beauty-studio/22/bin/activate"
npm run init-db

cloudlinux-selector restart --json --interpreter=nodejs --app-root=giulia-beauty-studio
echo "DEPLOY_OK"
