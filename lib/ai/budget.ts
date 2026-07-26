const DEFAULT_DAILY_RUN_LIMIT = 30;

/** Server-side ceiling for model invocations per organization and UTC day. */
export function dailyAiosRunLimit() {
  const configured = Number.parseInt(process.env.AIOS_MAX_DAILY_RUNS_PER_ORGANIZATION || "", 10);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 1_000 ? configured : DEFAULT_DAILY_RUN_LIMIT;
}

export function dailyRunLimitExceeded(runCountIncludingCurrent: number, limit = dailyAiosRunLimit()) {
  return runCountIncludingCurrent > limit;
}

export function resolveAiosBudgetPolicy(
  policy:
    | {
        daily_model_run_limit: number;
        model_execution_enabled: boolean;
      }
    | null
    | undefined,
) {
  return {
    dailyRunLimit:
      policy?.daily_model_run_limit &&
      Number.isSafeInteger(policy.daily_model_run_limit) &&
      policy.daily_model_run_limit >= 1 &&
      policy.daily_model_run_limit <= 1_000
        ? policy.daily_model_run_limit
        : dailyAiosRunLimit(),
    modelExecutionEnabled: policy?.model_execution_enabled ?? true,
  };
}
