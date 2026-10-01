-- Platform Agent — PLATFORM-P1-04 follow-up (2026-10-01 self-review).
-- Owner: Platform Agent. Additive.
--
-- 1. assign_invoice_number(invoice): gives a paid invoice its number in the
--    same transaction that locks the invoice row, so a number is drawn only
--    when it will be used. Before this, the application drew a number
--    first and then wrote it; two concurrent deliveries of one event could
--    each draw one, and the losing write left a gap in the series GST rule
--    46 requires to be consecutive.
-- 2. billing_webhook_events.claimed_at: when the event was last taken for
--    processing. A redelivery reclaims an event only if it failed or its
--    claim is stale, so two deliveries never process it at the same time.

create or replace function assign_invoice_number(p_invoice uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number text;
  v_status text;
  v_paid timestamptz;
begin
  select invoice_number, status, coalesce(paid_at, now()) into v_number, v_status, v_paid
    from billing_invoices where id = p_invoice for update;
  if not found then
    raise exception 'invoice % not found', p_invoice using errcode = 'P0002';
  end if;
  if v_number is not null then
    return v_number;
  end if;
  if v_status not in ('paid', 'refunded', 'partially_refunded') then
    return null;
  end if;
  v_number := next_invoice_number(v_paid);
  update billing_invoices set invoice_number = v_number where id = p_invoice;
  return v_number;
end;
$$;

revoke execute on function assign_invoice_number(uuid) from public, anon, authenticated;
grant execute on function assign_invoice_number(uuid) to service_role;

alter table billing_webhook_events add column claimed_at timestamptz not null default now();
