-- IDENTITY-P0-13 (2026-09-25) — same-tenant references to agents.
--
-- agent_owners, agent_identities and agent_relationships referenced
-- agents(id) alone, and their RLS insert checks only look at the row's own
-- tenant_id. So a member of tenant B could insert a row in tenant B that
-- points at tenant A's agent (non-negotiable #4), and the unique key on
-- agent_owners (agent_id, owner_type, user_id) would then also answer
-- "does this agent id exist?" across tenants. No such rows exist (checked
-- before applying).
--
-- Each single-column FK is replaced by a composite (agent_id, tenant_id)
-- FK to agents(id, tenant_id), keeping the SAME constraint name. That
-- matters: PostgREST embeds and `table!constraint_name` hints resolve by
-- relationship, and 0073 showed that adding a second FK to the same table
-- makes an unqualified embed ambiguous. Replacing, not adding, keeps
-- exactly one relationship per column pair and every existing hint valid.
-- ON DELETE CASCADE is unchanged.

alter table agents add constraint agents_id_tenant_key unique (id, tenant_id);

alter table agent_owners drop constraint agent_owners_agent_id_fkey;
alter table agent_owners add constraint agent_owners_agent_id_fkey
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;

alter table agent_identities drop constraint agent_identities_agent_id_fkey;
alter table agent_identities add constraint agent_identities_agent_id_fkey
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;

alter table agent_relationships drop constraint agent_relationships_agent_id_fkey;
alter table agent_relationships add constraint agent_relationships_agent_id_fkey
  foreign key (agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;

alter table agent_relationships drop constraint agent_relationships_related_agent_id_fkey;
alter table agent_relationships add constraint agent_relationships_related_agent_id_fkey
  foreign key (related_agent_id, tenant_id) references agents (id, tenant_id) on delete cascade;
