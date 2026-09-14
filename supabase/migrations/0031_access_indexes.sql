-- Access Agent — hardening follow-up from get_advisors (performance).

create index access_requests_application_id_idx on access_requests (application_id);
create index access_requests_decided_by_idx on access_requests (decided_by);
create index access_requests_entitlement_id_idx on access_requests (entitlement_id);
create index access_requests_requested_by_idx on access_requests (requested_by);
create index policies_owner_id_idx on policies (owner_id);
create index policy_exceptions_approved_by_idx on policy_exceptions (approved_by);
