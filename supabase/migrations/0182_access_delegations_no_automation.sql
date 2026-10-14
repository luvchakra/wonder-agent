-- Access Agent — WID-H06 (reopened 2026-10-14 by ACCESS-P0-23 part 3).
-- An automation credential's power is its backing member's roles, changed
-- only on the credential's own page (escalation check, four-eyes). No
-- delegation, of any scope, names an automation member on either side,
-- and no delegated role copy is written for one. The service refuses this
-- first (409 AUTOMATION_MEMBER); these triggers make it hold for every
-- writer, the service role included.
--
-- Additive: two guard triggers; no existing row is an automation
-- delegation (checked before applying).

create or replace function access_delegations_refuse_automation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from tenant_memberships m
     where m.tenant_id = new.tenant_id
       and m.user_id in (new.delegator_user_id, new.delegate_user_id)
       and m.account_type = 'automation'
  ) then
    raise exception 'an automation credential cannot delegate or be delegated to' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function access_delegations_refuse_automation() from public;
revoke execute on function access_delegations_refuse_automation() from anon, authenticated;

create trigger access_delegations_refuse_automation
  before insert or update of delegator_user_id, delegate_user_id on access_delegations
  for each row execute function access_delegations_refuse_automation();

create or replace function user_roles_refuse_automation_delegation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delegation_id is not null and exists (
    select 1 from tenant_memberships m
     where m.tenant_id = new.tenant_id and m.user_id = new.user_id and m.account_type = 'automation'
  ) then
    raise exception 'an automation credential''s roles are changed only on its own page' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function user_roles_refuse_automation_delegation() from public;
revoke execute on function user_roles_refuse_automation_delegation() from anon, authenticated;

create trigger user_roles_refuse_automation_delegation
  before insert or update of delegation_id, user_id on user_roles
  for each row execute function user_roles_refuse_automation_delegation();
