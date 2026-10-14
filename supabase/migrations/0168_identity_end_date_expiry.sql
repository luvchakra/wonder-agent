-- IDENTITY-P0-18 (finish): expiry. A person whose end date has passed becomes
-- a leaver through a daily sweep; the event records that a schedule, not a
-- person or a source, started it.
--
-- Widens identity_lifecycle_events.origin with 'schedule' (additive: every
-- existing value stays valid), and indexes the sweep's query.

alter table identity_lifecycle_events drop constraint identity_lifecycle_events_origin_check;
alter table identity_lifecycle_events add constraint identity_lifecycle_events_origin_check check (origin in ('manual', 'source', 'schedule'));

create index identities_end_date_active_idx on identities (end_date) where lifecycle_state = 'ACTIVE' and end_date is not null;
