-- Access Agent — owner test feedback (2026-10-14): more attributes on an
-- entitlement and on an entitlement type (after how Saviynt models them),
-- and a status so either can be disabled rather than deleted.
--
-- Additive. Defaults keep today's behaviour: every existing entitlement and
-- type is active and certifiable; the new text fields are empty.
--
-- entitlements:
-- - display_name, description: what people see in requests and reviews;
-- - risk_level: low / medium / high / critical (Saviynt's entitlement risk);
-- - certifiable: false keeps it out of access reviews;
-- - status: 'inactive' hides it from requests (disabled, not deleted).
-- application_entitlement_types:
-- - display_name, description, status ('inactive': no new entitlements of
--   this type, and its entitlements are not requestable).

alter table entitlements
  add column display_name text check (display_name is null or char_length(display_name) between 1 and 200),
  add column description text check (description is null or char_length(description) between 1 and 2000),
  add column risk_level text check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  add column certifiable boolean not null default true,
  add column status text not null default 'active' check (status in ('active', 'inactive'));

alter table application_entitlement_types
  add column display_name text check (display_name is null or char_length(display_name) between 1 and 200),
  add column description text check (description is null or char_length(description) between 1 and 2000),
  add column status text not null default 'active' check (status in ('active', 'inactive'));
