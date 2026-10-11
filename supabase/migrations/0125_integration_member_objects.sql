-- Integration Agent — FOUNDATION-P0-32: member records from CSV.
-- Owner: Integration Agent (integration_objects). See
-- docs/design/ownership-map.md before modifying.
--
-- Bulk invitation reads a CSV from the users page through the connector
-- framework (non-negotiable #20), like every object-page import: the File
-- imports connection stores each row as an integration object, and
-- Foundation applies them as invitations. Staged objects gain the family
-- 'member', and so do the stored files (connector_files.kind, 0111). RLS
-- and policies are unchanged.
--
-- Additive only: the allowed values grow by one.

alter table integration_objects drop constraint integration_objects_object_type_check;
alter table integration_objects add constraint integration_objects_object_type_check check (object_type in (
  'identity', 'account', 'application', 'entitlement', 'access_grant', 'policy', 'activity',
  'mcp_server', 'mcp_tool', 'mcp_resource', 'member'
));

alter table connector_files drop constraint connector_files_kind_check;
alter table connector_files add constraint connector_files_kind_check check (kind in (
  'identity', 'account', 'entitlement', 'access_grant', 'application', 'policy', 'member'
));
