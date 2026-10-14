-- Compliance Agent — COMPLIANCE-P0-14 part 3: consultation. A reviewer asks
-- a member (the person whose access it is, its owner, anyone who knows) a
-- question about one review item; that member answers once. The reviewer
-- still decides; the question and answer are kept with the item as
-- evidence.
--
-- Additive: one new table, and a unique (id, tenant_id) on
-- certification_items (id alone is already unique). RLS: members of the organization read; writes
-- only through the Compliance service (service role, filtered by tenant).

-- The same-organization foreign key below needs (id, tenant_id) to be unique.
alter table certification_items add constraint certification_items_id_tenant_key unique (id, tenant_id);

create table certification_consultations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null,
  asked_by uuid not null,
  asked_of uuid not null,
  question text not null check (char_length(btrim(question)) between 3 and 2000),
  answer text check (answer is null or char_length(btrim(answer)) between 1 and 2000),
  answered_at timestamptz,
  constraint certification_consultations_item_same_tenant foreign key (item_id, tenant_id) references certification_items (id, tenant_id) on delete cascade,
  constraint certification_consultations_not_self check (asked_by <> asked_of),
  constraint certification_consultations_answered check ((answer is null) = (answered_at is null))
);
create index certification_consultations_item_idx on certification_consultations (item_id);
create index certification_consultations_asked_of_idx on certification_consultations (tenant_id, asked_of) where answered_at is null;

alter table certification_consultations enable row level security;
create policy certification_consultations_select on certification_consultations
  for select using (tenant_id in (select current_tenant_ids()));

do $$
declare
  t text;
begin
  foreach t in array array['certification_consultations'] loop
    execute format('alter table %I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists created_by uuid', t);
    execute format('alter table %I add column if not exists updated_by uuid', t);
    if not exists (select 1 from pg_trigger where tgname = 'record_provenance' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger record_provenance before insert or update on %I for each row execute function record_provenance()', t);
    end if;
  end loop;
end;
$$;
