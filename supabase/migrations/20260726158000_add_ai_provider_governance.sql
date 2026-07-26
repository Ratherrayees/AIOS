-- Workspace provider governance selects among server-configured adapters.
-- Credentials remain server-only and an unconfigured provider still fails closed.

alter table public.ai_budget_policies
  add column selected_model_provider text not null default 'glm',
  add column allowed_model_providers text[] not null
    default array['glm', 'openai', 'gemini', 'anthropic', 'qwen']::text[],
  add constraint ai_budget_policies_selected_provider_check
    check (
      selected_model_provider in ('glm', 'openai', 'gemini', 'anthropic', 'qwen')
    ),
  add constraint ai_budget_policies_allowed_providers_check
    check (
      cardinality(allowed_model_providers) between 1 and 5
      and allowed_model_providers
        <@ array['glm', 'openai', 'gemini', 'anthropic', 'qwen']::text[]
      and selected_model_provider = any(allowed_model_providers)
    );
