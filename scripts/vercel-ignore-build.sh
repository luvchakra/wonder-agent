#!/bin/bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
# Exit 0 skips the deployment, exit 1 builds it.
#
# - Only production deploys, plus the nightly E2E branch: preview builds stay
#   off, as the project was already configured (the owner tests on production).
# - A production deploy is skipped when nothing the app is built from changed
#   since the last deployment: docs, tests, CI, Supabase migrations (applied
#   separately) and maintenance scripts never change what Vercel serves.
# - Any doubt (no previous deployment, its commit not in the shallow clone)
#   builds. Skipping is only an optimisation; building is always safe.

# The nightly Playwright run builds its own branch (scripts/e2e-on-vercel.sh).
# Only in this project (wonder-id): another Vercel project connected to the
# same repository has none of the suite's variables and must skip them.
case "$VERCEL_GIT_COMMIT_REF" in
  e2e/nightly|e2e/nightly-1|e2e/nightly-2)
    if [ "${VERCEL_PROJECT_ID:-}" = "prj_lHTAkZq0hRDN8mWqHm5AW9GCxtD8" ] \
      || { [ -z "${VERCEL_PROJECT_ID:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; }; then
      echo "Nightly E2E run; building."
      exit 1
    fi
    echo "Nightly E2E branch, but not the wonder-id project; skipping."
    exit 0
    ;;
esac

if [ "$VERCEL_ENV" != "production" ]; then
  echo "Preview deployments are off; skipping."
  exit 0
fi

prev="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$prev" ] || ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  echo "No previous deployment to compare with; building."
  exit 1
fi

if git diff --quiet "$prev" HEAD -- . \
  ':(exclude)docs' ':(exclude)tests' ':(exclude)*.md' ':(exclude).github' \
  ':(exclude)supabase' ':(exclude)scripts' ':(exclude).claude' \
  ':(exclude)playwright.config.ts' ':(exclude)vitest.config.ts' ':(exclude)vitest.setup.ts' \
  ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx'; then
  echo "Only docs, tests, CI, migrations or scripts changed since ${prev:0:7}; skipping."
  exit 0
fi

echo "App code changed since ${prev:0:7}; building."
exit 1
