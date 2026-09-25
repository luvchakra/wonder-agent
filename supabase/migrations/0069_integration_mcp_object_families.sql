-- INTEGRATION-P0-06 (master stories P0-10) — MCP servers, tools and
-- resources as their own normalized object families in
-- integration_objects (user decision 2026-09-25: no separate MCP tables
-- unless these prove insufficient).
--
-- Additive: the object_type check gains 'mcp_server', 'mcp_tool' and
-- 'mcp_resource'; every existing value stays valid. MCP tools were stored
-- as the generic 'entitlement'; any such row from an MCP integration is
-- reclassified to 'mcp_tool' (none existed on the live project when this
-- was written, and nothing reads MCP tools as entitlements). RLS and
-- policies are unchanged.

alter table integration_objects drop constraint integration_objects_object_type_check;
alter table integration_objects add constraint integration_objects_object_type_check check (object_type in (
  'identity', 'account', 'application', 'entitlement', 'access_grant', 'policy', 'activity',
  'mcp_server', 'mcp_tool', 'mcp_resource'
));

update integration_objects o
set object_type = 'mcp_tool'
from integrations i
where i.id = o.integration_id
  and i.integration_type_id = 'mcp'
  and o.object_type = 'entitlement';
