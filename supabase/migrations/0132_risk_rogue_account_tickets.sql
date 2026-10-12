-- Risk Agent — one ticket per rogue account, not per entitlement (owner
-- decision, 2026-10-12, refining 0131).
-- Owner: Risk Agent. See docs/design/ownership-map.md before modifying.
--
-- A ticket (RA-000001, … per organization) is opened for an account the
-- first time rogue access is found on it. Every rogue-access finding on
-- that account while the ticket is open belongs to it. The ticket resolves
-- (verified fixed) when its last finding closes, i.e. once the account is
-- remediated; rogue access found on the account after that opens a new
-- ticket. Both steps run in the database, in the transaction that inserts
-- or closes the finding, so the ticket can never disagree with its findings.
--
-- 0131 numbered findings one by one; those numbers are retired here (the
-- column stays, unused, for backward compatibility) and the organization's
-- tickets are renumbered from RA-000001 in the order their accounts were
-- first found rogue.
--
-- Additive only (the 0131 trigger's function is replaced in place).

create table risk_access_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  account_id uuid not null,
  ticket_number text not null check (ticket_number ~ '^RA-[0-9]{6,}$'),
  status text not null default 'open' check (status in ('open', 'resolved')),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  constraint risk_access_tickets_id_tenant_key unique (id, tenant_id),
  constraint risk_access_tickets_number_key unique (tenant_id, ticket_number),
  constraint risk_access_tickets_account_fkey foreign key (account_id, tenant_id) references accounts (id, tenant_id) on delete cascade,
  constraint risk_access_tickets_resolved check ((status = 'resolved') = (resolved_at is not null))
);

-- One open ticket per account.
create unique index risk_access_tickets_open_account_key on risk_access_tickets (tenant_id, account_id) where status = 'open';
create index risk_access_tickets_account_fk_idx on risk_access_tickets (account_id, tenant_id);

alter table risk_access_tickets enable row level security;
-- Members read their organization's tickets; only the triggers below write them.
create policy risk_access_tickets_select on risk_access_tickets
  for select using (tenant_id in (select current_tenant_ids()));

alter table risk_findings
  add column access_ticket_id uuid,
  add constraint risk_findings_access_ticket_fkey
    foreign key (access_ticket_id, tenant_id) references risk_access_tickets (id, tenant_id) on delete set null (access_ticket_id);
create index risk_findings_access_ticket_fk_idx on risk_findings (access_ticket_id, tenant_id) where access_ticket_id is not null;

-- On insert: a rogue-access finding joins its account's open ticket, or opens the next one.
create or replace function risk_findings_assign_ticket() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  n bigint;
begin
  if new.category <> 'rogue_access' or new.account_id is null or new.access_ticket_id is not null then
    return new;
  end if;
  -- The counter row lock serializes ticket opening per organization, so two
  -- findings on one account at once still share a single ticket.
  insert into risk_ticket_counters as c (tenant_id, last_number, updated_at)
    values (new.tenant_id, 0, now())
    on conflict (tenant_id) do update set updated_at = now()
    returning c.last_number into n;
  select id into t from risk_access_tickets
   where tenant_id = new.tenant_id and account_id = new.account_id and status = 'open';
  if t is null then
    update risk_ticket_counters set last_number = last_number + 1 where tenant_id = new.tenant_id returning last_number into n;
    insert into risk_access_tickets (tenant_id, account_id, ticket_number)
      values (new.tenant_id, new.account_id, 'RA-' || lpad(n::text, 6, '0'))
      returning id into t;
  end if;
  new.access_ticket_id := t;
  new.ticket_number := null;
  return new;
end;
$$;

-- On close: the ticket resolves when none of its findings is still open.
create function risk_findings_close_ticket() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.access_ticket_id is null or new.status not in ('resolved', 'false_positive') or old.status in ('resolved', 'false_positive') then
    return new;
  end if;
  if not exists (
    select 1 from risk_findings
     where tenant_id = new.tenant_id and access_ticket_id = new.access_ticket_id
       and status not in ('resolved', 'false_positive') and id <> new.id
  ) then
    update risk_access_tickets
       set status = 'resolved', resolved_at = now(),
           resolution = case when new.status = 'false_positive' then 'Closed as a false positive' else 'Verified fixed: no rogue access remains on the account' end
     where tenant_id = new.tenant_id and id = new.access_ticket_id and status = 'open';
  end if;
  return new;
end;
$$;

revoke execute on function risk_findings_close_ticket() from public, anon, authenticated;

create trigger risk_findings_close_ticket
  after update of status on risk_findings
  for each row execute function risk_findings_close_ticket();

-- Retire 0131's per-finding numbers and renumber as account tickets, oldest first.
update risk_findings set ticket_number = null where ticket_number is not null;

with accounts_found as (
  select tenant_id, account_id,
         min(created_at) as first_at,
         max(resolved_at) as last_resolved_at,
         bool_or(status not in ('resolved', 'false_positive')) as any_open
  from risk_findings
  where category = 'rogue_access' and account_id is not null
  group by tenant_id, account_id
), numbered as (
  select *, row_number() over (partition by tenant_id order by first_at, account_id) as n from accounts_found
)
insert into risk_access_tickets (tenant_id, account_id, ticket_number, status, opened_at, resolved_at, resolution)
select tenant_id, account_id, 'RA-' || lpad(n::text, 6, '0'),
       case when any_open then 'open' else 'resolved' end,
       first_at,
       case when any_open then null else coalesce(last_resolved_at, now()) end,
       case when any_open then null else 'Verified fixed: no rogue access remains on the account' end
from numbered;

update risk_findings f
   set access_ticket_id = t.id
  from risk_access_tickets t
 where f.category = 'rogue_access' and f.tenant_id = t.tenant_id and f.account_id = t.account_id;

insert into risk_ticket_counters (tenant_id, last_number, updated_at)
  select tenant_id, count(*), now() from risk_access_tickets group by tenant_id
  on conflict (tenant_id) do update set last_number = excluded.last_number, updated_at = now();
