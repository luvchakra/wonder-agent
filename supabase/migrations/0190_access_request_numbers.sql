-- Access Agent — request numbers (owner request, 2026-10-14).
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.
--
-- Every access request gets a number people can quote: REQ000000001,
-- REQ000000002, … (REQ and nine digits) per organization, in the order the
-- requests are submitted.
--
-- The number is drawn in the same transaction that inserts the request (a
-- BEFORE INSERT trigger locks the organization's counter row, as the
-- rogue-access tickets of 0131 do), so two requests never share a number
-- and a failed insert releases its number with the transaction. Existing
-- requests are numbered in the order they were created.
--
-- Additive only.

create table access_request_counters (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);

alter table access_request_counters enable row level security;
-- Members may read their organization's counter; only the trigger writes it.
create policy access_request_counters_select on access_request_counters
  for select using (tenant_id in (select current_tenant_ids()));

alter table access_requests
  add column request_number text check (request_number is null or request_number ~ '^REQ[0-9]{9,}$');

create unique index access_requests_request_number_key on access_requests (tenant_id, request_number) where request_number is not null;

create function access_requests_assign_number() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  -- Always drawn here: a number supplied by a caller is never trusted.
  insert into access_request_counters as c (tenant_id, last_number, updated_at)
    values (new.tenant_id, 1, now())
    on conflict (tenant_id) do update set last_number = c.last_number + 1, updated_at = now()
    returning c.last_number into n;
  new.request_number := 'REQ' || lpad(n::text, 9, '0');
  return new;
end;
$$;

revoke execute on function access_requests_assign_number() from public, anon, authenticated;

create trigger access_requests_assign_number
  before insert on access_requests
  for each row execute function access_requests_assign_number();

-- A request's number never changes once given.
create function access_requests_keep_number() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.request_number is not null and new.request_number is distinct from old.request_number then
    raise exception 'a request number cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function access_requests_keep_number() from public, anon, authenticated;

create trigger access_requests_keep_number
  before update of request_number on access_requests
  for each row execute function access_requests_keep_number();

-- Number the requests submitted before this migration, oldest first. Giving
-- a number is not an edit of the request, so its "updated by/on" is kept.
alter table access_requests disable trigger record_provenance;
with numbered as (
  select id, tenant_id, row_number() over (partition by tenant_id order by created_at, id) as n
  from access_requests
  where request_number is null
)
update access_requests r
   set request_number = 'REQ' || lpad(numbered.n::text, 9, '0')
  from numbered
 where r.id = numbered.id and r.tenant_id = numbered.tenant_id;
alter table access_requests enable trigger record_provenance;

insert into access_request_counters (tenant_id, last_number)
  select tenant_id, count(*) from access_requests group by tenant_id
  on conflict (tenant_id) do update set last_number = greatest(access_request_counters.last_number, excluded.last_number), updated_at = now();
