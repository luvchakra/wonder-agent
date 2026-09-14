-- Compliance Agent — hardening follow-up from get_advisors (performance),
-- same pattern as Access/Runtime/Risk's 0031/0033/0035.

create index certification_items_campaign_id_idx on certification_items (campaign_id);
