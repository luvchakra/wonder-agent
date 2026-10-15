-- Compliance Agent — COMPLIANCE-P0-10 part 4: owner reviews of
-- applications. A campaign of scope 'application_contents' has one item
-- per active, certifiable entitlement of an active application, reviewed by
-- the entitlement's owner, else the application's business owner, else the
-- named reviewer. Certify keeps the entitlement; revoke disables it through
-- Access's entitlement service (nobody's current access changes; an access
-- review decides that).
--
-- Additive: the scope lists gain 'application_contents';
-- certification_items gains entitlement_id, with no foreign key (as
-- package_resource_id, 0193): an item stays evidence of what was reviewed
-- even after a never-granted entitlement is deleted, and the snapshot keeps
-- the names. The service writes only entitlements of the campaign's tenant.

alter table certification_campaigns drop constraint certification_campaigns_scope_type_check;
alter table certification_campaigns add constraint certification_campaigns_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments', 'package_contents', 'application_contents'));

alter table certification_campaign_templates drop constraint certification_campaign_templates_scope_type_check;
alter table certification_campaign_templates add constraint certification_campaign_templates_scope_type_check
  check (scope_type in ('agent', 'application', 'entitlement', 'privileged_access', 'high_risk_agent', 'identity_access', 'role_assignments', 'package_contents', 'application_contents'));

alter table certification_items add column entitlement_id uuid;

create index certification_items_entitlement_id_idx on certification_items (entitlement_id) where entitlement_id is not null;

-- An item is about one agent or one identity (0180); a package review item
-- about a package resource (0193); an application review item about one
-- entitlement of the catalog, and neither agent nor identity.
alter table certification_items drop constraint certification_items_subject_check;
alter table certification_items add constraint certification_items_subject_check check (
  case when package_resource_id is not null or entitlement_id is not null then agent_id is null and identity_id is null
       else (agent_id is null) <> (identity_id is null) end
);
