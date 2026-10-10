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
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  log "This project does not provide the suite's variables; nothing to run."
  exit 1
fi
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
# A Preview build adds the Vercel Toolbar's script to every page; the app's
# CSP rightly blocks it, and the suite fails on that console error. Production
# builds never carry it, so it is switched off for this build only.
export VERCEL_PREVIEW_FEEDBACK_ENABLED=0
npm run build || { log "next build failed"; exit 1; }

SPECS=""
specs_line=$(printf '%s\n' "${VERCEL_GIT_COMMIT_MESSAGE:-}" | grep -m1 '^specs:' | cut -d: -f2- || true)
for s in $specs_line; do
  if [[ "$s" =~ ^tests/e2e/[A-Za-z0-9._/-]+\.spec\.ts$ ]] && [ -f "$s" ]; then SPECS="$SPECS $s"; fi
done
# The full suite is split in two: e2e/nightly-1 and e2e/nightly-2 each run
# one half (about 20 minutes on a Vercel build machine). A run of chosen
# specs uses e2e/nightly and is not split.
SHARD=""
case "${VERCEL_GIT_COMMIT_REF:-}" in
  e2e/nightly-1) SHARD="--shard=1/2" ;;
  e2e/nightly-2) SHARD="--shard=2/2" ;;
esac
[ -n "$SPECS" ] && SHARD=""
log "Running: ${SPECS:-the full suite} ${SHARD} on $(nproc) cores"

PORT=3100
OUTBOUND_ALLOW_PRIVATE_NETWORKS=true BASE_APP_HOST=localhost npx next start -p "$PORT" >/tmp/e2e-server.log 2>&1 &
server=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

# Vercel stops a build at 45 minutes; the suite gets 35 of them. On time-out
# Playwright is interrupted (SIGINT), so it still writes its report.
REPORT=/tmp/e2e-report.json
E2E_BASE_URL="http://localhost:$PORT" E2E_SLOW_MACHINE=1 \
  PLAYWRIGHT_JSON_OUTPUT_FILE="$REPORT" PLAYWRIGHT_JSON_OUTPUT_NAME="$REPORT" \
  timeout -s INT -k 60 2100 npx playwright test $SPECS $SHARD --reporter=line,json
status=$?
kill "$server" 2>/dev/null

# One compact summary at the end of the log: counts, then each failed test
# with the first line of its error.
node -e '
  const fs = require("fs");
  let r; try { r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { console.log("[e2e] No Playwright report was written."); process.exit(0); }
  const s = r.stats || {};
  console.log(`[e2e] Summary: ${s.expected ?? 0} passed, ${s.unexpected ?? 0} failed, ${s.flaky ?? 0} flaky, ${s.skipped ?? 0} skipped, ${Math.round((s.duration ?? 0) / 60000)} min`);
  const walk = (suite, path) => {
    for (const sp of suite.specs || []) for (const t of sp.tests || []) {
      if (t.status !== "unexpected") continue;
      const err = (t.results || []).map((x) => x.error && x.error.message).find(Boolean) || "";
      const lines = err.replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
      console.log(`[e2e] FAILED ${sp.file}:${sp.line} ${[...path, sp.title].join(" › ")}`);
      for (const l of lines) console.log(`[e2e]     ${l.slice(0, 300)}`);
    }
    for (const c of suite.suites || []) walk(c, [...path, c.title]);
  };
  for (const s2 of r.suites || []) walk(s2, []);
' "$REPORT"

if [ "$status" = "124" ]; then
  log "The suite did not finish within 35 minutes"
elif [ "$status" != "0" ]; then
  log "The suite failed (exit $status); the last server log lines:"
  tail -40 /tmp/e2e-server.log
fi
[ "$status" = "0" ] && log "The suite passed"
exit "$status"
