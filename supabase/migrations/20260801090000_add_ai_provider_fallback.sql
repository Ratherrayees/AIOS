-- One explicitly governed provider fallback may be used only for transient
-- provider failures. Runtime checks still re-evaluate kill switches, budgets,
-- allow-lists, prompt versions, and input safety before provider transit.

alter table public.ai_budget_policies
  add column fallback_model_provider text,
  add constraint ai_budget_policies_fallback_provider_check
    check (
      fallback_model_provider is null
      or (
        fallback_model_provider in ('glm', 'openai', 'gemini', 'anthropic', 'qwen')
        and fallback_model_provider <> selected_model_provider
        and fallback_model_provider = any(allowed_model_providers)
      )
    );
