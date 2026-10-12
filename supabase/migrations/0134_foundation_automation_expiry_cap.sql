-- Foundation Agent — a database cap on automation credential expiry (WID-H06).
-- Owner: Foundation Agent. See docs/design/ownership-map.md before modifying.
--
-- The service already refuses an expiry, or a requested extension, more
-- than 365 days out (MAX_EXPIRY_DAYS). This makes the database refuse it
-- too, so a service-role write that skipped the service cannot mint a
-- credential that never expires. Checked only when the value is set or
-- changed, against the time of the write (an extension moves the end date
-- from the day it is approved, so a cap from created_at would be wrong).
-- One day of slack allows for the time between the service's check and
-- the write. Additive only: existing rows are untouched.

create or replace function automation_credentials_expiry_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.expires_at is distinct from old.expires_at)
     and new.expires_at > now() + interval '366 days' then
    raise exception 'An automation credential may expire at most 365 days ahead' using errcode = 'check_violation';
  end if;
  if new.requested_expires_at is not null
     and (tg_op = 'INSERT' or new.requested_expires_at is distinct from old.requested_expires_at)
     and new.requested_expires_at > now() + interval '366 days' then
    raise exception 'An automation credential extension may reach at most 365 days ahead' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function automation_credentials_expiry_cap() from public, anon, authenticated;

create trigger automation_credentials_expiry_cap
  before insert or update of expires_at, requested_expires_at on automation_credentials
  for each row execute function automation_credentials_expiry_cap();
