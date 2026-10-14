-- COMPLIANCE-P0-10: a people's-access item's identity and account belong
-- to the item's own organization, enforced by the database (the 0076
-- same-tenant reference pattern), not only by the service.

alter table certification_items drop constraint certification_items_identity_id_fkey;
alter table certification_items add constraint certification_items_identity_id_fkey
  foreign key (identity_id, tenant_id) references identities (id, tenant_id) on delete cascade;

alter table certification_items drop constraint certification_items_account_id_fkey;
alter table certification_items add constraint certification_items_account_id_fkey
  foreign key (account_id, tenant_id) references accounts (id, tenant_id) on delete cascade;
