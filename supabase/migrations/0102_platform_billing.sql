-- Platform Agent — PLATFORM-P1-04 Billing Integration, brought forward by
-- explicit user request (2026-10-01): Stripe and Razorpay.
-- Owner: Platform Agent. See docs/design/ownership-map.md before modifying.
--
-- Design (recorded in docs/design/platform-agent-backlog-audit.md):
-- - Card and bank data never touch WonderID. Payment is collected on the
--   provider's hosted pages (Stripe Checkout / Billing Portal, Razorpay
--   subscription authorisation link), so the PCI DSS scope stays SAQ-A.
-- - The provider is the system of record for a payment; WonderID records
--   provenance (provider, provider ids, signed webhook event) and
--   reconciles (non-negotiable #7). Prices are WonderID's: the catalogue
--   below is the source of truth and provider prices/plans are created
--   from it on first use.
-- - The tenant is never inferred from a provider payload (§14): every
--   webhook is matched to a checkout or subscription WonderID itself
--   created and recorded below.
-- - Financial records are append-only where it matters for SOX: issued
--   invoices cannot have their amounts, currency, number or customer
--   snapshot changed, and nothing here can be deleted by a client.

-- 1. subscriptions gains the provider link (additive; the manual
--    platform-assigned path keeps working with provider = 'manual').
alter table subscriptions
  add column provider text not null default 'manual' check (provider in ('manual', 'stripe', 'razorpay')),
  add column provider_customer_id text,
  add column provider_subscription_id text,
  add column price_id text,
  add column billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  add column currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  add column current_period_start timestamptz,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column cancelled_at timestamptz,
  add column provider_state_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table subscriptions drop constraint subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('active', 'past_due', 'cancelled', 'trialing', 'incomplete', 'paused'));

create unique index subscriptions_provider_subscription_idx
  on subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;

-- 2. The price catalogue: global, not customer data (same treatment as
--    control_frameworks). Amounts in minor units. Enterprise is sold by
--    contract and free needs no payment, so neither appears here.
create table billing_prices (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  plan text not null check (plan in ('pro', 'max')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit_amount bigint not null check (unit_amount > 0),
  tax_behavior text not null default 'exclusive' check (tax_behavior in ('inclusive', 'exclusive')),
  stripe_price_id text,
  razorpay_plan_id text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (plan, billing_interval, currency)
);

alter table billing_prices enable row level security;
create policy billing_prices_select on billing_prices for select to authenticated using (active);

-- Default list prices: a business decision, not an architecture one (the
-- same framing PLAN_DEFAULTS used). Platform administrators change them
-- in the console; changing an amount clears the provider price ids so a
-- new provider price is created (provider prices are immutable).
-- INR prices include GST (18%); USD/EUR prices are exclusive of tax.
insert into billing_prices (id, plan, billing_interval, currency, unit_amount, tax_behavior) values
  ('pro_month_usd', 'pro', 'month', 'USD', 49900, 'exclusive'),
  ('pro_year_usd', 'pro', 'year', 'USD', 499000, 'exclusive'),
  ('max_month_usd', 'max', 'month', 'USD', 149900, 'exclusive'),
  ('max_year_usd', 'max', 'year', 'USD', 1499000, 'exclusive'),
  ('pro_month_eur', 'pro', 'month', 'EUR', 46900, 'exclusive'),
  ('pro_year_eur', 'pro', 'year', 'EUR', 469000, 'exclusive'),
  ('max_month_eur', 'max', 'month', 'EUR', 139900, 'exclusive'),
  ('max_year_eur', 'max', 'year', 'EUR', 1399000, 'exclusive'),
  ('pro_month_inr', 'pro', 'month', 'INR', 3999900, 'inclusive'),
  ('pro_year_inr', 'pro', 'year', 'INR', 39999000, 'inclusive'),
  ('max_month_inr', 'max', 'month', 'INR', 11999900, 'inclusive'),
  ('max_year_inr', 'max', 'year', 'INR', 119999000, 'inclusive');

-- 3. The tenant's billing profile: the legal entity invoiced, its tax id
--    and place of supply (GST needs the state; VAT needs the country).
create table billing_profiles (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 2 and 200),
  billing_email text not null check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(billing_email) <= 320),
  country text not null check (country ~ '^[A-Z]{2}$'),
  region text check (region is null or char_length(region) <= 100),
  city text check (city is null or char_length(city) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 200),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 200),
  tax_id_type text check (tax_id_type is null or tax_id_type in ('in_gst', 'eu_vat', 'gb_vat', 'au_abn', 'us_ein', 'other')),
  tax_id text check (tax_id is null or char_length(tax_id) between 3 and 40),
  stripe_customer_id text unique,
  razorpay_customer_id text unique,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_profiles_tax_pair check ((tax_id is null) = (tax_id_type is null))
);

create index billing_profiles_updated_by_idx on billing_profiles (updated_by);
alter table billing_profiles enable row level security;
create policy billing_profiles_select on billing_profiles for select
  using (has_tenant_permission(tenant_id, 'billing.view'));

-- 4. Every checkout WonderID starts. A webhook is matched to the tenant
--    through this record (provider_reference), never through payload data.
create table billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'razorpay')),
  price_id text not null references billing_prices(id),
  provider_reference text not null,
  status text not null default 'open' check (status in ('open', 'completed', 'expired', 'failed')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, provider_reference)
);

create index billing_checkouts_tenant_idx on billing_checkouts (tenant_id, created_at desc);
create index billing_checkouts_created_by_idx on billing_checkouts (created_by);
create index billing_checkouts_price_idx on billing_checkouts (price_id);
alter table billing_checkouts enable row level security;
create policy billing_checkouts_select on billing_checkouts for select
  using (has_tenant_permission(tenant_id, 'billing.view'));

-- 5. Invoices: WonderID's ledger of what was billed and paid. Each issued
--    invoice carries a gapless sequential number per financial year
--    (Indian GST rule 46 requires consecutive serial numbers; it is also
--    good SOX practice) and a snapshot of the customer at issue time.
create table billing_invoice_sequences (
  financial_year text primary key check (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_value bigint not null default 0
);
alter table billing_invoice_sequences enable row level security;

create table billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  provider text not null check (provider in ('stripe', 'razorpay')),
  provider_invoice_id text not null,
  provider_payment_id text,
  provider_number text,
  invoice_number text unique,
  status text not null check (status in ('open', 'paid', 'void', 'uncollectible', 'refunded', 'partially_refunded')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal bigint not null check (subtotal >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  total bigint not null check (total >= 0),
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  amount_refunded bigint not null default 0 check (amount_refunded >= 0),
  tax_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(tax_breakdown) = 'array'),
  customer_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(customer_snapshot) = 'object'),
  period_start timestamptz,
  period_end timestamptz,
  hosted_invoice_url text check (hosted_invoice_url is null or hosted_invoice_url ~ '^https://'),
  invoice_pdf_url text check (invoice_pdf_url is null or invoice_pdf_url ~ '^https://'),
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, provider_invoice_id),
  constraint billing_invoices_refund_bound check (amount_refunded <= amount_paid)
);

create index billing_invoices_tenant_idx on billing_invoices (tenant_id, issued_at desc);
create index billing_invoices_subscription_idx on billing_invoices (subscription_id);
alter table billing_invoices enable row level security;
create policy billing_invoices_select on billing_invoices for select
  using (has_tenant_permission(tenant_id, 'billing.view'));

-- The next invoice number for the financial year containing p_at
-- (India's April–March year, used for every currency so there is one
-- consecutive series). Row-locked, so concurrent calls never reuse or
-- skip a number.
create or replace function next_invoice_number(p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  local_date date := (p_at at time zone 'Asia/Kolkata')::date;
  fy_start int := case when extract(month from local_date) >= 4 then extract(year from local_date)::int else extract(year from local_date)::int - 1 end;
  fy text := fy_start::text || '-' || lpad(((fy_start + 1) % 100)::text, 2, '0');
  n bigint;
begin
  insert into billing_invoice_sequences (financial_year, last_value) values (fy, 1)
  on conflict (financial_year) do update set last_value = billing_invoice_sequences.last_value + 1
  returning last_value into n;
  return 'WID/' || fy || '/' || lpad(n::text, 6, '0');
end;
$$;

revoke execute on function next_invoice_number(timestamptz) from public, anon, authenticated;
grant execute on function next_invoice_number(timestamptz) to service_role;

-- Issued invoices are immutable in what was billed; only payment and
-- refund progress moves. Nothing deletes an invoice except the tenant's
-- own hard deletion (the cascade, when the tenant row is already gone).
create or replace function billing_invoices_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from tenants where id = old.tenant_id) then
      raise exception 'billing invoices are retained financial records and cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.provider is distinct from old.provider
     or new.provider_invoice_id is distinct from old.provider_invoice_id
     or new.currency is distinct from old.currency
     or new.subtotal is distinct from old.subtotal
     or new.tax_amount is distinct from old.tax_amount
     or new.total is distinct from old.total
     or new.tax_breakdown is distinct from old.tax_breakdown
     or new.customer_snapshot is distinct from old.customer_snapshot
     or new.issued_at is distinct from old.issued_at
     or (old.invoice_number is not null and new.invoice_number is distinct from old.invoice_number) then
    raise exception 'an issued invoice''s billed amounts, number and customer cannot change' using errcode = '42501';
  end if;
  if new.amount_paid < old.amount_paid or new.amount_refunded < old.amount_refunded then
    raise exception 'payments and refunds on an invoice only accumulate' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function billing_invoices_guard() from public, anon, authenticated;
create trigger billing_invoices_guard before update or delete on billing_invoices
  for each row execute function billing_invoices_guard();

-- 6. Webhook intake: vendor-side, like platform_audit_logs (RLS on, no
--    policies). Idempotent on the provider's event id. The payload is
--    stored redacted (no card, bank, contact or address data).
create table billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'razorpay')),
  event_id text not null,
  event_type text not null,
  tenant_id uuid references tenants(id) on delete set null,
  signature_verified boolean not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts integer not null default 1,
  error text,
  payload jsonb not null default '{}'::jsonb,
  event_created_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create index billing_webhook_events_tenant_idx on billing_webhook_events (tenant_id, received_at desc);
create index billing_webhook_events_status_idx on billing_webhook_events (status, received_at desc);
alter table billing_webhook_events enable row level security;

-- 7. Refunds, credits and plan overrides by platform staff: maker-checker
--    (SOX segregation of duties). The approver can never be the requester,
--    and a request executes only once approved.
create table billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid references billing_invoices(id) on delete set null,
  kind text not null check (kind in ('refund', 'plan_override', 'cancel_immediately')),
  amount bigint check (amount is null or amount > 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  target_plan text check (target_plan is null or target_plan in ('free', 'pro', 'max', 'enterprise')),
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  executed_at timestamptz,
  provider_reference text,
  error text,
  constraint billing_adjustments_four_eyes check (decided_by is null or decided_by <> requested_by),
  constraint billing_adjustments_refund_shape check (kind <> 'refund' or (invoice_id is not null and amount is not null)),
  constraint billing_adjustments_override_shape check (kind <> 'plan_override' or target_plan is not null)
);

create index billing_adjustments_tenant_idx on billing_adjustments (tenant_id, requested_at desc);
create index billing_adjustments_invoice_idx on billing_adjustments (invoice_id);
create index billing_adjustments_requested_by_idx on billing_adjustments (requested_by);
create index billing_adjustments_decided_by_idx on billing_adjustments (decided_by);
create index billing_adjustments_pending_idx on billing_adjustments (status) where status in ('pending', 'approved');
alter table billing_adjustments enable row level security;

-- 8. Billing alerts reach the tenant's billing administrators.
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task',
  'billing_alert', 'privacy_deadline'
));

alter table notification_preferences drop constraint notification_preferences_type_check;
alter table notification_preferences add constraint notification_preferences_type_check check (type in (
  'certification_due', 'certification_overdue', 'critical_finding', 'rogue_agent',
  'ownership_missing', 'integration_failure', 'lifecycle_expiry',
  'runtime_alert', 'approval_required', 'lifecycle_task',
  'billing_alert', 'privacy_deadline'
));
