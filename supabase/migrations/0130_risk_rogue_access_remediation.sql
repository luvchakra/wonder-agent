-- Risk Agent — RISK-P0-13 (core, F3): remediating rogue access through a
-- request, its approval and the connector.
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.
--
-- "Remove this access" on a rogue-access finding submits an ordinary
-- remove-access request (or, for an account nobody approved,
-- disable-account) as the reviewer who asked. The application's request
-- policy decides the approval; fulfilment and the connector make the
-- change; reconciliation verifies it, and the finding resolves on its own
-- when the access is gone. The finding remembers which request it raised,
-- in its own organization (same-tenant key).
--
-- Additive only.

alter table risk_findings
  add column remediation_request_id uuid,
  add constraint risk_findings_remediation_request_fkey
    foreign key (remediation_request_id, tenant_id) references access_requests (id, tenant_id) on delete set null (remediation_request_id);

create index risk_findings_remediation_request_fk_idx on risk_findings (remediation_request_id, tenant_id) where remediation_request_id is not null;
