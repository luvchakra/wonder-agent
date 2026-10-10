#!/bin/bash
# Vercel build command (vercel.json buildCommand).
#
# - Every deployment builds the app exactly as before (`npm run build`).
# - The `e2e/nightly-1` and `e2e/nightly-2` branches (one half of the suite
#   each) and `e2e/nightly` (chosen specs) instead run Playwright inside the
#   build, where Vercel provides the project's environment variables,
#   Sensitive ones included (scripts/e2e-on-vercel.sh). A failing test fails
#   the build. Only .github/workflows/e2e.yml moves these branches.
set -euo pipefail

case "${VERCEL_GIT_COMMIT_REF:-}" in
  e2e/nightly|e2e/nightly-1|e2e/nightly-2) exec bash scripts/e2e-on-vercel.sh ;;
esac

exec npm run build
