type ZodRuntimeGlobal = typeof globalThis & {
  __zod_globalConfig?: {
    jitless?: boolean;
  };
};

const zodRuntime = globalThis as ZodRuntimeGlobal;
zodRuntime.__zod_globalConfig ??= {};
zodRuntime.__zod_globalConfig.jitless = true;
