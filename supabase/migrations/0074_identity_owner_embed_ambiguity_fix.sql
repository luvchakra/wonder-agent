-- IDENTITY-P0-13 follow-up, applied minutes after 0073 (2026-09-25).
--
-- 0073 added agent_owners.delegated_by and last_reviewed_by as foreign keys
-- to users. agent_owners then had three relationships to users, and
-- PostgREST refuses an unqualified embed such as
-- listOwnersForTenant()'s `users(display_name, email)` when more than one
-- relationship exists. So the owner listing behind the Agents page and
-- search failed for the code already deployed.
--
-- Fix: drop the two new constraints and keep the columns. They record who
-- delegated or reviewed, set only by the service from the authenticated
-- actor (never from client input), and the audit trail holds the same
-- facts. The application code also now qualifies the embed
-- (`users!agent_owners_user_id_fkey`), so re-adding such a key later cannot
-- break it again.

alter table agent_owners drop constraint agent_owners_delegated_by_fkey;
alter table agent_owners drop constraint agent_owners_last_reviewed_by_fkey;
