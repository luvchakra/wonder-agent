# WonderAgent

Vendor-neutral AI Identity Governance & Runtime Assurance SaaS platform. Govern
every AI agent. Verify every action.

See [`CLAUDE.md`](CLAUDE.md) for the root engineering contract (architecture
non-negotiables, locked stack, module ownership), [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md)
for the multi-agent workflow, and [`docs/plan/`](docs/plan/) for each module's
backlog.

## Local setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in real values — get them
   from the Supabase project dashboard (Settings → API). **Never commit
   `.env.local`** (it's gitignored); for deployment, set the same variables as
   encrypted environment variables in Vercel's project settings instead.
3. `npm run dev`

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — Vitest (unit tests; see `tests/foundation/tenant-isolation.sql`
  for the RLS/tenant-isolation proof, which runs via the Supabase MCP
  `execute_sql` tool against a dev project rather than through Vitest, since it
  exercises real PostgreSQL RLS policies)

## Database

Supabase PostgreSQL only — see `CLAUDE.md` §16. Migrations live in
`supabase/migrations/`, applied in order; each is owned by the module named in
its filename prefix (see `docs/design/ownership-map.md`).
