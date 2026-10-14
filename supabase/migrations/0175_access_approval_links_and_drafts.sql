-- ACCESS-P0-38 part 2 (design §5.3): approve from e-mail, and saved drafts.
--
-- access_approval_links: a link sent to one approver when a request's stage
-- waits for them. Only the SHA-256 of the random token is stored. A link
-- is single-use and short-lived, and it decides nothing: it opens the
-- request page, where the decision still needs the approver's signed-in
-- session. Members read their own; the Access service writes.
--
-- access_request_drafts: a basket (people, items, why) saved by a member
-- to send later. Each member reads only their own; the service writes.

create table access_approval_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  request_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (request_id, tenant_id) references access_requests (id, tenant_id) on delete cascade
);

create index access_approval_links_request_idx on access_approval_links (tenant_id, request_id);
create index access_approval_links_user_idx on access_approval_links (user_id);

alter table access_approval_links enable row level security;
create policy access_approval_links_select on access_approval_links for select
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));

create table access_request_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index access_request_drafts_owner_idx on access_request_drafts (tenant_id, user_id, updated_at desc);
create index access_request_drafts_user_idx on access_request_drafts (user_id);

alter table access_request_drafts enable row level security;
create policy access_request_drafts_select on access_request_drafts for select
  using (tenant_id in (select current_tenant_ids()) and user_id = (select auth.uid()));
