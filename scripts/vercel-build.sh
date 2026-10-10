#!/bin/bash
# Vercel build command (vercel.json buildCommand).
#
# - Every deployment builds the app exactly as before (`npm run build`).
# - The `e2e/nightly` branch additionally runs the full Playwright suite
#   inside the build, where Vercel provides the project's environment
#   variables, Sensitive ones included (scripts/e2e-on-vercel.sh). A failing
#   test fails the build. The branch is moved each night by
#   .github/workflows/e2e.yml; nothing else builds it.
set -euo pipefail

if [ "${VERCEL_GIT_COMMIT_REF:-}" = "e2e/nightly" ]; then
  exec bash scripts/e2e-on-vercel.sh
fi

exec npm run build
