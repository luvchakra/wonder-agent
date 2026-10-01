-- QA proof for migrations 0101-0104 (2026-10-01): billing, privacy and the
-- tamper-evident audit trail. Tenant isolation (negative and positive),
-- permission-gated RLS (has_tenant_permission), no client writes, and the
-- immutability / four-eyes guards.
--
-- Reuses the FinanceBot fixture (Tenant A5 = aaaaaaaa-5000-...-0001 with
-- User A5 = 11111111-5000-...-0001; Tenant B5 = bbbbbbbb-5000-...-0002 with
-- User B5 = 22222222-5000-...-0002). Runs entirely inside one transaction
-- and ROLLS BACK, so it leaves nothing behind. DEV project only, via the
-- Supabase MCP execute_sql tool.

begin;

create temporary table check_results (check_name text, result text);
grant insert, select on check_results to authenticated, anon;

-- Fixture rows in Tenant A5 (as the migration owner).
insert into billing_profiles (tenant_id, legal_name, billing_email, country, region) values
  ('aaaaaaaa-5000-0000-0000-000000000001', 'Northwind Financial Pvt Ltd', 'ap@northwind.example', 'IN', '27');
insert into billing_invoices (id, tenant_id, provider, provider_invoice_id, status, currency, subtotal, tax_amount, total, amount_paid) values
  ('facebeef-7100-0000-0000-000000000001', 'aaaaaaaa-5000-0000-0000-000000000001', 'razorpay', 'pay_qa_1', 'paid', 'INR', 3389746, 610154, 3999900, 3999900);
insert into privacy_requests (id, tenant_id, reference, regime, request_type, subject_user_id, subject_email, channel, due_at) values
  ('facebeef-7100-0000-0000-000000000002', 'aaaaaaaa-5000-0000-0000-000000000001', 'PR-QA-OWN', 'dpdp', 'access', '11111111-5000-0000-0000-000000000001', 'a5@example.test', 'self_service', now() + interval '90 days'),
  ('facebeef-7100-0000-0000-000000000003', 'aaaaaaaa-5000-0000-0000-000000000001', 'PR-QA-OTHER', 'gdpr', 'erasure', null, 'someone@example.test', 'email', now() + interval '30 days');
insert into privacy_breach_incidents (tenant_id, reference, title, description, severity, risk_to_individuals, regimes, detected_at) values
  ('aaaaaaaa-5000-0000-0000-000000000001', 'BR-QA-1', 'QA breach', 'Fixture breach for isolation test', 'high', 'risk', array['dpdp'], now());
insert into privacy_consent_purposes (id, tenant_id, key, title, description, notice_version) values
  ('facebeef-7100-0000-0000-000000000004', 'aaaaaaaa-5000-0000-0000-000000000001', 'qa_updates', 'QA updates', 'Fixture consent purpose text', 'v1');
insert into privacy_consent_records (id, tenant_id, purpose_id, subject_user_id, subject_identifier, notice_version, channel) values
  ('facebeef-7100-0000-0000-000000000005', 'aaaaaaaa-5000-0000-0000-000000000001', 'facebeef-7100-0000-0000-000000000004', '11111111-5000-0000-0000-000000000001', 'a5@example.test', 'v1', 'web');

-- 1. User A5 with NO role: sees only their own request and consent, and the purposes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'A_norole_billing_profiles', count(*)::text from billing_profiles where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_norole_invoices', count(*)::text from billing_invoices where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_norole_requests_own_only', count(*)::text from privacy_requests where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_norole_breaches', count(*)::text from privacy_breach_incidents where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_norole_consent_purposes', count(*)::text from privacy_consent_purposes where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_norole_own_consents', count(*)::text from privacy_consent_records where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
do $$ begin
  begin
    insert into billing_invoices (tenant_id, provider, provider_invoice_id, status, currency, subtotal, total) values ('aaaaaaaa-5000-0000-0000-000000000001', 'stripe', 'forged', 'paid', 'USD', 1, 1);
    insert into check_results values ('client_invoice_insert', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('client_invoice_insert', 'CORRECTLY_REJECTED'); end;
  begin
    perform next_invoice_number(now());
    insert into check_results values ('client_next_invoice_number', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('client_next_invoice_number', 'CORRECTLY_REJECTED'); end;
  begin
    perform verify_audit_chain('aaaaaaaa-5000-0000-0000-000000000001');
    insert into check_results values ('client_verify_audit_chain', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('client_verify_audit_chain', 'CORRECTLY_REJECTED'); end;
end $$;
do $$ declare n int; begin
  update privacy_requests set status = 'completed' where id = 'facebeef-7100-0000-0000-000000000002';
  get diagnostics n = row_count; insert into check_results values ('client_request_update_rows', n::text);
end $$;
reset role;

-- 2. Give User A5 the Auditor role (privacy.view + billing.view) and re-read.
insert into user_roles (tenant_id, user_id, role_id) select 'aaaaaaaa-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001', id from roles where tenant_id is null and name = 'AUDITOR';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-5000-0000-0000-000000000001","role":"authenticated"}', true);
insert into check_results select 'A_auditor_billing_profiles', count(*)::text from billing_profiles where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_auditor_invoices', count(*)::text from billing_invoices where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_auditor_requests', count(*)::text from privacy_requests where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'A_auditor_breaches', count(*)::text from privacy_breach_incidents where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
reset role;

-- 3. User B5, even holding the Auditor role in Tenant B5, sees none of Tenant A5.
insert into user_roles (tenant_id, user_id, role_id) select 'bbbbbbbb-5000-0000-0000-000000000002', '22222222-5000-0000-0000-000000000002', id from roles where tenant_id is null and name = 'AUDITOR';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-5000-0000-0000-000000000002","role":"authenticated"}', true);
insert into check_results select 'B_billing_profiles_of_A', count(*)::text from billing_profiles where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'B_invoices_of_A', count(*)::text from billing_invoices where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'B_requests_of_A', count(*)::text from privacy_requests where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'B_breaches_of_A', count(*)::text from privacy_breach_incidents where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'B_consents_of_A', count(*)::text from privacy_consent_records where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'B_purposes_of_A', count(*)::text from privacy_consent_purposes where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
insert into check_results select 'B_has_billing_view_in_A', has_tenant_permission('aaaaaaaa-5000-0000-0000-000000000001', 'billing.view')::text;
reset role;

-- 4. Guards that hold even for the owner / service role.
do $$ begin
  begin update billing_invoices set total = 1 where id = 'facebeef-7100-0000-0000-000000000001'; insert into check_results values ('invoice_amount_change', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('invoice_amount_change', 'CORRECTLY_REJECTED'); end;
  begin delete from billing_invoices where id = 'facebeef-7100-0000-0000-000000000001'; insert into check_results values ('invoice_delete', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('invoice_delete', 'CORRECTLY_REJECTED'); end;
  begin update privacy_consent_records set notice_version = 'v2' where id = 'facebeef-7100-0000-0000-000000000005'; insert into check_results values ('consent_terms_change', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('consent_terms_change', 'CORRECTLY_REJECTED'); end;
  begin
    insert into billing_adjustments (tenant_id, kind, target_plan, reason, requested_by, decided_by, status) values ('aaaaaaaa-5000-0000-0000-000000000001', 'plan_override', 'max', 'QA four-eyes self approval', '11111111-5000-0000-0000-000000000001', '11111111-5000-0000-0000-000000000001', 'approved');
    insert into check_results values ('adjustment_self_approval', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('adjustment_self_approval', 'CORRECTLY_REJECTED'); end;
  begin
    update privacy_requests set processed_by = '11111111-5000-0000-0000-000000000001', approved_by = '11111111-5000-0000-0000-000000000001' where id = 'facebeef-7100-0000-0000-000000000003';
    insert into check_results values ('erasure_self_approval', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('erasure_self_approval', 'CORRECTLY_REJECTED'); end;
  begin
    update audit_logs set action = 'tampered' where tenant_id = 'aaaaaaaa-5000-0000-0000-000000000001';
    insert into check_results values ('audit_update', 'NO_ROWS_OR_SUCCEEDED');
  exception when others then insert into check_results values ('audit_update', 'CORRECTLY_REJECTED'); end;
  begin
    insert into privacy_retention_policies (tenant_id, data_category, retention_days) values ('aaaaaaaa-5000-0000-0000-000000000001', 'audit_logs', 90);
    insert into check_results values ('audit_retention_below_floor', 'UNEXPECTEDLY_SUCCEEDED');
  exception when others then insert into check_results values ('audit_retention_below_floor', 'CORRECTLY_REJECTED'); end;
end $$;

select * from check_results order by check_name;

-- Expected:
--   A_norole_billing_profiles 0, A_norole_invoices 0, A_norole_requests_own_only 1,
--   A_norole_breaches 0, A_norole_consent_purposes 1, A_norole_own_consents 1,
--   client_invoice_insert / client_next_invoice_number / client_verify_audit_chain CORRECTLY_REJECTED,
--   client_request_update_rows 0,
--   A_auditor_billing_profiles 1, A_auditor_invoices 1, A_auditor_requests 2, A_auditor_breaches 1,
--   B_* 0 and B_has_billing_view_in_A false,
--   invoice_amount_change / invoice_delete / consent_terms_change / adjustment_self_approval /
--   erasure_self_approval / audit_update / audit_retention_below_floor CORRECTLY_REJECTED
--   (audit_update is rejected when Tenant A5 has any audit rows; otherwise NO_ROWS_OR_SUCCEEDED).

rollback;
