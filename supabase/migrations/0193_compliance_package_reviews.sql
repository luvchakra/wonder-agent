-- Compliance Agent — COMPLIANCE-P0-10 part 3: owner reviews of access
-- packages. A campaign of scope 'package_contents' has one item per
-- application or entitlement an access package contains, reviewed by the
-- package's owner (or the named reviewer). Certify keeps it in the
-- package; revoke removes it through Access's package service.
--
-- Additive: the scope lists gain 'package_contents'; certification_items
-- gains package_id and package_resource_id. An item stays evidence after
-- the package is deleted (set null; the snapshot keeps the names). The
-- resource id has no foreign key: a revoke deletes that resource row, and
-- the item keeps the id as evidence of what was removed.

alter table certification_campaigns drop constraint certification_campaigns_scope_type_check;
alter table certification_campaigns add constraint certification_campaigns_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments', 'package_contents'));

alter table certification_campaign_templates drop constraint certification_campaign_templates_scope_type_check;
alter table certification_campaign_templates add constraint certification_campaign_templates_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments', 'package_contents'));

alter table certification_items
  add column package_id uuid,
  add column package_resource_id uuid;
alter table certification_items
  add constraint certification_items_package_same_tenant foreign key (package_id, tenant_id) references access_packages (id, tenant_id) on delete set null (package_id);

create index certification_items_package_id_idx on certification_items (package_id) where package_id is not null;

-- An item is about exactly one agent or one identity (0180), or, for a
-- package review, about a package resource and neither of them.
alter table certification_items drop constraint certification_items_subject_check;
alter table certification_items add constraint certification_items_subject_check check (
  case when package_resource_id is not null then agent_id is null and identity_id is null
       else (agent_id is null) <> (identity_id is null) end
);
