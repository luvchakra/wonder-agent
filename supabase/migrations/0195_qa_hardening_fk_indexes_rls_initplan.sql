-- QA Agent — QA-P0-21 (security hardening pass), database part. Additive.
--
-- 1. RLS policies that called auth.uid() once per row now call it once per
--    query, `(select auth.uid())` (Supabase advisor auth_rls_initplan).
--    Each policy is recreated with the same command, roles and meaning;
--    only the evaluation changes.
-- 2. An index for every foreign key that had no index whose leading
--    columns are the key's columns (advisor unindexed_foreign_keys).
--    Generated from the catalog on 2026-10-15; `if not exists` keeps it
--    safe to re-run.

-- 1. auth.uid() once per query -------------------------------------------

drop policy notification_preferences_insert on notification_preferences;
create policy notification_preferences_insert on notification_preferences for insert
  with check (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));
drop policy notification_preferences_select on notification_preferences;
create policy notification_preferences_select on notification_preferences for select
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));
drop policy notification_preferences_update on notification_preferences;
create policy notification_preferences_update on notification_preferences for update
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));

drop policy notifications_select on notifications;
create policy notifications_select on notifications for select
  using (tenant_id in (select current_tenant_ids()) and (user_id is null or user_id = (select auth.uid())));
drop policy notifications_update on notifications;
create policy notifications_update on notifications for update
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()))
  with check (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));

drop policy privacy_consent_records_select on privacy_consent_records;
create policy privacy_consent_records_select on privacy_consent_records for select
  using ((tenant_id in (select current_tenant_ids()) and subject_user_id = (select auth.uid())) or has_tenant_permission(tenant_id, 'privacy.view'));
drop policy privacy_requests_select on privacy_requests;
create policy privacy_requests_select on privacy_requests for select
  using ((tenant_id in (select current_tenant_ids()) and subject_user_id = (select auth.uid())) or has_tenant_permission(tenant_id, 'privacy.view'));

-- 2. Foreign-key indexes -------------------------------------------------

create index if not exists access_fulfilment_tasks_access_grant_id_tenant_id_fk_idx on access_fulfilment_tasks (access_grant_id, tenant_id);
create index if not exists access_grants_entitlement_id_tenant_id_fk_idx on access_grants (entitlement_id, tenant_id);
create index if not exists access_package_resources_tenant_id_fk_idx on access_package_resources (tenant_id);
create index if not exists access_requests_agent_id_tenant_id_fk_idx on access_requests (agent_id, tenant_id);
create index if not exists access_requests_application_id_tenant_id_fk_idx on access_requests (application_id, tenant_id);
create index if not exists access_requests_entitlement_id_tenant_id_fk_idx on access_requests (entitlement_id, tenant_id);
create index if not exists accounts_agent_id_tenant_id_fk_idx on accounts (agent_id, tenant_id);
create index if not exists agent_duplicate_candidates_created_by_fk_idx on agent_duplicate_candidates (created_by);
create index if not exists agent_duplicate_candidates_matched_agent_id_fk_idx on agent_duplicate_candidates (matched_agent_id);
create index if not exists agent_duplicate_candidates_reviewed_by_fk_idx on agent_duplicate_candidates (reviewed_by);
create index if not exists agent_identities_agent_id_tenant_id_fk_idx on agent_identities (agent_id, tenant_id);
create index if not exists agent_owners_agent_id_tenant_id_fk_idx on agent_owners (agent_id, tenant_id);
create index if not exists agent_relationships_agent_id_tenant_id_fk_idx on agent_relationships (agent_id, tenant_id);
create index if not exists agent_relationships_related_agent_id_tenant_id_fk_idx on agent_relationships (related_agent_id, tenant_id);
create index if not exists application_entitlement_types_request_policy_fk_idx on application_entitlement_types (request_policy_id, tenant_id);
create index if not exists application_fulfilment_assignments_group_fk_idx on application_fulfilment_assignments (assignee_group_id, tenant_id);
create index if not exists application_fulfilment_assignments_identity_fk_idx on application_fulfilment_assignments (assignee_identity_id, tenant_id);
create index if not exists application_onboardings_template_id_tenant_id_fk_idx on application_onboardings (template_id, tenant_id);
create index if not exists certification_consultations_item_id_tenant_id_fk_idx on certification_consultations (item_id, tenant_id);
create index if not exists certification_items_account_id_tenant_id_fk_idx on certification_items (account_id, tenant_id);
create index if not exists certification_items_escalated_to_fk_idx on certification_items (escalated_to);
create index if not exists certification_items_group_id_tenant_id_fk_idx on certification_items (group_id, tenant_id);
create index if not exists certification_items_identity_id_tenant_id_fk_idx on certification_items (identity_id, tenant_id);
create index if not exists certification_items_package_id_tenant_id_fk_idx on certification_items (package_id, tenant_id);
create index if not exists control_mappings_policy_id_tenant_id_fk_idx on control_mappings (policy_id, tenant_id);
create index if not exists data_sources_application_id_tenant_id_fk_idx on data_sources (application_id, tenant_id);
create index if not exists entitlements_data_source_id_tenant_id_fk_idx on entitlements (data_source_id, tenant_id);
create index if not exists feature_flags_flag_key_fk_idx on feature_flags (flag_key);
create index if not exists group_members_group_id_tenant_id_fk_idx on group_members (group_id, tenant_id);
create index if not exists group_roles_group_id_tenant_id_fk_idx on group_roles (group_id, tenant_id);
create index if not exists identity_lifecycle_tasks_rule_id_tenant_id_fk_idx on identity_lifecycle_tasks (rule_id, tenant_id);
create index if not exists identity_source_conflicts_kept_source_id_tenant_id_fk_idx on identity_source_conflicts (kept_source_id, tenant_id);
create index if not exists identity_source_conflicts_other_source_id_tenant_id_fk_idx on identity_source_conflicts (other_source_id, tenant_id);
create index if not exists investigation_events_actor_id_fk_idx on investigation_events (actor_id);
create index if not exists investigation_events_investigation_id_tenant_id_fk_idx on investigation_events (investigation_id, tenant_id);
create index if not exists investigation_findings_added_by_fk_idx on investigation_findings (added_by);
create index if not exists investigation_findings_finding_id_tenant_id_fk_idx on investigation_findings (finding_id, tenant_id);
create index if not exists investigation_findings_investigation_id_tenant_id_fk_idx on investigation_findings (investigation_id, tenant_id);
create index if not exists investigations_created_by_fk_idx on investigations (created_by);
create index if not exists notification_preferences_user_id_fk_idx on notification_preferences (user_id);
create index if not exists notifications_user_id_fk_idx on notifications (user_id);
create index if not exists platform_announcements_created_by_fk_idx on platform_announcements (created_by);
create index if not exists platform_config_versions_actor_id_fk_idx on platform_config_versions (actor_id);
create index if not exists policy_exceptions_agent_id_tenant_id_fk_idx on policy_exceptions (agent_id, tenant_id);
create index if not exists policy_exceptions_policy_id_tenant_id_fk_idx on policy_exceptions (policy_id, tenant_id);
create index if not exists policy_versions_changed_by_fk_idx on policy_versions (changed_by);
create index if not exists privacy_consent_records_subject_user_id_fk_idx on privacy_consent_records (subject_user_id);
create index if not exists reports_created_by_fk_idx on reports (created_by);
create index if not exists risk_severity_weights_updated_by_fk_idx on risk_severity_weights (updated_by);
create index if not exists runtime_event_quarantine_agent_id_fk_idx on runtime_event_quarantine (agent_id);
