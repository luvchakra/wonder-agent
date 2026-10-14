-- ACCESS-P0-23 part 3 (owner decision 2026-10-14): administration
-- delegation. While a member is away, their directly assigned roles are
-- given to a delegate as time-bound copies in user_roles (Foundation's
-- ordinary assignments, so the authorization engine treats them as any
-- other). Each copy names its delegation, so ending the delegation early
-- removes exactly its copies; at the end date the copies expire by
-- themselves. Tenant Administrator is never copied (always permanent, 0100).
--
-- Additive: the scope list gains 'administration'; user_roles gains a
-- nullable delegation_id.

alter table access_delegations drop constraint access_delegations_scope_check;
alter table access_delegations add constraint access_delegations_scope_check check (scope in ('approvals', 'requests', 'administration'));

alter table user_roles
  add column delegation_id uuid references access_delegations(id) on delete cascade;

create index user_roles_delegation_idx on user_roles (delegation_id) where delegation_id is not null;
