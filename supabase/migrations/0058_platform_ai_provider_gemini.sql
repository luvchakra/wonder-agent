-- Platform Agent — PLATFORM-P0-05.2 follow-up (user request, 2026-09-16):
-- also support Google Gemini as a second AI provider, alongside OpenAI,
-- with the same platform-wide-default-or-BYOK model.
-- Owner: Platform Agent. See docs/design/ownership-map.md before modifying.

alter table platform_ai_provider_configs drop constraint platform_ai_provider_configs_provider_check;
alter table platform_ai_provider_configs add constraint platform_ai_provider_configs_provider_check
  check (provider in ('openai', 'gemini'));
