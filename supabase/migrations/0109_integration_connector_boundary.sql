-- Integration Agent — non-negotiable #20: every connection runs through the connector framework.
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- User decision (2026-10-10): no direct connection between WonderID and an
-- organization's data; every flow goes through the connector framework.
--
-- 1. connector_receivers: the secret an organization's systems use to send
--    data to a connection (/api/connect/v1/<connection>/events|webhook).
--    Issued by WonderID, shown once, kept only encrypted (encryptSecret).
--    Like integration_credentials it has RLS on and no client policy at all:
--    only server code with the service role reads it.
-- 2. The connections made with the retired adapters are converted to
--    connector connections running the equivalent built-in definition,
--    named by key and version 1.0.0 (the engine loads exactly that version
--    of modules/integrations/framework/definitions/{saviynt,zendesk,mcp-server}.ts).
--    - saviynt: same address; its stored API token keeps working (a plain
--      string fits a definition with one secret field).
--    - mcp: same address (an mcp:// address, which the old adapter could
--      never call, becomes https://…/mcp); its stored secret keeps working
--      for discovery and becomes the connection's receiving secret.
--    - generic_rest pointing at Zendesk: the zendesk definition; its stored
--      secret (one string) cannot hold Zendesk's two fields, so it is
--      removed and the connection waits for new credentials.
--    - anything else on a retired type is disabled, its old settings kept
--      under config.legacy for the record.
-- 3. The retired integration types are removed, so nothing can be created
--    on them again.

create table connector_receivers (
  integration_id uuid primary key references integrations(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  encrypted_secret text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_received_at timestamptz
);

create index connector_receivers_tenant_idx on connector_receivers (tenant_id);

alter table connector_receivers enable row level security;
-- Intentionally no policies (as integration_credentials, migration 0021).

-- 2. Convert existing connections.
-- The MCP connections' secret also authenticated their events: it becomes the receiving secret.
insert into connector_receivers (integration_id, tenant_id, encrypted_secret, created_at)
select c.integration_id, c.tenant_id, c.encrypted_secret, c.created_at
from integration_credentials c join integrations i on i.id = c.integration_id
where i.integration_type_id in ('mcp', 'webhook');

-- A webhook's stored secret was only ever its signing secret.
delete from integration_credentials c using integrations i
where i.id = c.integration_id and i.integration_type_id = 'webhook';

with targets as (
  select i.id,
         case
           when i.integration_type_id = 'saviynt' and i.config->>'baseUrl' like 'https://%' then 'saviynt'
           when i.integration_type_id = 'mcp' and coalesce(i.config->>'baseUrl', i.config->>'endpoint') ~ '^(https|mcp)://' then 'mcp-server'
           when i.integration_type_id = 'generic_rest' and i.config->>'baseUrl' ~ '^https://[^/]+\.zendesk\.' then 'zendesk'
         end as key,
         case
           when i.integration_type_id = 'mcp' then regexp_replace(coalesce(i.config->>'baseUrl', i.config->>'endpoint'), '^mcp://([^/]+)/?$', 'https://\1/mcp')
           when i.integration_type_id = 'generic_rest' then regexp_replace(i.config->>'baseUrl', '^(https://[^/]+).*$', '\1')
           else i.config->>'baseUrl'
         end as base_url
  from integrations i
  where i.integration_type_id in ('saviynt', 'mcp', 'generic_rest')
)
update integrations i
set integration_type_id = 'connector',
    config = jsonb_build_object(
      'definition', jsonb_build_object('key', t.key, 'version', '1.0.0', 'origin', 'builtin'),
      'settings', jsonb_build_object('baseUrl', t.base_url),
      'baseUrl', t.base_url),
    capabilities = case t.key
      when 'saviynt' then '{"importIdentities":true,"importAccounts":true,"importApplications":true,"importEntitlements":true,"importAccess":true,"importPolicies":true,"importActivity":false,"provision":false,"deprovision":false}'::jsonb
      when 'zendesk' then '{"importAccounts":true,"importEntitlements":true,"importAccess":true,"importActivity":false,"provision":false,"deprovision":false}'::jsonb
      else '{"importActivity":true,"provision":false,"deprovision":false}'::jsonb
    end
from targets t
where i.id = t.id and t.key is not null;

-- Zendesk needs two secret fields; the old single secret cannot be used.
delete from integration_credentials c using integrations i
where i.id = c.integration_id and i.integration_type_id = 'connector' and i.config->'definition'->>'key' = 'zendesk';
update integrations set status = 'configured'
where integration_type_id = 'connector' and config->'definition'->>'key' = 'zendesk';

-- Anything left on a retired type cannot run any more: disabled, old settings kept.
update integrations
set config = jsonb_build_object('legacy', jsonb_build_object('type', integration_type_id, 'config', config)),
    integration_type_id = 'connector',
    status = 'disabled'
where integration_type_id in ('saviynt', 'mcp', 'generic_rest', 'webhook');

-- 3. Retire the types.
delete from integration_types where id in ('saviynt', 'mcp', 'generic_rest', 'webhook');
