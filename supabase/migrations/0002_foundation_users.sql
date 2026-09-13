-- Foundation Agent — FOUNDATION-P0-02.2
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended', 'removed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index on tenant_memberships (user_id);

-- Every authenticated identity gets a `users` row before any tenant
-- membership can reference it.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
