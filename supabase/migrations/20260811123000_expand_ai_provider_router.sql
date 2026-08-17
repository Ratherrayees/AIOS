-- Expand the governed model router with the OpenAI-compatible providers used
-- by the platform fallback chain. Existing workspace allow-lists are extended
-- explicitly so deployed policies keep working after the constraint changes.

alter table public.ai_budget_policies
  drop constraint ai_budget_policies_fallback_provider_check,
  drop constraint ai_budget_policies_allowed_providers_check,
  drop constraint ai_budget_policies_selected_provider_check;

update public.ai_budget_policies
set allowed_model_providers = allowed_model_providers
  || array['groq', 'nvidia', 'openrouter']::text[];

alter table public.ai_budget_policies
  add constraint ai_budget_policies_selected_provider_check
    check (
      selected_model_provider in (
        'groq', 'glm', 'nvidia', 'openrouter',
        'openai', 'gemini', 'anthropic', 'qwen'
      )
    ),
  add constraint ai_budget_policies_allowed_providers_check
    check (
      cardinality(allowed_model_providers) between 1 and 8
      and allowed_model_providers <@ array[
        'groq', 'glm', 'nvidia', 'openrouter',
        'openai', 'gemini', 'anthropic', 'qwen'
      ]::text[]
      and selected_model_provider = any(allowed_model_providers)
    ),
  add constraint ai_budget_policies_fallback_provider_check
    check (
      fallback_model_provider is null
      or (
        fallback_model_provider in (
          'groq', 'glm', 'nvidia', 'openrouter',
          'openai', 'gemini', 'anthropic', 'qwen'
        )
        and fallback_model_provider <> selected_model_provider
        and fallback_model_provider = any(allowed_model_providers)
      )
    );

alter table public.ai_model_prices
  drop constraint ai_model_prices_provider_check,
  add constraint ai_model_prices_provider_check
    check (
      provider in (
        'groq', 'glm', 'nvidia', 'openrouter',
        'openai', 'gemini', 'anthropic', 'qwen'
      )
    );
