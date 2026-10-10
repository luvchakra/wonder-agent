#!/bin/bash
# The nightly Playwright suite, run inside a Vercel build of the
# `e2e/nightly` branch (scripts/vercel-build.sh).
#
# Why on Vercel: the suite needs the project's Supabase service role key,
# encryption key and cron secret. They are Sensitive variables in Vercel,
# which never leave Vercel, so the suite runs where they are already
# provided (user decision 2026-10-10). Nothing is copied to GitHub.
#
# Steps: install Chromium's system libraries (Amazon Linux 2023, dnf) and
# Playwright's headless Chromium, build the app, start it on
# localhost:3100 (private-network stubs allowed, as in playwright.config.ts's
# webServer; this process only, never the deployed app), run the suite, and
# fail the build if anything failed.
#
# Specs: the commit message may carry one line `specs: <files>` (from the
# workflow's manual run); only paths under tests/e2e/ ending in .spec.ts are
# accepted, anything else is ignored.
set -uo pipefail

log() { echo "[e2e] $*"; }
SUDO=""
[ "$(id -u)" = "0" ] || SUDO="sudo"

log "Installing Chromium's system libraries"
$SUDO dnf install -y -q \
  alsa-lib atk at-spi2-atk at-spi2-core dbus-libs glib2 libX11 libXcomposite \
  libXdamage libXext libXfixes libXrandr libxcb libxkbcommon mesa-libgbm nspr nss nss-util \
  >/dev/null || { log "dnf install failed"; exit 1; }

log "Installing Playwright's headless Chromium"
npx playwright install --only-shell chromium >/dev/null || { log "playwright install failed"; exit 1; }
SHELL_BIN=$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1)
missing=$(ldd "$SHELL_BIN" 2>/dev/null | grep "not found" || true)
if [ -n "$missing" ]; then
  log "Chromium is missing system libraries:"
  echo "$missing"
  exit 1
fi

log "Building the app"
npm run build || { log "next build failed"; exit 1; }

SPECS=""
specs_line=$(printf '%s\n' "${VERCEL_GIT_COMMIT_MESSAGE:-}" | grep -m1 '^specs:' | cut -d: -f2- || true)
for s in $specs_line; do
  if [[ "$s" =~ ^tests/e2e/[A-Za-z0-9._/-]+\.spec\.ts$ ]] && [ -f "$s" ]; then SPECS="$SPECS $s"; fi
done
log "Running: ${SPECS:-the full suite}"

PORT=3100
OUTBOUND_ALLOW_PRIVATE_NETWORKS=true BASE_APP_HOST=localhost npx next start -p "$PORT" >/tmp/e2e-server.log 2>&1 &
server=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

# Vercel stops a build at 45 minutes; the suite gets 38 of them.
E2E_BASE_URL="http://localhost:$PORT" timeout 2280 npx playwright test $SPECS --reporter=line
status=$?
kill "$server" 2>/dev/null

if [ "$status" = "124" ]; then
  log "The suite did not finish within 38 minutes"
elif [ "$status" != "0" ]; then
  log "The suite failed (exit $status); the last server log lines:"
  tail -40 /tmp/e2e-server.log
fi
[ "$status" = "0" ] && log "The suite passed"
exit "$status"
