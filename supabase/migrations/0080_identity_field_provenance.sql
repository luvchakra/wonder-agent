-- IDENTITY-P0-15 extension for INTEGRATION-P0-09 (WonderID Phase 2,
-- 2026-09-26). Which identity source last set each field of an identity,
-- and at what precedence, so a lower-precedence source never overwrites a
-- field a higher-precedence (authoritative) source owns, and a person can
-- see where a value came from (spec H2, "higher-precedence sources win per
-- attribute").
--
-- Shape: { "<field>": { "sourceId": uuid, "priority": int, "at": timestamptz } }.
-- Written only by the Identity module's applySourcedIdentities(); a manual
-- edit leaves it alone, so the owning source's next import restores its
-- value (the source stays the system of record for what it owns, #7).
-- Additive; defaults to {} for every existing row.
alter table identities
  add column field_provenance jsonb not null default '{}'::jsonb
  check (jsonb_typeof(field_provenance) = 'object');
