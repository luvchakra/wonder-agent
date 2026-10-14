-- Compliance Agent — COMPLIANCE-P0-11: access reviews of WonderID's own
-- role assignments. A campaign of scope 'role_assignments' has one item
-- per role a member holds in this organization, directly or through a
-- group (privileged roles only, or all). Each item is about the member's
-- person identity and names the role, where it comes from and, for a
-- group, which group. A revoke removes the assignment through
-- Foundation's role service (a direct role) or the member from the group
-- (a group's role).
--
-- Additive: the scope list gains 'role_assignments'; certification_items
-- gains role_id, role_source and group_id. An item stays evidence after
-- the role or group is deleted (set null; the snapshot keeps the names).

alter table certification_campaigns drop constraint certification_campaigns_scope_type_check;
alter table certification_campaigns add constraint certification_campaigns_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments'));

alter table certification_items
  add column role_id uuid references roles(id) on delete set null,
  add column role_source text check (role_source in ('direct', 'group')),
  add column group_id uuid;
alter table certification_items
  add constraint certification_items_group_same_tenant foreign key (group_id, tenant_id) references groups (id, tenant_id) on delete set null (group_id);

create index certification_items_role_id_idx on certification_items (role_id) where role_id is not null;
create index certification_items_group_id_idx on certification_items (group_id) where group_id is not null;
