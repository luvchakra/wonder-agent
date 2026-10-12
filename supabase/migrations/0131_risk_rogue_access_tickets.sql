-- Risk Agent — ticket numbers for rogue-access findings (owner request,
-- 2026-10-12).
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.
--
-- Every rogue-access finding gets a ticket number people can quote:
-- RA-000001, RA-000002, … per organization, in the order they are raised.
-- The ticket is the finding: it stays open while the access is investigated
-- and removed, and it is resolved (verified fixed) when reconciliation
-- confirms the access is gone, exactly when the finding resolves.
--
-- The number is drawn in the same transaction that inserts the finding (a
-- BEFORE INSERT trigger locks the organization's counter row), so two
-- findings never share a number and a failed insert releases its number
-- with the transaction. Existing rogue-access findings are numbered in the
-- order they were created.
--
-- Additive only.

create table risk_ticket_counters (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);

alter table risk_ticket_counters enable row level security;
-- Members may read their organization's counter; only the trigger writes it.
create policy risk_ticket_counters_select on risk_ticket_counters
  for select using (tenant_id in (select current_tenant_ids()));

alter table risk_findings
  add column ticket_number text check (ticket_number is null or ticket_number ~ '^RA-[0-9]{6,}$');

create unique index risk_findings_ticket_number_key on risk_findings (tenant_id, ticket_number) where ticket_number is not null;

create function risk_findings_assign_ticket() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  if new.category <> 'rogue_access' or new.ticket_number is not null then
    return new;
  end if;
  insert into risk_ticket_counters as c (tenant_id, last_number, updated_at)
    values (new.tenant_id, 1, now())
    on conflict (tenant_id) do update set last_number = c.last_number + 1, updated_at = now()
    returning c.last_number into n;
  new.ticket_number := 'RA-' || lpad(n::text, 6, '0');
  return new;
end;
$$;

revoke execute on function risk_findings_assign_ticket() from public, anon, authenticated;

create trigger risk_findings_assign_ticket
  before insert on risk_findings
  for each row execute function risk_findings_assign_ticket();

-- Number the rogue-access findings raised before this migration, oldest first.
with numbered as (
  select id, tenant_id, row_number() over (partition by tenant_id order by created_at, id) as n
  from risk_findings
  where category = 'rogue_access' and ticket_number is null
)
update risk_findings f
   set ticket_number = 'RA-' || lpad(numbered.n::text, 6, '0')
  from numbered
 where f.id = numbered.id and f.tenant_id = numbered.tenant_id;

insert into risk_ticket_counters (tenant_id, last_number)
  select tenant_id, count(*) from risk_findings where category = 'rogue_access' group by tenant_id
  on conflict (tenant_id) do update set last_number = greatest(risk_ticket_counters.last_number, excluded.last_number), updated_at = now();
