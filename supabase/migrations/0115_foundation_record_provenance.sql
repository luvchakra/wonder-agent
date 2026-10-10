-- Foundation Agent — record provenance on every object (owner decision,
-- 2026-10-10): who created a record and when, who last changed it and
-- when, shown on every object's page. Owner: Foundation Agent; the columns
-- are additive on tables owned by every module (cross-module change by
-- explicit owner request, recorded in each module's audit log).
--
-- Mechanism:
-- - current_actor_id(): the signed-in user (auth.uid()) for a request made
--   as the user; for a service-role request, the actor the server names in
--   the x-wonderid-actor header (lib/db/supabaseServer.ts adds it from the
--   request's resolved tenant context). Nothing else is trusted: the header
--   must be a UUID, and auth.uid() wins when present.
-- - record_provenance(): a trigger that fills created_by/updated_by on
--   insert and updated_at/updated_by on update, never rewriting created_*.
--   A caller that sets the columns itself keeps its values.
-- - created_by/updated_by are plain uuids referring to users.id, not
--   foreign keys: a person who left must not block, and nothing should
--   change on their rows (the page then says "a former member").
--
-- Out of scope, deliberately: append-only and event/log tables (audit_logs
-- and platform_audit_logs, hash-chained; access_ledger_events;
-- privacy_consent_records; billing_invoices; billing_webhook_events;
-- connector_traffic; runtime_events; runtime_event_quarantine;
-- policy_evaluations; runtime_decisions; *_lifecycle_events;
-- investigation_events; notifications), runs and jobs (integration_sync_jobs,
-- account_reconciliation_runs, identity_reconciliation_runs,
-- connector_write_operations), synced snapshots (integration_objects,
-- connector_files, access_ledger, subscriptions, billing_checkouts,
-- billing_adjustments) and immutable versions (connector_definitions).
-- Those keep the actor and time columns they already have.

create or replace function current_actor_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  claimed text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  begin
    claimed := current_setting('request.headers', true)::json ->> 'x-wonderid-actor';
  exception when others then
    return null;
  end;
  if claimed is null or claimed !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return claimed::uuid;
end;
$$;
revoke execute on function current_actor_id() from public, anon;
-- The trigger runs as the writing role, so that role must be able to call it.
grant execute on function current_actor_id() to authenticated, service_role;

create or replace function record_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := public.current_actor_id();
begin
  if tg_op = 'INSERT' then
    if new.created_at is null then new.created_at := now(); end if;
    if new.updated_at is null then new.updated_at := new.created_at; end if;
    if new.created_by is null then new.created_by := actor; end if;
    if new.updated_by is null then new.updated_by := coalesce(actor, new.created_by); end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    if new.updated_by is not distinct from old.updated_by then
      new.updated_by := coalesce(actor, old.updated_by);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function record_provenance() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    -- Foundation
    'tenant_memberships', 'user_roles', 'roles', 'groups', 'group_members', 'group_roles', 'authorization_policies',
    'sso_connections', 'tenant_settings', 'tenant_domains', 'agent_api_keys', 'feature_flags',
    -- Identity
    'agents', 'agent_identities', 'agent_contracts', 'agent_owners', 'agent_relationships', 'agent_duplicate_candidates',
    'identities', 'identity_relationships', 'identity_lifecycle_tasks', 'identity_attribute_definitions', 'identity_source_links',
    -- Integration
    'integrations', 'integration_credentials', 'identity_sources', 'pending_identity_correlations', 'connector_receivers',
    'onboarding_proposals', 'application_discoveries',
    -- Access
    'applications', 'accounts', 'entitlements', 'access_grants', 'access_requests', 'access_request_approvals',
    'access_request_policies', 'access_packages', 'access_package_resources', 'access_package_assignments',
    'access_package_assignment_items', 'data_sources', 'policies', 'application_onboardings',
    -- Runtime
    'runtime_tools', 'runtime_resources', 'runtime_emergency_controls',
    -- Risk
    'risk_findings', 'investigations', 'investigation_findings', 'risk_severity_weights',
    -- Compliance
    'certification_campaigns', 'certification_items', 'control_mappings', 'governance_attestations',
    'privacy_requests', 'privacy_breach_incidents', 'privacy_consent_purposes', 'privacy_processing_activities',
    'privacy_retention_policies', 'privacy_legal_holds', 'privacy_settings',
    -- Operations and Platform
    'reports', 'notification_preferences', 'billing_profiles'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'record_provenance: no table %, skipped', t;
      continue;
    end if;
    execute format('alter table %I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists created_by uuid', t);
    execute format('alter table %I add column if not exists updated_by uuid', t);
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;

comment on function current_actor_id() is 'The acting user: auth.uid(), or the server-named x-wonderid-actor header on a service-role request.';
comment on function record_provenance() is 'Fills created_by/updated_by/updated_at; never rewrites created_at/created_by.';
