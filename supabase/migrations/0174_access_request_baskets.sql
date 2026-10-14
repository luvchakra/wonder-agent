-- ACCESS-P0-38 (design §5.3): request baskets. A basket is many lines for
-- one or many people, sent together; each line for each person is still
-- its own access request, checked and approved on its own route. The
-- requests of one basket share basket_id, so the requester can follow the
-- basket as a whole. Additive: requests sent one by one keep basket_id null.

alter table access_requests add column basket_id uuid;

create index access_requests_basket_idx on access_requests (tenant_id, basket_id) where basket_id is not null;
