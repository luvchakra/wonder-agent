-- Access Agent — COMPLIANCE-P0-01.3 follow-up (resolved 2026-09-16): a
-- distinct request type so a certification reviewer's "modify" decision
-- can create a real access_requests row instead of only being recorded
-- in the decision's own justification text. 'grant' preserves the
-- existing behavior (a new-access request) as the default for every
-- existing row and every caller that doesn't pass a type.
-- Owner: Access Agent. See docs/design/ownership-map.md before modifying.

alter table access_requests add column request_type text not null default 'grant'
  check (request_type in ('grant', 'modify'));
