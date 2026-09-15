-- Identity Agent — IDENTITY-P0-07
-- Owner: Identity Agent. See docs/design/ownership-map.md before modifying.
--
-- Governance requirements reconciliation (2026-09-15): extends the existing
-- agent_contracts table (IDENTITY-P0-03.1, SHOULD's source of truth) with
-- the autonomy/oversight fields the doc's P0-03 names that the schema
-- didn't carry yet. User decision: "Identity + Access" for the autonomy
-- model — this migration is Identity's half (the contract fields); Access
-- Agent's ACCESS-P0-06 enforces them.
--
-- All new columns default to the most conservative value (lowest autonomy,
-- no implicit tool access, nothing pre-approved-without-review) rather than
-- silently unrestricted, so every pre-existing contract row stays
-- conservative until a human explicitly widens it via a new version.

alter table agent_contracts
  add column autonomy_level integer not null default 0
    check (autonomy_level between 0 and 4),
  add column allowed_tools text[] not null default '{}',
  add column actions_requiring_approval text[] not null default '{}',
  add column required_monitoring text,
  add column required_compliance_controls text[] not null default '{}';

comment on column agent_contracts.autonomy_level is
  '0=human performs action, 1=agent recommends, 2=agent acts with human approval, 3=agent acts autonomously within defined limits, 4=high autonomy with continuous controls';
