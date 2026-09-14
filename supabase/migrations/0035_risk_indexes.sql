-- Risk Agent — hardening follow-up from get_advisors (performance), same
-- pattern as Access Agent's 0031 and Runtime Agent's 0033.

create index risk_findings_agent_id_idx on risk_findings (agent_id);
