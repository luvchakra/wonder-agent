-- Access Agent — ACCESS-P0-02.2 follow-up (resolved 2026-09-16 via
-- AskUserQuestion): Risk's "External communication capability" scoring
-- factor needed a real, owned data source instead of a permanently-0
-- placeholder. Modeled as an application-level attribute: an admin marks
-- an application as external-facing (email/messaging/public API/etc.)
-- when registering or editing it; Risk's factor then triggers when an
-- agent's CAN/DID touches an application marked external.
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

alter table applications add column is_external boolean not null default false;
