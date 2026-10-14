-- ACCESS-P0-34 follow-up to 0171: a template names its connection type by
-- the connector definition's key (a built-in such as `workday` or a custom
-- definition), the way connections are typed since the connector framework
-- (0108). integration_types holds only the generic `connector` row, so
-- 0171's integration_type_id cannot tell connection types apart; it stays
-- unused (always null) and can be dropped with the owner's approval. The
-- key is not a foreign key: built-in definitions live in code.

alter table application_onboarding_templates
  add column connection_type_key text check (connection_type_key is null or connection_type_key ~ '^[a-z][a-z0-9-]{1,62}$');

create index application_onboarding_templates_connection_type_idx on application_onboarding_templates (tenant_id, connection_type_key) where status = 'active';
