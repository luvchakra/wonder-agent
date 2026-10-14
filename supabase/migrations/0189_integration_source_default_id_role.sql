-- Integration Agent — owner decision 2026-10-14 (test feedback item 8):
-- an identity source (the HR import) can name a default ID role. Each new
-- person it creates, with an e-mail, is invited to WonderID with that role.
--
-- Additive: two nullable columns; null keeps today's behaviour (no one is
-- invited). The service accepts only an assignable role other than the
-- organization administrator's, and only from someone who holds every
-- permission the role carries; `default_id_role_set_by` is who set it, and
-- the invitations are sent on their authority (re-checked on every run).

alter table identity_sources
  add column default_id_role text check (default_id_role is null or char_length(default_id_role) between 1 and 100),
  add column default_id_role_set_by uuid;
