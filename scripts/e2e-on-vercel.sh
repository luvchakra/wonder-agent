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
# builds never carry it, so it is switched off for this build only. Vercel's
# Next.js build adapter (@vercel/next, `modifyConfig`) injects it when
# VERCEL_PREVIEW_COMMENTS_ENABLED is 1; the older builder read
# VERCEL_PREVIEW_FEEDBACK_ENABLED. Both are switched off.
export VERCEL_PREVIEW_FEEDBACK_ENABLED=0
export VERCEL_PREVIEW_COMMENTS_ENABLED=0
npm run build || { log "next build failed"; exit 1; }

SPECS=""
specs_line=$(printf '%s\n' "${VERCEL_GIT_COMMIT_MESSAGE:-}" | grep -m1 '^specs:' | cut -d: -f2- || true)
for s in $specs_line; do
  if [[ "$s" =~ ^tests/e2e/[A-Za-z0-9._/-]+\.spec\.ts$ ]] && [ -f "$s" ]; then SPECS="$SPECS $s"; fi
done
# The full suite is split in four: e2e/nightly-1 to -4 each run a quarter
# of the spec files (owner decision, 15 Oct 2026: first three parts, as two
# halves came to about 30 minutes each against a 35-minute budget; then
# four, so each part keeps a margin as the suite grows). A run of chosen specs uses e2e/nightly and is not
# split. Playwright's --shard split by test order, which put every slow spec
# (they sort early) in half 1: on 15 Oct half 1 hit the 35-minute budget
# with 65 tests unrun while half 2 finished in about 20. So the slow specs
# take turns between the parts first, then every other spec file does.
HALF=""
case "${VERCEL_GIT_COMMIT_REF:-}" in
  e2e/nightly-1) HALF=1 ;;
  e2e/nightly-2) HALF=2 ;;
  e2e/nightly-3) HALF=3 ;;
  e2e/nightly-4) HALF=4 ;;
esac
if [ -z "$SPECS" ] && [ -n "$HALF" ]; then
  # The slowest spec (connector-provisioning, about 12 minutes there) has
  # part 1 to itself among the slow ones; the other slow specs take turns
  # between parts 2, 3 and 4. On 15 Oct a plain round robin gave part 1 three
  # slow specs: 35 minutes and cut off, against 22 and 24 for the others.
  SLOW="connector-provisioning f1-reconciliation design-review bulk-invitations access-packages account-inventory automation-credentials"
  slow=""
  j=0
  for n in $SLOW; do
    f="tests/e2e/$n.spec.ts"
    [ -f "$f" ] || continue
    slow="$slow $f"
    if [ $j = 0 ]; then part=1; else part=$(( (j - 1) % 3 + 2 )); fi
    [ "$part" = "$HALF" ] && SPECS="$SPECS $f"
    j=$((j + 1))
  done
  i=0
  for f in $(ls tests/e2e/*.spec.ts | sort); do
    case " $slow " in *" $f "*) continue ;; esac
    [ $((i % 4 + 1)) = "$HALF" ] && SPECS="$SPECS $f"
    i=$((i + 1))
  done
fi

# Screenshot baselines for this machine are `*-vercel.png` (playwright.config.ts).
export E2E_SNAPSHOT_ENV=vercel
# Recording mode (the workflow's "record baselines" input, a line
# `record-baselines: yes` in the commit message, with chosen specs only):
# missing baselines for this machine are written instead of failing, and
# published with this preview deployment under /brand/__e2e-baselines/ (a
# path the sign-in proxy serves without a session; it exists only in this
# build, never in the repository) so they can be reviewed and committed.
# Existing baselines are never overwritten.
RECORD=""
if [ -n "$SPECS" ] && printf '%s\n' "${VERCEL_GIT_COMMIT_MESSAGE:-}" | grep -qx 'record-baselines: yes'; then
  RECORD="--update-snapshots=missing"
fi
log "Running: ${HALF:+part $HALF of 4: }${SPECS:-the full suite} ${RECORD:+(recording missing baselines)} on $(nproc) cores"

PORT=3100
# The local server runs without VERCEL: the build sets VERCEL=1, and with it
# trustedClientIp() believes x-vercel-forwarded-for, which only Vercel's edge
# may set. Locally that header comes straight from the test, so WID-H08's
# spoofing test failed here and nowhere else.
env -u VERCEL OUTBOUND_ALLOW_PRIVATE_NETWORKS=true BASE_APP_HOST=localhost npx next start -p "$PORT" >/tmp/e2e-server.log 2>&1 &
server=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

# Vercel stops a build at 45 minutes; the suite gets 35 of them. On time-out
# Playwright is interrupted (SIGINT), so it still writes its report.
REPORT=/tmp/e2e-report.json
touch "$REPORT.start"
# WID-H08: automation-credentials.spec.ts also calls production through Vercel's
# edge with spoofed address headers, to prove the edge sets the address.
E2E_INGRESS_URL="${E2E_INGRESS_URL:-https://id.wonderapps.biz}" \
  E2E_BASE_URL="http://localhost:$PORT" E2E_SLOW_MACHINE=1 \
  PLAYWRIGHT_JSON_OUTPUT_FILE="$REPORT" PLAYWRIGHT_JSON_OUTPUT_NAME="$REPORT" \
  timeout -s INT -k 60 2100 npx playwright test $SPECS $RECORD --reporter=line,json
status=$?
kill "$server" 2>/dev/null

if [ -n "$RECORD" ]; then
  # Playwright fails a test whose baseline it had to write, so a recording
  # run is judged by what it recorded. The new baselines are copied into
  # public/ and the app built again so this deployment serves them; the
  # build then succeeds so the deployment exists. Nothing is committed here:
  # the owner of the run reviews the files and commits them.
  mkdir -p public/brand/__e2e-baselines
  found=0
  while IFS= read -r f; do
    cp "$f" "public/brand/__e2e-baselines/$(basename "$f")" && found=$((found + 1))
    log "Recorded baseline: $f ($(wc -c <"$f") bytes)"
  done < <(find tests/e2e -path '*-snapshots/*-vercel.png' -newer "$REPORT.start" 2>/dev/null)
  if [ "$found" = "0" ]; then
    log "Recording run: no baseline was missing, nothing recorded"
    exit "$status"
  fi
  log "Recording run: $found baseline(s) published at /brand/__e2e-baselines/ (review the summary above before committing them)"
  npm run build >/dev/null || { log "Rebuild with the baselines failed"; exit 1; }
  exit 0
fi

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
