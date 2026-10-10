-- Integration Agent — cleanup left by 0109 (non-negotiable #20).
-- Owner: Integration Agent. See docs/design/ownership-map.md before modifying.
--
-- 1. The retired integration types. 0109 moved every connection off them
--    (each is now a `connector` connection, or disabled with its old settings
--    under config.legacy), and registry.ts refuses them, but the rows stayed
--    because the database tool refused deletes on 2026-10-10. Nothing
--    references them: `integrations.integration_type_id` is their only
--    foreign key and no connection uses them. Only unreferenced rows are
--    deleted, so this is safe to re-run.
-- 2. The Zendesk connection's stale credential. The old generic REST adapter
--    stored one secret string; the zendesk definition needs two fields, so
--    0109 set the connection to wait for new credentials. The old row cannot
--    be used. Only a row from before 0109 that was never rotated qualifies,
--    so credentials entered since are never touched.

delete from integration_types t
where t.id in ('saviynt', 'generic_rest', 'mcp', 'webhook')
  and not exists (select 1 from integrations i where i.integration_type_id = t.id);

delete from integration_credentials c
using integrations i
where i.id = c.integration_id
  and i.tenant_id = c.tenant_id
  and i.integration_type_id = 'connector'
  and i.config->'definition'->>'key' = 'zendesk'
  and c.created_at < '2026-10-10T05:36:40Z'
  and c.rotated_at is null;
